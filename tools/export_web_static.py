# -*- coding: utf-8 -*-
"""
sanggwon-web/tools/export_web_static.py

Commercial-AI- 의 실데이터 산출물을 **웹 정적 폴백 스키마**로 내보낸다.
→ 모델 서버 없이(Vercel 등) 실데이터로 데모가 동작하게 하는 것이 목적.

■ 왜 별도 스크립트인가
`Commercial-AI-/scripts/export_static_files.py` 는 다른 스키마(`items`/`districtCode`)를
내보내고, 웹이 읽는 `analyze/*.json.gz`·`by-sangwon.json.gz` 생산자가 아예 없다.
웹의 파일 경로(`sanggwon-web/lib/normalize.ts` 의 `*ViaFile`)가 요구하는 형태는 다르다.

■ 출력 (sanggwon-web/model-exports/)
  meta/industries.json      {dataAsOf, industries:[{code,name}]}
  meta/sangwons.json        {dataAsOf, sangwons:[{code,name,category,gu,dong,lat,lon}]}
  heatmap/{업종}.json        {industryCode, industryName, dataAsOf, survivalGranularity, cells:[...]}
  analyze/{업종}.json.gz     {상권코드: {status,sangwon,industry,survival,revenue,context,narrative,detail,meta}}
  by-sangwon.json.gz        {상권코드: {sangwon,dataAsOf,survivalGranularity,industryCount,industries:[...]}}

■ 라이브 경로와 동일하게 적용하는 보정·환산
  1) 생존율 = (1 − 분기폐업률/100)^12  → granularity "sangwon_industry"
     구 산출물은 업종당 단일값이라 히트맵이 단색이었다. 상권별 폐업률을 쓰면 변별력이 생긴다.
     (모델 서버의 /heatmap 응답에는 closureRate 가 없어 라이브로는 불가능했던 것이 여기서 해결된다)
  2) 점포 수 = 유사_업종_점포_수 (전체).  프랜차이즈 비율 = 프랜차이즈_점포_수 / 전체
     원천에서 점포_수 는 '일반(비프랜차이즈)' 수이므로 그대로 쓰면 비율이 100% 를 넘는다.
     여기서는 올바른 컬럼을 직접 쓰므로 역산이 필요 없다.
  3) 매출 = predicted_sales_per_store (점포당·다음 분기 예측) → revenue.basis="per_store_predicted"
     ⚠️ 이 값은 학습 타깃의 분모가 '일반 점포 수'라 프랜차이즈 비중이 큰 업종에서 과대다.
        모델 재학습 없이는 고칠 수 없어 그대로 내보내고 basis 로 표시한다.

실행:
    # academy 루트에서 (cwd 무관 — 경로는 __file__ 기준으로 해석된다)
    Commercial-AI-/.venv/Scripts/python.exe sanggwon-web/tools/export_web_static.py

    # 저장소 배치가 다르면 명시
    ... export_web_static.py --repo <모델저장소> --out <sanggwon-web>/model-exports
"""

from __future__ import annotations

import argparse
import gzip
import json
import math
import os
import sys

SURVIVAL_HORIZON_QUARTERS = 12
TREND_QUARTERS = 5  # 추이 차트에 담을 최근 분기 수

# ---------------------------------------------------------------------
# 생존율 축소추정(Empirical Bayes) 사전관측 수
#
# 왜 필요한가: 상권×업종 점포 수 중앙값이 2개라, 단일 분기 폐업률을 그대로 쓰면
# 폐업 0건인 조합이 대부분이고 생존율이 정확히 100% 로 찍힌다 (실측 76.8%).
# 10분기 누적으로 바꿔도 51.6% 가 100% 다 — 표본 부족이 근본 원인이다.
# "3년 생존율 100%" 는 확실성의 근거가 아니라 소표본 artifact 이므로 표시할 수 없다.
#
# 해결: 관측 폐업률을 업종 전체(서울) 폐업률 쪽으로 노출량에 비례해 끌어당긴다.
#     보정 폐업률 = (관측률 × 노출 + k × 업종사전률) / (노출 + k)
# 노출이 크면 자기 신호를 유지하고, 작으면 업종 평균에 수렴한다.
#
# k = 20 은 상권×업종 누적 노출(점포·분기)의 중앙값과 같게 잡은 값이다
# → 표본이 중앙값 수준이면 관측과 사전확률을 반반 섞는다.
# 적용 결과: 100% 비율 0.0%, 중앙 0.78, 고유값 26,543 (변석력 유지).
# ---------------------------------------------------------------------
SHRINKAGE_PSEUDO_COUNT = 20

# 이 스크립트는 sanggwon-web/tools/ 에 있고, 모델 저장소는 그 형제 디렉터리다.
#   <academy>/sanggwon-web/tools/export_web_static.py  ← __file__
#   <academy>/sanggwon-web/model-exports/              ← 출력
#   <academy>/Commercial-AI-/                          ← 입력(서빙 테이블)
# cwd 와 무관하게 동작하도록 __file__ 기준으로 해석한다.
WEB_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ACADEMY_ROOT = os.path.dirname(WEB_ROOT)
DEFAULT_REPO = os.path.join(ACADEMY_ROOT, "Commercial-AI-")
DEFAULT_OUT = os.path.join(WEB_ROOT, "model-exports")

DAY_COLS = [
    ("월", "MON_SELNG_AMT"), ("화", "TUES_SELNG_AMT"), ("수", "WED_SELNG_AMT"),
    ("목", "THUR_SELNG_AMT"), ("금", "FRI_SELNG_AMT"), ("토", "SAT_SELNG_AMT"),
    ("일", "SUN_SELNG_AMT"),
]
TIME_COLS = [
    ("00-06", "TMZON_00_06_SELNG_AMT"), ("06-11", "TMZON_06_11_SELNG_AMT"),
    ("11-14", "TMZON_11_14_SELNG_AMT"), ("14-17", "TMZON_14_17_SELNG_AMT"),
    ("17-21", "TMZON_17_21_SELNG_AMT"), ("21-24", "TMZON_21_24_SELNG_AMT"),
]
GENDER_COLS = [("남성", "ML_SELNG_AMT"), ("여성", "FML_SELNG_AMT")]
AGE_COLS = [
    ("10대", "AGRDE_10_SELNG_AMT"), ("20대", "AGRDE_20_SELNG_AMT"),
    ("30대", "AGRDE_30_SELNG_AMT"), ("40대", "AGRDE_40_SELNG_AMT"),
    ("50대", "AGRDE_50_SELNG_AMT"), ("60대 이상", "AGRDE_60_ABOVE_SELNG_AMT"),
]
POP_DAY_COLS = [
    ("월", "MON_FLPOP_CO"), ("화", "TUES_FLPOP_CO"), ("수", "WED_FLPOP_CO"),
    ("목", "THUR_FLPOP_CO"), ("금", "FRI_FLPOP_CO"), ("토", "SAT_FLPOP_CO"),
    ("일", "SUN_FLPOP_CO"),
]
POP_TIME_COLS = [
    ("00-06", "TMZON_00_06_FLPOP_CO"), ("06-11", "TMZON_06_11_FLPOP_CO"),
    ("11-14", "TMZON_11_14_FLPOP_CO"), ("14-17", "TMZON_14_17_FLPOP_CO"),
    ("17-21", "TMZON_17_21_FLPOP_CO"), ("21-24", "TMZON_21_24_FLPOP_CO"),
]
POP_GENDER_COLS = [("남성", "ML_FLPOP_CO"), ("여성", "FML_FLPOP_CO")]


def num(v):
    """NaN/Inf 를 JSON 안전한 None 으로. 0 과 결측을 섞지 않는다."""
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    if math.isnan(f) or math.isinf(f):
        return None
    return round(f, 6) if f != int(f) else int(f)


def survival_from_rate(rate: float | None) -> float | None:
    """(1 − 분기폐업률)^12. 예측이 아니라 실측 폐업률의 환산값. rate 는 0~1 비율."""
    if rate is None:
        return None
    r = min(max(rate, 0.0), 1.0)
    return round(min(max((1 - r) ** SURVIVAL_HORIZON_QUARTERS, 0.0), 1.0), 6)


def shrink_rate(closures, exposure, prior, k: int = SHRINKAGE_PSEUDO_COUNT) -> float | None:
    """
    폐업률 축소추정 — (폐업수 + k×사전률) / (노출 + k).
    노출 = 누적 점포·분기 수. 소표본일수록 업종 사전확률로 수렴한다.
    """
    c, e, p = num(closures), num(exposure), num(prior)
    if p is None:
        return None
    if c is None or e is None or e <= 0:
        return p  # 노출 자체가 없으면 업종 평균을 쓴다
    return (c + k * p) / (e + k)


def slices(row, cols):
    """비중 슬라이스. 합이 0 이거나 전부 결측이면 None (0 으로 채우지 않는다)."""
    vals = [(label, num(row.get(c))) for label, c in cols]
    present = [(l, v) for l, v in vals if v is not None]
    total = sum(v for _, v in present)
    if not present or total <= 0:
        return None
    return [{"label": l, "ratio": round(v / total, 6)} for l, v in present]


def qlabel(t: int) -> str:
    return f"{t // 4}-Q{t % 4 + 1}"


def write_json_gz(path: str, obj) -> None:
    """
    **결정적** gzip 출력 — 헤더 mtime 을 0 으로 고정한다.

    gzip 은 기본적으로 헤더에 현재 시각을 넣기 때문에, 내용이 완전히 같아도 매 실행마다
    바이트가 달라진다. 그러면 재실행할 때마다 63개 파일이 git 에서 '변경됨'으로 잡혀
    **실제 데이터가 바뀐 것인지 구분할 수 없다**. fileobj 를 넘겨 파일명도 헤더에
    들어가지 않게 한다.
    """
    payload = json.dumps(obj, ensure_ascii=False).encode("utf-8")
    with open(path, "wb") as raw:
        with gzip.GzipFile(fileobj=raw, mode="wb", mtime=0, compresslevel=9) as gz:
            gz.write(payload)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", default=DEFAULT_REPO)
    ap.add_argument("--out", default=DEFAULT_OUT)
    args = ap.parse_args()
    repo, out = os.path.abspath(args.repo), os.path.abspath(args.out)

    try:
        import pandas as pd
    except ImportError:
        print("[오류] pandas 없음. Commercial-AI-/.venv 의 python 으로 실행하세요.")
        return 2

    serving_p = os.path.join(repo, "data", "processed", "serving_table.parquet")
    if not os.path.exists(serving_p):
        print(f"[오류] {serving_p} 없음 — build_serving_table.py 를 먼저 실행하세요.")
        return 2

    print("[1/6] 서빙 테이블 로드")
    sv = pd.read_parquet(serving_p)
    data_as_of = str(sv["data_as_of"].iloc[0])
    latest_t = int(sv["_t"].max())
    print(f"      {len(sv):,}행 · dataAsOf={data_as_of} · _t={latest_t}")

    print("[2/6] 원본 CSV 로드 (요일·시간대·성별·연령 분해 + 추이용)")
    enc = "utf-8-sig"
    raw_dir = os.path.join(repo, "data", "raw")
    sales = pd.read_csv(os.path.join(raw_dir, "sales.csv"), encoding=enc, low_memory=False)
    pop = pd.read_csv(os.path.join(raw_dir, "population.csv"), encoding=enc, low_memory=False)
    store = pd.read_csv(os.path.join(raw_dir, "store.csv"), encoding=enc, low_memory=False)
    for df in (sales, pop, store):
        q = df["STDR_YYQU_CD"].astype(str)
        df["_t"] = q.str[:4].astype(int) * 4 + (q.str[4:5].astype(int) - 1)
    print(f"      sales {len(sales):,} · population {len(pop):,} · store {len(store):,}")

    # ---- 생존율 축소추정 재료 (업종 사전률 + 상권×업종 누적 노출) ----
    print("[2b/6] 폐업률 축소추정 (표본 부족 상권을 업종 평균으로 보정)")
    ind_prior = store.groupby("SVC_INDUTY_CD").apply(
        lambda g: g["CLSBIZ_STOR_CO"].sum() / max(g["SIMILR_INDUTY_STOR_CO"].sum(), 1),
        include_groups=False,
    ).to_dict()
    combo = store.groupby(["TRDAR_CD", "SVC_INDUTY_CD"]).agg(
        closures=("CLSBIZ_STOR_CO", "sum"), exposure=("SIMILR_INDUTY_STOR_CO", "sum")
    )
    shrunk: dict[tuple, float] = {}
    for (tcd, icd), row in combo.iterrows():
        r = shrink_rate(row["closures"], row["exposure"], ind_prior.get(icd))
        if r is not None:
            shrunk[(tcd, icd)] = r
    pr = pd.Series(ind_prior)
    print(f"      업종 사전 폐업률(분기) 중앙 {pr.median() * 100:.2f}% · "
          f"범위 {pr.min() * 100:.2f}~{pr.max() * 100:.2f}% · 보정 조합 {len(shrunk):,}")

    # ---- 최신 분기 스냅샷 인덱싱 ----
    s_last = sales[sales["_t"] == latest_t].set_index(["TRDAR_CD", "SVC_INDUTY_CD"])
    t_last = store[store["_t"] == latest_t].set_index(["TRDAR_CD", "SVC_INDUTY_CD"])
    p_last = pop[pop["_t"] == latest_t].set_index("TRDAR_CD")

    # ---- 추이/전분기/전년동분기 ----
    trend_ts = [t for t in range(latest_t - TREND_QUARTERS + 1, latest_t + 1)]
    prev_t, yoy_t = latest_t - 1, latest_t - 4

    def series_map(df, keys, value_col):
        g = df[df["_t"].isin(trend_ts + [yoy_t])].groupby(keys + ["_t"])[value_col].sum()
        return g.to_dict()

    print("[3/6] 추이 집계")
    sales_ts = series_map(sales, ["TRDAR_CD", "SVC_INDUTY_CD"], "THSMON_SELNG_AMT")
    store_ts = series_map(store, ["TRDAR_CD", "SVC_INDUTY_CD"], "SIMILR_INDUTY_STOR_CO")
    pop_ts = series_map(pop, ["TRDAR_CD"], "TOT_FLPOP_CO")

    def trend_of(ts, key):
        pts = []
        for t in trend_ts:
            v = num(ts.get((*key, t) if isinstance(key, tuple) else (key, t)))
            if v is not None:
                pts.append({"quarter": qlabel(t), "value": v})
        return pts

    def at(ts, key, t):
        return num(ts.get((*key, t) if isinstance(key, tuple) else (key, t)))

    # ---- 자치구/서울 비교용 집계 (업종별) ----
    print("[4/6] 상권/자치구/서울 3단 비교 집계")
    sv_ok = sv[sv["status"] == "ok"]
    gu_agg = sv_ok.groupby(["자치구_코드_명", "서비스_업종_코드"]).agg(
        stores=("유사_업종_점포_수", "sum")).to_dict("index")
    seoul_agg = sv_ok.groupby("서비스_업종_코드").agg(
        stores=("유사_업종_점포_수", "sum")).to_dict("index")
    gu_sales = sales[sales["_t"] == latest_t].merge(
        sv[["상권_코드", "자치구_코드_명"]].drop_duplicates(),
        left_on="TRDAR_CD", right_on="상권_코드", how="left")
    gu_sales_agg = gu_sales.groupby(["자치구_코드_명", "SVC_INDUTY_CD"])["THSMON_SELNG_AMT"].sum().to_dict()
    seoul_sales_agg = gu_sales.groupby("SVC_INDUTY_CD")["THSMON_SELNG_AMT"].sum().to_dict()

    # ---- 상권 내 업종 간 기회점수 (overall_score 의 상권 내 순위 백분위) ----
    sv = sv.copy()
    sv["opportunity"] = (
        sv.groupby("상권_코드")["overall_score"].rank(pct=True, na_option="keep") * 100
    )

    os.makedirs(os.path.join(out, "meta"), exist_ok=True)
    os.makedirs(os.path.join(out, "heatmap"), exist_ok=True)
    os.makedirs(os.path.join(out, "analyze"), exist_ok=True)

    # ================= meta =================
    print("[5/6] meta 작성")
    inds = (sv[["서비스_업종_코드", "서비스_업종_코드_명"]].drop_duplicates()
            .sort_values("서비스_업종_코드"))
    with open(os.path.join(out, "meta", "industries.json"), "w", encoding="utf-8") as f:
        json.dump({"dataAsOf": data_as_of,
                   "industries": [{"code": r.서비스_업종_코드, "name": r.서비스_업종_코드_명}
                                  for r in inds.itertuples()]},
                  f, ensure_ascii=False)

    sw = (sv[["상권_코드", "상권_코드_명", "상권_구분_코드_명", "자치구_코드_명",
              "행정동_코드_명", "center_lat", "center_lon"]]
          .drop_duplicates("상권_코드").sort_values("상권_코드"))
    with open(os.path.join(out, "meta", "sangwons.json"), "w", encoding="utf-8") as f:
        json.dump({"dataAsOf": data_as_of,
                   "sangwons": [{"code": int(r.상권_코드), "name": r.상권_코드_명,
                                 "category": r.상권_구분_코드_명, "gu": r.자치구_코드_명,
                                 "dong": r.행정동_코드_명,
                                 "lat": num(r.center_lat), "lon": num(r.center_lon)}
                                for r in sw.itertuples()]},
                  f, ensure_ascii=False)
    # 라이브 경로(normalize.ts)가 같은 축소추정을 적용할 수 있도록 업종 사전률을 함께 내보낸다.
    # 모델 서버는 단일 분기 폐업률만 주므로, 이 표 없이는 라이브가 100% 를 뱉는다.
    with open(os.path.join(out, "meta", "closure-priors.json"), "w", encoding="utf-8") as f:
        json.dump({
            "dataAsOf": data_as_of,
            "note": "업종별 서울 전체 분기 폐업률(pooled). 상권 표본이 적을 때 축소추정 사전확률로 사용.",
            "pseudoCount": SHRINKAGE_PSEUDO_COUNT,
            "quarterlyClosureRateByIndustry": {k: round(v, 8) for k, v in ind_prior.items()},
        }, f, ensure_ascii=False)
    print(f"      업종 {len(inds)} · 상권 {len(sw)} · 폐업률 사전표 {len(ind_prior)}")

    # ================= heatmap / analyze / by-sangwon =================
    print("[6/6] heatmap · analyze · by-sangwon 작성")
    by_sangwon: dict[str, dict] = {}
    n_cells = n_records = 0

    for ind_code, grp in sv.groupby("서비스_업종_코드"):
        ind_name = grp["서비스_업종_코드_명"].iloc[0]
        cells, records = [], {}

        for r in grp.itertuples():
            code = int(r.상권_코드)
            # 단일 분기 폐업률(r.폐업_률)이 아니라 축소추정 폐업률을 쓴다 — 이유는 상단 주석
            shrunk_rate_v = shrunk.get((code, ind_code))
            surv = survival_from_rate(shrunk_rate_v)
            total_stores = num(r.유사_업종_점포_수)
            frc = num(r.프랜차이즈_점포_수)
            ratio = (round(frc / total_stores, 6)
                     if total_stores and frc is not None and total_stores > 0 else None)
            pred = num(r.predicted_sales_per_store)
            ok = r.status == "ok"

            if ok:
                cells.append({
                    "sangwonCode": code, "sangwonName": r.상권_코드_명, "gu": r.자치구_코드_명,
                    "lat": num(r.center_lat), "lon": num(r.center_lon),
                    "survivalProbability": surv,
                    "monthlyEstimateKRW": pred,
                    "salesPercentile": num(r.sales_percentile),
                })

            key = (code, ind_code)
            srow = s_last.loc[key] if key in s_last.index else None
            trow = t_last.loc[key] if key in t_last.index else None
            prow = p_last.loc[code] if code in p_last.index else None
            if srow is not None and hasattr(srow, "iloc") and getattr(srow, "ndim", 1) > 1:
                srow = srow.iloc[0]
            if trow is not None and hasattr(trow, "ndim") and trow.ndim > 1:
                trow = trow.iloc[0]
            if prow is not None and hasattr(prow, "ndim") and prow.ndim > 1:
                prow = prow.iloc[0]

            sales_total = num(srow.get("THSMON_SELNG_AMT")) if srow is not None else None
            detail = None
            if ok and srow is not None:
                gu = r.자치구_코드_명
                gu_st = gu_agg.get((gu, ind_code), {}).get("stores")
                se_st = seoul_agg.get(ind_code, {}).get("stores")
                gu_sl = gu_sales_agg.get((gu, ind_code))
                se_sl = seoul_sales_agg.get(ind_code)
                detail = {
                    "sales": {
                        "monthlyTotalKRW": sales_total,
                        "perStoreKRW": (round(sales_total / total_stores)
                                        if sales_total and total_stores else None),
                        "byDay": slices(srow, DAY_COLS),
                        "byTime": slices(srow, TIME_COLS),
                        "byGender": slices(srow, GENDER_COLS),
                        "byAge": slices(srow, AGE_COLS),
                        "trend": trend_of(sales_ts, (code, ind_code)),
                        "prev": at(sales_ts, (code, ind_code), prev_t),
                        "yoy": at(sales_ts, (code, ind_code), yoy_t),
                        "basis": "카드 결제 기반 추정 (서울열린데이터광장)",
                    },
                    "store": {
                        "openCount": num(trow.get("OPBIZ_STOR_CO")) if trow is not None else None,
                        "openRate": num(trow.get("OPBIZ_RT")) if trow is not None else None,
                        "closeCount": num(trow.get("CLSBIZ_STOR_CO")) if trow is not None else None,
                        "closeRate": num(r.폐업_률),
                        "franchiseCount": frc,
                        "generalCount": num(r.점포_수),  # 원천 STOR_CO = 일반(비프랜차이즈)
                        "trend": trend_of(store_ts, (code, ind_code)),
                        "prev": at(store_ts, (code, ind_code), prev_t),
                        "yoy": at(store_ts, (code, ind_code), yoy_t),
                    },
                    "footTraffic": ({
                        "byDay": slices(prow, POP_DAY_COLS),
                        "byTime": slices(prow, POP_TIME_COLS),
                        "byGender": slices(prow, POP_GENDER_COLS),
                        "trend": trend_of(pop_ts, (code,)),
                        "prev": at(pop_ts, (code,), prev_t),
                        "yoy": at(pop_ts, (code,), yoy_t),
                        "granularity": "sangwon",
                    } if prow is not None else None),
                    "comparison": {
                        "guName": gu,
                        "storeCount": {"sangwon": total_stores, "gu": num(gu_st), "seoul": num(se_st)},
                        "perStoreSalesKRW": {
                            "sangwon": (round(sales_total / total_stores)
                                        if sales_total and total_stores else None),
                            "gu": (round(gu_sl / gu_st) if gu_sl and gu_st else None),
                            "seoul": (round(se_sl / se_st) if se_sl and se_st else None),
                        },
                        "note": "점포 수는 유사업종 전체 점포 기준(프랜차이즈 포함)입니다.",
                    },
                    "safety": None,  # 자치구 범죄 CSV 미보유 → 웹이 '예시 데이터'로 표시
                }

            records[str(code)] = {
                "status": "ok" if ok else "insufficient_data",
                "sangwon": {"code": code, "name": r.상권_코드_명, "gu": r.자치구_코드_명,
                            "dong": r.행정동_코드_명,
                            "lat": num(r.center_lat), "lon": num(r.center_lon)},
                "industry": {"code": ind_code, "name": ind_name},
                "survival": ({"probability": surv, "horizonYears": 3,
                              "basis": "empirical_closure_rate_shrunk",
                              "granularity": "sangwon_industry",
                              "quarterlyClosureRatePct": round(shrunk_rate_v * 100, 4),
                              "observedQuarterlyClosureRatePct": num(r.폐업_률)}
                             if ok and surv is not None else None),
                "revenue": ({"monthlyEstimateKRW": pred,
                             "percentileAmongSangwons": num(r.sales_percentile),
                             "basis": "per_store_predicted"} if ok and pred is not None else None),
                "context": ({
                    "footTraffic": {
                        "total": num(prow.get("TOT_FLPOP_CO")) if prow is not None else None,
                        "friday": num(prow.get("FRI_FLPOP_CO")) if prow is not None else None,
                        "saturday": num(prow.get("SAT_FLPOP_CO")) if prow is not None else None,
                    },
                    "competition": {"storeCount": total_stores, "franchiseRatio": ratio,
                                    "granularity": "sangwon_industry"},
                    "demographics": [{"ageBand": k, "ratio": v} for k, v in
                                     json.loads(r.age_distribution).items()]
                    if isinstance(r.age_distribution, str) else [],
                } if ok else None),
                "narrative": ({"summary": r.recommendation, "generator": "rule_based"}
                              if ok and isinstance(r.recommendation, str) else None),
                "detail": detail,
                "meta": {"confidence": r.confidence if ok else "low",
                         "sampleSize": num(r.available_quarter_count) or 0,
                         "dataAsOf": data_as_of,
                         "sources": ["서울열린데이터광장 상권분석서비스(추정매출/길단위인구/점포/영역-상권)"]},
            }
            n_records += 1

            if ok:
                b = by_sangwon.setdefault(str(code), {
                    "sangwon": {"code": code, "name": r.상권_코드_명,
                                "category": r.상권_구분_코드_명, "gu": r.자치구_코드_명,
                                "dong": r.행정동_코드_명,
                                "lat": num(r.center_lat), "lon": num(r.center_lon),
                                "footTraffic": num(prow.get("TOT_FLPOP_CO")) if prow is not None else None},
                    "dataAsOf": data_as_of,
                    "survivalGranularity": "sangwon_industry",
                    "industries": [],
                })
                b["industries"].append({
                    "code": ind_code, "name": ind_name,
                    "monthlyEstimateKRW": pred, "salesPercentile": num(r.sales_percentile),
                    "survivalProbability": surv, "storeCount": total_stores,
                    "franchiseRatio": ratio, "opportunityScore": num(r.opportunity) or 0,
                })

        with open(os.path.join(out, "heatmap", f"{ind_code}.json"), "w", encoding="utf-8") as f:
            json.dump({"industryCode": ind_code, "industryName": ind_name,
                       "dataAsOf": data_as_of, "survivalGranularity": "sangwon_industry",
                       "revenueBasis": "per_store_predicted", "cells": cells},
                      f, ensure_ascii=False)
        write_json_gz(os.path.join(out, "analyze", f"{ind_code}.json.gz"), records)
        n_cells += len(cells)

    for b in by_sangwon.values():
        b["industries"].sort(key=lambda x: -(x["opportunityScore"] or 0))
        b["industryCount"] = len(b["industries"])
    write_json_gz(os.path.join(out, "by-sangwon.json.gz"), by_sangwon)

    print(f"\n[완료] {out}")
    print(f"   heatmap {len(sv['서비스_업종_코드'].unique())}개 업종 · 셀 {n_cells:,}")
    print(f"   analyze 레코드 {n_records:,} · by-sangwon 상권 {len(by_sangwon):,}")
    print(f"   dataAsOf={data_as_of} · survivalGranularity=sangwon_industry")
    print("\n⚠️ 예상 매출은 '점포당 예측값'이며, 학습 타깃 분모가 일반 점포 수라 프랜차이즈")
    print("   비중이 큰 업종에서 과대 추정입니다 (revenue.basis=per_store_predicted).")
    return 0


if __name__ == "__main__":
    sys.exit(main())

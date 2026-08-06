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
     분모 오류(일반 점포 수)는 모델 저장소 cbaab3d 재학습으로 해소됐다 — 이제 전체 점포
     (독립+프랜차이즈) 기준이다. 재생성 전후 중앙값: 편의점 0.25배 · 치킨 0.37배 · 한식 0.90배.

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


def load_safety_by_gu(repo: str, sv) -> tuple[dict, dict]:
    """
    자치구 치안 상세 + 안전점수 — **모델 저장소 데이터만** 사용한다 (2026-08-05 전환).

    이전에는 웹이 별도 조달한 CSV(구 레포 경로, 지금은 없음)로 build_safety_scores.py 를
    돌려 meta/safety-scores.json 을 만들었다. v2 에서 같은 원본이 모델 저장소
    data/raw/external/ 에 커밋됐고 서빙 테이블에 모델 계산 점수(score_safety_gu)가
    실려 있으므로, 여기서 함께 생성해 죽은 의존을 없앤다.

    반환: (detail_by_gu, scores_meta)
      detail_by_gu  — 상권 자치구명 → SafetyDetail(웹 계약 contracts.ts) 형태.
                      analyze 레코드의 detail.safety 로 들어간다
      scores_meta   — meta/safety-scores.json 전체 내용 (기존 스키마 유지,
                      score 만 웹 재계산 → **모델 score_safety_gu** 로 교체)

    ⚠️ arrestRate 는 검거/발생 원본비라 1.0 을 넘을 수 있다(다른 기간 사건 검거 포함).
       '검거율'로 화면에 직접 표시하지 말 것 — 점수 성분·백분위 용도로만.
    """
    import glob

    import pandas as pd

    ext = os.path.join(repo, "data", "raw", "external")
    crime = pd.read_csv(os.path.join(ext, "crime_gu.csv"), encoding="utf-8-sig")
    year = int(crime["연도"].max())
    crime = crime[crime["연도"] == year].set_index("자치구")

    cctv = pd.read_csv(os.path.join(ext, "cctv_gu.csv"), encoding="utf-8-sig")
    cctv_year = int(cctv["연도"].max())
    cctv = cctv[cctv["연도"] == cctv_year].set_index("자치구")

    # ---- 유형별 발생 건수 (다중 헤더 CSV: 행0=연도·행2=유형·행3=발생/검거, 데이터 행4~) ----
    by_type: dict[str, list] = {}
    paths = sorted(glob.glob(os.path.join(ext, "5대*범죄*발생현황*.csv")))
    if paths:
        raw = pd.read_csv(paths[0], encoding="utf-8-sig", header=None)
        years_row, types_row, kind_row = raw.iloc[0], raw.iloc[2], raw.iloc[3]
        cols = [i for i in range(2, raw.shape[1])
                if str(years_row[i]) == str(year) and str(kind_row[i]) == "발생"
                and str(types_row[i]) != "소계"]
        label_map = {"강간·강제추행": "성범죄"}  # 기존 safety-scores.json 라벨과 통일

        def cnt(v) -> int | None:
            # 통계표의 '-' 는 발생 0건 표기다 (강북·도봉·서대문·구로 강도에서 실측 확인).
            # 구판은 이 항목을 누락시켰는데, 0 으로 싣는 쪽이 정직하다.
            s = str(v).strip()
            if s == "-":
                return 0
            try:
                return int(float(s))
            except ValueError:
                return None

        for _, row in raw.iloc[4:].iterrows():
            gu = str(row[1]).strip()
            if gu in ("소계", "합계") or gu not in crime.index:
                continue
            entries = [
                {"label": label_map.get(str(types_row[i]), str(types_row[i])), "count": c}
                for i in cols
                if pd.notna(row[i]) and (c := cnt(row[i])) is not None
            ]
            by_type[gu] = entries or None

    # ---- 모델 점수 (서빙 테이블 — 자치구당 유일값임을 확인함) ----
    model_score = sv.groupby("자치구_코드_명")["score_safety_gu"].first()

    gus = sorted(crime.index)
    seoul_avg = round(float(crime["범죄_발생_건수"].mean()), 1)
    rank = crime["범죄_발생_건수"].rank(method="min").astype(int)  # 1 = 가장 적음

    detail_by_gu: dict[str, dict] = {}
    by_gu_scores: dict[str, dict] = {}
    for gu in gus:
        c = crime.loc[gu]
        incidents = int(c["범죄_발생_건수"])
        per100k = (round(incidents / c["인구"] * 100_000, 1) if c["인구"] > 0 else None)
        detail_by_gu[gu] = {
            "year": str(year),
            "guName": gu,
            "totalIncidents": incidents,
            "byType": by_type.get(gu),
            "rankAmongGus": int(rank[gu]),
            "guCount": len(gus),
            "seoulAvgIncidents": seoul_avg,
            "per100k": per100k,
            "granularity": "gu",
        }
        by_gu_scores[gu] = {
            "crimeRatePer100k": per100k,
            "arrestRate": (round(float(c["범죄_검거_건수"]) / incidents, 4)
                           if incidents > 0 else None),
            "cctvPerKm2": (round(float(cctv.loc[gu, "cctv_대수"])
                                 / cctv.loc[gu, "자치구_면적_km2"], 1)
                           if gu in cctv.index and cctv.loc[gu, "자치구_면적_km2"] > 0 else None),
            "score": num(model_score.get(gu)),
            "totalIncidents": incidents,
            "byType": by_type.get(gu),
            "rankAmongGus": int(rank[gu]),
            "guCount": len(gus),
            "seoulAvgIncidents": seoul_avg,
        }

    scores_meta = {
        "year": str(year),
        "cctvYear": str(cctv_year),
        # 산식 정본 = 모델 config/scoring_weights.yaml 의 safety_score. 여기 적는 건 표기용
        "weights": {"crimeRatePer100k": 0.5, "arrestRate": 0.25, "cctvPerKm2": 0.25},
        "minComponents": 2,
        "weightsNote": (
            "안전점수 = 모델 파이프라인(Commercial-AI-) 이 계산한 score_safety_gu 를 그대로 사용 — "
            "범죄율(10만명당, 낮을수록↑) 50% + 검거 비율 25% + CCTV 밀도 25% 의 자치구 간 "
            "백분위 가중합(0~100). 가중치는 서비스 정책값이며 통계적으로 검증된 사실이 아닙니다."
        ),
        "sources": [
            f"서울열린데이터광장/경찰청 5대범죄 발생·검거 ({year}, Commercial-AI-/data/raw/external/)",
            f"서울시 자치구 CCTV 설치현황 ({cctv_year}, Commercial-AI-/data/raw/external/)",
            "안전점수: Commercial-AI- 서빙 테이블 score_safety_gu (config/scoring_weights.yaml)",
        ],
        "byGu": by_gu_scores,
    }
    return detail_by_gu, scores_meta


def build_rankings(sales, pop, store, sv, repo: str, out: str) -> dict:
    """
    상권·행정동 지표 랭킹 재료 — golmok '뜨는 상권/뜨는 동네' 대응 (2026-08-06).

    지표 5종(점포수·매출·유동인구·상주인구·직장인구)의 상권별
    {value, prev, changePct} 를 meta/rankings.json.gz 로 내보낸다.
    행정동(byDong)은 상권 값을 서빙 테이블의 상권→행정동 매핑으로 **합산**한 것.
    행정동 키는 이름이 아니라 코드다 — 신사동처럼 서울 안에서 이름이 중복된다
    (강남구/은평구). 서빙에 없는 상권(원본에만 있는 ~80개)은 매핑이 없어
    동 집계에서 빠진다.
    **정렬·순위 매기기는 웹 표시 계층 몫** — 여기서는 값만 준다.
    (합계·증감률 '산출'은 데이터 가공층인 이 스크립트 책임 — 웹이 수치를
    만들지 않는 원칙의 경계가 여기다. ComparePanel 설계 제약과 동일.)

    - stores/sales: 상권×업종 행을 상권으로 **합산**.
      ⚠️ 원천이 생활밀접업종 62종이라 '상권 전체'가 아니다 — scope 에 명시하고
      UI 가 그대로 노출한다 (집계 기준을 숨기면 golmok 수치와 달라 보이는 이유를
      설명할 수 없게 된다)
    - footTraffic: population.csv 가 애초에 상권 단위 (합산 없음)
    - resident/worker: 모델 저장소 인구 CSV. **asOf 가 다르다** (2026Q1 vs 2025Q2)
      — 지표별 asOf 를 파일에 싣고 UI 가 표기한다 (배후지 항목별 as-of 와 같은 패턴)
    - changePct 는 직전 분기 대비. 직전 값이 없거나 0 이면 null (0 나누기 금지)
    """
    import pandas as pd

    def q_str(t: int) -> str:
        return f"{t // 4}Q{t % 4 + 1}"

    def per_sangwon(df, value_col: str, agg: bool):
        """상권별 {code: (latest, prev)} + asOf. agg=True 면 업종 합산."""
        if agg:
            g = df.groupby(["TRDAR_CD", "_t"])[value_col].sum().reset_index()
        else:
            g = df[["TRDAR_CD", "_t", value_col]].copy()
        t_max = int(g["_t"].max())
        cur = g[g["_t"] == t_max].set_index("TRDAR_CD")[value_col]
        prv = g[g["_t"] == t_max - 1].set_index("TRDAR_CD")[value_col]
        return cur, prv, q_str(t_max)

    # 상주·직장인구 — rebuild_hinterland 와 같은 원본 (상권×분기, 값 있는 분기만)
    def pop_csv(fname: str, tot_col: str):
        df = pd.read_csv(os.path.join(repo, "data", "raw", fname), encoding="utf-8-sig")
        df[tot_col] = pd.to_numeric(df[tot_col], errors="coerce")
        df = df[df[tot_col].notna()].copy()
        q = df["STDR_YYQU_CD"].astype(str)
        df["_t"] = q.str[:4].astype(int) * 4 + (q.str[4:5].astype(int) - 1)
        return df

    resident = pop_csv("resident_population.csv", "TOT_REPOP_CO")
    worker = pop_csv("worker_population.csv", "TOT_WRC_POPLTN_CO")

    SCOPE_62 = "생활밀접업종 62종 합계 (상권 전체 아님)"
    metric_defs = [
        # key, (df, value_col, 업종합산여부), label, unit, scope
        ("stores", (store, "SIMILR_INDUTY_STOR_CO", True), "점포 수", "개", SCOPE_62),
        ("sales", (sales, "THSMON_SELNG_AMT", True), "분기 매출", "KRW",
         SCOPE_62 + " · 카드 결제 기반 실측 추정"),
        ("footTraffic", (pop, "TOT_FLPOP_CO", False), "분기 유동인구", "명", "상권 전체"),
        ("resident", (resident, "TOT_REPOP_CO", False), "상주인구", "명", "상권 전체"),
        ("worker", (worker, "TOT_WRC_POPLTN_CO", False), "직장인구", "명", "상권 전체"),
    ]
    # 유동인구 연령대 서브 지표 (golmok 뜨는 상권 상세조건의 연령대 필터 대응).
    # 최상위 토글이 아니라 footTraffic 선택 시 서브 토글 — UI 는 subOf 로 구분한다.
    AGE_SUBS = [("10", "10대"), ("20", "20대"), ("30", "30대"),
                ("40", "40대"), ("50", "50대"), ("60_ABOVE", "60대 이상")]
    for a, lb in AGE_SUBS:
        metric_defs.append((
            f"footTraffic_{a.split('_')[0]}",
            (pop, f"AGRDE_{a}_FLPOP_CO", False),
            f"유동인구 {lb}", "명", "상권 전체",
        ))

    # 상권 → 행정동·자치구 매핑 (서빙 테이블, 상권 중복 제거)
    _sw = sv.drop_duplicates("상권_코드").set_index("상권_코드")
    dong_of = {int(c): (int(num(r["행정동_코드"])), str(r["행정동_코드_명"]), str(r["자치구_코드_명"]))
               for c, r in _sw[["행정동_코드", "행정동_코드_명", "자치구_코드_명"]].iterrows()
               if num(r["행정동_코드"]) is not None}
    dong_name = {dc: (n, g) for _, (dc, n, g) in dong_of.items()}

    by_sangwon: dict[str, dict] = {}
    by_dong: dict[str, dict] = {}
    metrics_meta: dict[str, dict] = {}
    for key, (df, col, agg), label, unit, scope in metric_defs:
        cur, prv, asof = per_sangwon(df, col, agg)

        # ---- 행정동 집계: 상권 값을 매핑으로 합산한 뒤 상권과 같은 방식으로 판정 ----
        d_cur: dict[int, float] = {}
        d_prv: dict[int, float] = {}
        for code, v in cur.items():
            m = dong_of.get(int(code))
            if m is None or num(v) is None:
                continue
            d_cur[m[0]] = d_cur.get(m[0], 0) + float(v)
        for code, v in prv.items():
            m = dong_of.get(int(code))
            if m is None or num(v) is None:
                continue
            d_prv[m[0]] = d_prv.get(m[0], 0) + float(v)
        d_prev_median = (sorted(d_prv.values())[len(d_prv) // 2] if d_prv else 0.0)
        for dcode, v in d_cur.items():
            value = num(v)
            if value is None:
                continue
            prev = num(d_prv.get(dcode))
            name_gu = dong_name.get(dcode)
            entry = by_dong.setdefault(str(int(dcode)), {
                "name": name_gu[0] if name_gu else None,
                "gu": name_gu[1] if name_gu else None,
                "metrics": {},
            })
            entry["metrics"][key] = {
                "value": value,
                "prev": prev,
                "changePct": (round((value - prev) / prev * 100, 2)
                              if prev is not None and prev > 0 else None),
                "lowBase": (prev is None or prev < d_prev_median),
            }
        # 소표본 판정 기준 — golmok 은 "돈암1동 커피 5만원 +326%" 같은 소표본 노이즈가
        # 증가율 랭킹 상위를 점령했다 (벤치마크 실측). 직전 분기 값이 전 상권 중앙값
        # 미만이면 lowBase 로 표시해 UI 가 기본 제외하고 그 사실을 밝히게 한다.
        # 판정 재료(중앙값)는 여기(가공층)서 계산 — 웹은 플래그만 쓴다.
        prev_median = float(prv.median()) if len(prv) else 0.0
        metrics_meta[key] = {"label": label, "unit": unit, "scope": scope, "asOf": asof,
                             "lowBaseThreshold": num(prev_median),
                             # 서브 지표는 최상위 토글에 안 뜬다 — footTraffic 의 연령대 필터
                             "subOf": "footTraffic" if key.startswith("footTraffic_") else None}
        for code, v in cur.items():
            value = num(v)
            if value is None:
                continue
            prev = num(prv.get(code))
            entry = by_sangwon.setdefault(str(int(code)), {})
            entry[key] = {
                "value": value,
                "prev": prev,
                "changePct": (round((value - prev) / prev * 100, 2)
                              if prev is not None and prev > 0 else None),
                "lowBase": (prev is None or prev < prev_median),
            }

    # 드릴다운(동네 → 상권)용 — 상권이 속한 행정동 코드
    dong_code_of_sangwon = {str(c): m[0] for c, m in dong_of.items()}

    doc = {
        "metrics": metrics_meta,
        "note": "상권·행정동 지표 랭킹 재료. 값·증감률은 파이프라인 산출이며 "
                "웹은 정렬·표시만 한다. 점포수·매출은 생활밀접업종 62종 합계 기준. "
                "행정동은 상권 값의 합산 — 서빙에 없는 상권은 동 집계에서 제외.",
        "bySangwon": by_sangwon,
        "sangwonDong": dong_code_of_sangwon,
        "byDong": by_dong,
    }
    write_json_gz(os.path.join(out, "meta", "rankings.json.gz"), doc)
    return {"sangwons": len(by_sangwon), "dongs": len(by_dong),
            "asOf": "/".join(m["asOf"] for m in metrics_meta.values())}


def rebuild_hinterland(repo: str, out: str) -> dict | None:
    """
    배후지(meta/hinterland.json.gz)의 **상주·직장인구 블록을 모델 저장소 데이터로 교체**
    (2026-08-05 전환).

    - 상주/직장인구: `Commercial-AI-/data/raw/{resident,worker}_population.csv`
      (collect_data.py API 수집본, 21분기·최신 2026Q1) — 구판 포털 다운로드본과 같은
      데이터셋(OA-15584/OA-15569)이므로 값이 일치해야 정상이다
    - 아파트·집객시설·소비지출: 모델 파이프라인이 **수집하지 않는** 데이터라 기존
      커밋본(gz)에서 이월(carry-over)한다. 원천이 모델 저장소 수집 목록에 들어오면
      이 이월을 제거할 것 (data_sources.yaml 수정 = 팀원 합의 필요)

    반환: 요약 dict (로그용) 또는 None (원천 CSV 미보유 환경).
    """
    import pandas as pd

    gz_path = os.path.join(out, "meta", "hinterland.json.gz")
    res_p = os.path.join(repo, "data", "raw", "resident_population.csv")
    wrk_p = os.path.join(repo, "data", "raw", "worker_population.csv")
    if not (os.path.exists(gz_path) and os.path.exists(res_p) and os.path.exists(wrk_p)):
        return None

    with gzip.open(gz_path) as f:
        doc = json.load(f)

    AGE_LABELS = [("10", "10s"), ("20", "20s"), ("30", "30s"),
                  ("40", "40s"), ("50", "50s"), ("60_ABOVE", "60s+")]

    def latest_rows(path: str, tot_col: str):
        df = pd.read_csv(path, encoding="utf-8-sig")
        df[tot_col] = pd.to_numeric(df[tot_col], errors="coerce")
        has = df[df[tot_col].notna()]
        q = int(has["STDR_YYQU_CD"].max())
        asof = f"{q // 10}Q{q % 10}"
        return has[has["STDR_YYQU_CD"] == q].set_index("TRDAR_CD"), asof

    def dist(row, cols_labels, total) -> list | None:
        if not total or total <= 0:
            return None
        out_ = []
        for col, label in cols_labels:
            v = num(row.get(col))
            out_.append({"label": label, "ratio": round((v or 0) / total, 4)})
        return out_

    res, res_asof = latest_rows(res_p, "TOT_REPOP_CO")
    wrk, wrk_asof = latest_rows(wrk_p, "TOT_WRC_POPLTN_CO")

    by = doc["bySangwon"]
    n_res = n_wrk = 0
    codes = set(by) | {str(c) for c in res.index} | {str(c) for c in wrk.index}
    for code in codes:
        entry = by.setdefault(code, {})
        icode = int(code)
        if icode in res.index:
            r = res.loc[icode]
            total = num(r["TOT_REPOP_CO"])
            entry["resident"] = {
                "total": int(total) if total is not None else None,
                "byGender": dist(r, [("ML_REPOP_CO", "남성"), ("FML_REPOP_CO", "여성")], total),
                "byAge": dist(r, [(f"AGRDE_{a}_REPOP_CO", lb) for a, lb in AGE_LABELS], total),
                "asOf": res_asof,
            }
            # 가구 블록 (2026-08-06) — 같은 상주인구 데이터셋의 TOT_HSHLD_CO.
            # 구판 "총 가구 수는 없다"(unavailable)는 **아파트-상권 데이터셋** 기준
            # 서술이었다. 상주인구-상권에는 총 가구가 있다.
            #
            # ⚠️ 아파트/비아파트 **분해는 내보내지 않는다** — 원본 실측 결과
            # APT_HSHLD_CO 가 전 분기(21개)·전 상권(1,633) 에서 0 이고
            # NON_APT_HSHLD_CO = TOT_HSHLD_CO 복사다 (컬럼은 있으나 값 미제공).
            # 이걸 내보내면 아파트 밀집 상권에 "아파트 0%" 라는 거짓이 표시된다.
            # 아파트 세대수는 아파트-상권 데이터셋(apartment 블록)이 진짜 값을 갖는다.
            hh_total = num(r.get("TOT_HSHLD_CO"))
            entry["household"] = ({
                "total": int(hh_total),
                "apt": None,
                "nonApt": None,
                "asOf": res_asof,
            } if hh_total is not None else None)
            n_res += 1
        else:
            entry["resident"] = None
            entry["household"] = None
        if icode in wrk.index:
            w = wrk.loc[icode]
            total = num(w["TOT_WRC_POPLTN_CO"])
            entry["worker"] = {
                "total": int(total) if total is not None else None,
                "byAge": dist(w, [(f"AGRDE_{a}_WRC_POPLTN_CO", lb) for a, lb in AGE_LABELS], total),
                "asOf": wrk_asof,
            }
            n_wrk += 1
        else:
            entry["worker"] = None

    doc["asOf"]["resident"] = res_asof
    doc["asOf"]["worker"] = wrk_asof
    doc["asOf"]["household"] = res_asof
    # 가구 수가 제공되므로 '제공하지 않는 항목'에서 제거한다.
    # (아파트-상권 기준의 옛 사유가 남아 있으면 화면이 "없다"고 거짓말을 하게 된다)
    doc["unavailable"] = [u for u in doc.get("unavailable", [])
                          if "가구" not in str(u.get("item", ""))]
    # 출처: 상주·직장만 모델 저장소 표기로 교체, 나머지는 유지
    kept = [s for s in doc.get("sources", [])
            if "상주인구" not in s and "직장인구" not in s]
    doc["sources"] = [
        f"서울 열린데이터광장 상권분석서비스 — 상주인구-상권 ({res_asof}, Commercial-AI-/data/raw API 수집본)",
        f"서울 열린데이터광장 상권분석서비스 — 직장인구-상권 ({wrk_asof}, Commercial-AI-/data/raw API 수집본)",
    ] + kept

    n_hh = sum(1 for e in by.values() if e.get("household"))
    write_json_gz(gz_path, doc)
    return {"resident": n_res, "worker": n_wrk, "household": n_hh,
            "asOf": f"{res_asof}/{wrk_asof}", "sangwons": len(by)}


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

    # ---- 업종별 예측 오차(SMAPE) — 성적표(model_metadata.json)의 test_breakdown ----
    # "이 업종에서 모델이 평균 몇 % 틀리는지"를 리포트에 그대로 노출한다 (투명성).
    # 예측값이 아니라 채점 결과이므로 계보 분류는 '모델 채점'이다.
    acc_by_industry: dict[str, dict] = {}
    meta_p = os.path.join(repo, "models", "model_metadata.json")
    if os.path.exists(meta_p):
        with open(meta_p, encoding="utf-8") as f:
            mmeta = json.load(f)
        for a in (mmeta.get("test_breakdown", {}) or {}).get("by_industry") or []:
            nm = a.get("서비스_업종_코드_명")
            if nm and a.get("SMAPE") is not None:
                acc_by_industry[nm] = {
                    "smapePct": round(float(a["SMAPE"]), 1),
                    "sampleN": int(a["n"]) if a.get("n") is not None else None,
                    "lowSample": bool(a.get("low_sample", False)),
                }
        print(f"      업종별 예측오차(test SMAPE) {len(acc_by_industry)}개 업종 로드")
    else:
        print("      ⚠️ model_metadata.json 없음 — revenue.accuracy 생략")

    # ---- 상권유형별 예측 오차 (이중 신뢰도: "이 업종 ±a% · 이 유형 상권 ±b%") ----
    acc_by_type: dict[str, dict] = {}
    if os.path.exists(meta_p):
        for a in (mmeta.get("test_breakdown", {}) or {}).get("by_commercial_type") or []:
            nm = a.get("상권_유형")
            if nm and a.get("SMAPE") is not None:
                acc_by_type[nm] = {
                    "typeLabel": nm,
                    "typeSmapePct": round(float(a["SMAPE"]), 1),
                    "typeSampleN": int(a["n"]) if a.get("n") is not None else None,
                    "typeLowSample": bool(a.get("low_sample", False)),
                }

    # ---- 종합진단 가중치 — scoring_weights.yaml 이 유일한 정본 (산식 분산 금지) ----
    # 성분 점수는 전부 '동일 업종 내 백분위(0~100)'. overall = Σ가점 − Σ감점 을 0~100 재척도.
    # config 키 → (서빙 컬럼, 한글 라벨)
    _COMP_MAP = {
        "sales_potential_score": ("sales_potential_score", "매출 잠재력"),
        "growth_score": ("growth_score", "성장성"),
        "demand_score": ("demand_score", "수요(유동 밀도)"),
        "competition_score": ("competition_score", "경쟁 여유도"),
        "safety_score": ("score_safety_gu", "자치구 안전"),
        "closure_risk_score": ("closure_risk_score", "폐업 위험"),
        "rent_burden_score": ("score_rent_burden", "임대료 부담"),
        "vacancy_risk_score": ("score_vacancy_risk", "공실 위험"),
        "price_rise_risk_score": ("score_price_rise_risk", "임대료 상승 위험"),
    }
    diag_components: list[tuple[str, str, str, float, str]] = []  # (col, key, label, weight, direction)
    diag_note = None
    weights_p = os.path.join(repo, "config", "scoring_weights.yaml")
    if os.path.exists(weights_p):
        try:
            import yaml
            with open(weights_p, encoding="utf-8") as f:
                wcfg = yaml.safe_load(f)
            od = wcfg.get("overall_diagnosis", {})
            for direction in ("positive", "negative"):
                for key, w in (od.get(direction) or {}).items():
                    if key in _COMP_MAP:
                        col, label = _COMP_MAP[key]
                        diag_components.append((col, key, label, float(w), direction))
            diag_note = ("성분은 동일 업종 내 백분위(0~100)이며, 종합점수는 가점 합 − 감점 합을 "
                         "0~100으로 재척도한 값입니다. 가중치는 서비스 정책값(scoring_weights.yaml)으로 "
                         "통계적으로 검증된 사실이 아닙니다.")
            print(f"      종합진단 성분 {len(diag_components)}개 로드 (scoring_weights.yaml)")
        except Exception as e:
            print(f"      ⚠️ scoring_weights.yaml 로드 실패 — diagnosis 성분 생략: {e}")

    def _json_list(v) -> list | None:
        if isinstance(v, str) and v.startswith("["):
            try:
                out_ = json.loads(v)
                return [str(x) for x in out_] if isinstance(out_, list) else None
            except json.JSONDecodeError:
                return None
        return None

    def diagnosis_block(r) -> dict | None:
        """서빙 종합진단 → 리포트 ① 점수 분해 카드. 규칙·통계이며 ML 예측이 아니다."""
        overall = num(getattr(r, "overall_score", None))
        if overall is None:
            return None
        comps = []
        for col, key, label, w, direction in diag_components:
            s = num(getattr(r, col, None))
            if s is not None:
                comps.append({"key": key, "label": label, "score": round(s, 1),
                              "weight": w, "direction": direction})
        return {
            "overallScore": round(overall, 1),
            "grade": (r.grade if isinstance(r.grade, str) else None),
            "components": comps or None,
            "strengths": _json_list(getattr(r, "strengths", None)),
            "risks": _json_list(getattr(r, "risks", None)),
            "note": diag_note,
        }

    # ---- 밀도·임대 비교 기준 (자치구·서울 중앙값) ----
    # golmok 벤치마크: 밀도/임대는 "값 + 자치구·서울 대비"를 함께 보여야 해석이 된다
    # (2026-08-05 실측 — docs/BENCHMARK-golmok.md §3). 값만 주면 높은지 낮은지 알 수 없다.
    # 상권 단위 지표라 상권 중복을 제거하고 집계한다 (업종 행마다 같은 값이 반복되므로).
    _dens_cols = {
        "footTrafficPerKm2": "foot_traffic_density_km2",
        "residentPerKm2": "resident_density_km2",
        "workerPerKm2": "worker_density_km2",
    }
    _sw_uniq = sv.drop_duplicates("상권_코드")
    density_seoul = {k: num(_sw_uniq[c].median()) for k, c in _dens_cols.items() if c in _sw_uniq}
    density_gu = {}
    for gu_name, g in _sw_uniq.groupby("자치구_코드_명"):
        density_gu[gu_name] = {k: num(g[c].median()) for k, c in _dens_cols.items() if c in g}
    # 행정동 중앙값 — 4단 비교(서울/구/동/상권)의 동 층 (golmok 은 4단, 우리는 3단이었다).
    # 키는 코드 — 신사동이 서울에 두 곳이다 (rankings byDong 과 같은 이유).
    density_dong = {}
    for dong_code, g in _sw_uniq.groupby("행정동_코드"):
        density_dong[int(dong_code)] = {
            **{k: num(g[c].median()) for k, c in _dens_cols.items() if c in g},
            "n": int(len(g)),  # 동 안의 상권 수 — 1개면 자기 자신과의 비교라 UI 가 숨긴다
        }
    rent_seoul = num(_sw_uniq["re_rent_per_m2"].median()) if "re_rent_per_m2" in _sw_uniq else None
    print(f"      비교 기준: 밀도 서울중앙값 {len(density_seoul)}종 · 자치구 {len(density_gu)}개"
          f" · 행정동 {len(density_dong)}개 · 임대 서울중앙값 {rent_seoul}")

    def density_block(r) -> dict | None:
        """인구 밀도 3종 (명/km², 상권 영역 면적 기준) — 실측 ÷ 면적 단순 환산.

        자치구·서울 중앙값을 함께 실어 UI 가 '높다/낮다'를 말할 수 있게 한다.
        (평균이 아니라 중앙값 — 밀도 분포가 극단값에 크게 휘어 있다)
        """
        vals = {
            "footTrafficPerKm2": num(getattr(r, "foot_traffic_density_km2", None)),
            "residentPerKm2": num(getattr(r, "resident_density_km2", None)),
            "workerPerKm2": num(getattr(r, "worker_density_km2", None)),
        }
        if all(v is None for v in vals.values()):
            return None
        area = num(getattr(r, "영역_면적", None))
        vals["areaKm2"] = round(area / 1_000_000, 4) if area else None
        vals["guName"] = r.자치구_코드_명
        vals["guMedian"] = density_gu.get(r.자치구_코드_명)
        # 행정동 층 (4단 비교). 동 안에 상권이 자기뿐이면(n=1) 중앙값 = 자기 자신이라
        # 비교 정보가 없다 — None 으로 내보내 UI 가 동 층을 조용히 생략하게 한다.
        _dc = num(getattr(r, "행정동_코드", None))
        _dm = density_dong.get(int(_dc)) if _dc is not None else None
        vals["dongName"] = str(getattr(r, "행정동_코드_명", "")) or None
        vals["dongMedian"] = ({k: v for k, v in _dm.items() if k != "n"}
                              if _dm and _dm.get("n", 0) >= 2 else None)
        vals["seoulMedian"] = density_seoul or None
        return vals

    def realestate_block(r) -> dict | None:
        """R-ONE 임대 지표 — 자치구 평균(gu_mean) 조인. 상권 단위 실측이 아님을 캡션에 명시.

        ⚠️ 값 자체가 이미 자치구 평균이므로 '자치구 대비'는 무의미하다 (자기 자신).
           서울 중앙값 대비만 제공한다.
        """
        rent = num(getattr(r, "re_rent_per_m2", None))
        if rent is None:
            return None
        method = getattr(r, "re_join_method", None)
        return {
            "rentPerM2KRW": rent,
            "vacancyRate": num(getattr(r, "re_vacancy_rate", None)),        # 0~1
            "rentIndex": num(getattr(r, "re_rent_index", None)),            # 기준 100
            "rentIndexYoy": num(getattr(r, "re_rent_index_yoy", None)),     # 비율 (0.006 = +0.6%)
            "seoulMedianRentPerM2KRW": rent_seoul,
            "joinMethod": method if isinstance(method, str) else None,
            "basis": "한국부동산원 R-ONE 소규모 상가 임대동향 — 자치구 평균값 조인 (상권 단위 실측 아님)",
        }

    def independent_block(r) -> dict | None:
        """서빙 indep_* → detail.independent (독립점포 관점 매출 — 통계 추정, ML 예측 아님).

        k = 프랜차이즈 1곳이 독립점포 몇 곳 몫을 파는지 (S ~ a·N + b·F 의 b/a, NNLS).
        kSource:
          - industry_fit  : 품질 게이트(표본·R²·시간 안정성) 통과 업종 — estimatedSalesKRW 제공
          - scenario_only : 미통과 업종 — 고정 k 시나리오만 제공 (값을 지어내지 않는다)
        금액 단위는 detail.sales.perStoreKRW 와 동일 (분기·점포당, 실측 기반).
        """
        src = getattr(r, "indep_k_source", None)
        if not isinstance(src, str) or not src:
            return None
        scen = None
        raw_scen = getattr(r, "indep_sales_scenarios", None)
        if isinstance(raw_scen, str) and raw_scen:
            try:
                scen = [{"k": float(k.split("=", 1)[1]), "salesKRW": num(v)}
                        for k, v in json.loads(raw_scen).items()]
            except (ValueError, json.JSONDecodeError):
                scen = None
        is_pure = getattr(r, "indep_is_pure", None)
        out_ = {
            "kSource": src,
            "isPure": bool(is_pure) if is_pure is not None and is_pure == is_pure else None,
            "onlyPercentile": num(getattr(r, "indep_only_percentile", None)),
            "peerCount": num(getattr(r, "indep_peer_count", None)),
            "peerMedianSalesKRW": num(getattr(r, "indep_peer_median_sales", None)),
            "scenarios": scen,
            "kUsed": num(getattr(r, "indep_k_used", None)),
            "kFitR2": num(getattr(r, "indep_k_fit_r2", None)),
            "kSampleSize": num(getattr(r, "indep_k_sample_size", None)),
            "estimatedSalesKRW": (num(getattr(r, "indep_estimated_sales", None))
                                  if src == "industry_fit" else None),
            "basis": "서울 관측 데이터 내부 회귀(NNLS) 추정 — 통계 가공, ML 예측 아님",
        }
        return out_

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
              "행정동_코드_명", "center_lat", "center_lon", "영역_면적"]]
          .drop_duplicates("상권_코드").sort_values("상권_코드"))
    with open(os.path.join(out, "meta", "sangwons.json"), "w", encoding="utf-8") as f:
        json.dump({"dataAsOf": data_as_of,
                   "sangwons": [{"code": int(r.상권_코드), "name": r.상권_코드_명,
                                 "category": r.상권_구분_코드_명, "gu": r.자치구_코드_명,
                                 "dong": r.행정동_코드_명,
                                 "lat": num(r.center_lat), "lon": num(r.center_lon),
                                 # 상권 영역 면적(m²) — 경계 폴리곤은 원천에 없어
                                 # 지도에서 등면적 원(√(A/π))으로 근사 표시한다
                                 "areaM2": num(r.영역_면적)}
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
    # 치안: 모델 저장소 원본 + 서빙 score_safety_gu → ⑥ 카드 상세 + 토글 점수 (한 소스)
    try:
        safety_by_gu, safety_scores_meta = load_safety_by_gu(repo, sv)
        with open(os.path.join(out, "meta", "safety-scores.json"), "w", encoding="utf-8") as f:
            json.dump(safety_scores_meta, f, ensure_ascii=False, indent=1)
    except Exception as e:  # 원본 CSV 미보유 환경 — 치안 없이도 나머지는 내보낸다
        safety_by_gu = {}
        print(f"      ⚠️ 치안 생략 (data/raw/external/ 없음?): {e}")

    # 상권 지표 랭킹 재료 (golmok '뜨는 상권' 대응 — build_rankings 주석 참조)
    rank = build_rankings(sales, pop, store, sv, repo, out)
    print(f"      랭킹: 상권 {rank['sangwons']:,} · 행정동 {rank['dongs']:,} · asOf {rank['asOf']}")

    # 배후지: 상주·직장인구 블록을 모델 저장소 CSV 로 교체 (rebuild_hinterland 주석 참조)
    hint = rebuild_hinterland(repo, out)
    hint_note = (f"배후지 상주 {hint['resident']:,}·직장 {hint['worker']:,}"
                 f"·가구 {hint['household']:,} ({hint['asOf']})"
                 if hint else "배후지 생략 (인구 CSV 미보유)")

    print(f"      업종 {len(inds)} · 상권 {len(sw)} · 폐업률 사전표 {len(ind_prior)}"
          f" · 치안 자치구 {len(safety_by_gu)} · {hint_note}")

    # ================= heatmap / analyze / by-sangwon =================
    print("[6/6] heatmap · analyze · by-sangwon 작성")
    by_sangwon: dict[str, dict] = {}
    n_cells = n_records = 0

    for ind_code, grp in sv.groupby("서비스_업종_코드"):
        ind_name = grp["서비스_업종_코드_명"].iloc[0]
        cells, records = [], {}

        # 극단값 안내 재료 (2026-08-07, 삼성중앙역 5번 한식 11.4억/8점포 케이스).
        # 좁은 상권은 점포 몇 개 평균이라 대형 사업장 하나에 값이 폭등한다 —
        # 모델·라벨 문제가 아니라 원천 실측의 소표본 함정이며, 화면이 스스로
        # 설명하게 판정 재료(업종 중앙값·경고문)를 여기(가공층)서 만들어 보낸다.
        _preds = pd.to_numeric(grp["predicted_sales_per_store"], errors="coerce")
        ind_median_pred = num(_preds.median())
        _stores = pd.to_numeric(grp["전체_점포_수"], errors="coerce")
        ind_median_stores = num(_stores.median())

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
                    # 모델 저장소 원본(자치구 범죄·CCTV) 기준 — load_safety_by_gu() 주석 참조
                    "safety": safety_by_gu.get(r.자치구_코드_명),
                    # 독립점포 관점 매출 (v2 신규, 통계 추정) — independent_block() 주석 참조
                    "independent": independent_block(r),
                    # v2 신규: R-ONE 임대 지표 (자치구 평균 조인 — realestate_block() 주석 참조)
                    "realEstate": realestate_block(r),
                }

            records[str(code)] = {
                "status": "ok" if ok else "insufficient_data",
                "sangwon": {"code": code, "name": r.상권_코드_명, "gu": r.자치구_코드_명,
                            "dong": r.행정동_코드_명,
                            "lat": num(r.center_lat), "lon": num(r.center_lon),
                            # v2 신규: 상권 유형 5종 (규칙 기반 분류 — 상주·직장·유동 백분위)
                            "type": (r.상권_유형 if isinstance(r.상권_유형, str) else None),
                            "typeBasis": (r.상권_유형_근거
                                          if isinstance(r.상권_유형_근거, str) else None)},
                "industry": {"code": ind_code, "name": ind_name},
                "survival": ({"probability": surv, "horizonYears": 3,
                              "basis": "empirical_closure_rate_shrunk",
                              "granularity": "sangwon_industry",
                              "quarterlyClosureRatePct": round(shrunk_rate_v * 100, 4),
                              "observedQuarterlyClosureRatePct": num(r.폐업_률)}
                             if ok and surv is not None else None),
                "revenue": ({"monthlyEstimateKRW": pred,
                             "percentileAmongSangwons": num(r.sales_percentile),
                             "basis": "per_store_predicted",
                             # 해석 기준: 동일 업종 서울 중앙값(점포당 예측) — 값만 주면
                             # 11억이 큰지 작은지 알 수 없다 (밀도·임대와 같은 패턴)
                             "industryMedianKRW": ind_median_pred,
                             # 소표본 극단값 경고 — 중앙값 10배 이상 + 점포 수가 업종
                             # 중앙값 이하일 때만. 문구는 여기서 주입 (UI 하드코딩 금지)
                             "extremeNote": (
                                 (f"동일 업종 서울 중앙값의 {pred / ind_median_pred:.0f}배입니다. "
                                  f"점포 {int(total_stores)}개 평균이라 소수 대형 사업장의 "
                                  "영향일 수 있습니다 — 개별 점포의 기대 매출로 읽지 마세요.")
                                 if (pred is not None and ind_median_pred
                                     and pred >= ind_median_pred * 10
                                     and total_stores is not None and ind_median_stores
                                     and total_stores <= ind_median_stores)
                                 else None),
                             # v2 신규: 업종별 + 상권유형별 test 오차 (채점 결과, 이중 신뢰도)
                             "accuracy": ({**acc_by_industry.get(ind_name, {}),
                                           **(acc_by_type.get(r.상권_유형, {})
                                              if isinstance(r.상권_유형, str) else {})}
                                          or None) if acc_by_industry.get(ind_name) else None}
                            if ok and pred is not None else None),
                "context": ({
                    "footTraffic": {
                        "total": num(prow.get("TOT_FLPOP_CO")) if prow is not None else None,
                        "friday": num(prow.get("FRI_FLPOP_CO")) if prow is not None else None,
                        "saturday": num(prow.get("SAT_FLPOP_CO")) if prow is not None else None,
                    },
                    "competition": {"storeCount": total_stores, "franchiseRatio": ratio,
                                    "granularity": "sangwon_industry",
                                    # v2 신규: 시장 단계 (개업률·폐업률·점포수 증감 규칙 —
                                    # diagnosis.py market_stage(), 8/3 퍼센트 스케일 버그 수정본)
                                    "marketStage": (r.market_stage
                                                    if isinstance(r.market_stage, str) else None)},
                    "demographics": [{"ageBand": k, "ratio": v} for k, v in
                                     json.loads(r.age_distribution).items()]
                    if isinstance(r.age_distribution, str) else [],
                    # v2 신규: 인구 밀도 3종 (명/km², 상권 영역 기준)
                    "density": density_block(r),
                } if ok else None),
                "narrative": ({"summary": r.recommendation, "generator": "rule_based"}
                              if ok and isinstance(r.recommendation, str) else None),
                # v2 신규: 종합진단 분해 (점수 성분·등급·강점/리스크) — diagnosis_block() 주석 참조
                "diagnosis": (diagnosis_block(r) if ok else None),
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
                                "type": (r.상권_유형 if isinstance(r.상권_유형, str) else None),
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
    print("\nℹ️ 예상 매출은 '점포당 예측값'입니다 (revenue.basis=per_store_predicted).")
    print("   프랜차이즈 포함 전체 점포 평균이므로 독립 점포의 실제 매출과는 다를 수 있습니다.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

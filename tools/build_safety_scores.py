# -*- coding: utf-8 -*-
"""
build_safety_scores.py — 자치구 안전 종합점수 산출 (model-exports/meta/safety-scores.json)

'치안 반영' 토글의 실데이터 소스를 만든다. 이 파일이 없으면 웹은 자동으로
예시 데이터(sourceMode:"mock")로 폴백하므로, 스크립트는 데이터가 준비된 뒤 실행하면 된다.

산식 (모델 정본 Commercial-AI- config/scoring_weights.yaml 과 동일):
    안전점수 = 0.50×(1−범죄율 백분위) + 0.25×검거율 백분위 + 0.25×CCTV밀도 백분위
    (자치구 간 백분위, 0~100. min_components=2)

입력 (열린데이터광장 통계 CSV/XLSX — 멀티행 헤더 자동 감지):
  --crime  자치구별 5대 범죄 발생·검거 (데이터셋 ID 316. '발생'/'검거' 열 필요)
  --pop    자치구별 주민등록인구 (성별 '합계' 행 사용)
  --cctv   자치구별 CCTV 설치 대수 (선택 — 없으면 CCTV 성분 제외).
           연도별 열이 여러 개면 가장 최근 연도 열을 자동 선택한다
  --area   자치구별 면적 km² CSV (선택 — 없으면 내장 행정구역 면적 상수 사용)

⚠️ 검거 수치는 발생을 초과할 수 있다(다른 기간 사건 검거·검거 인원 집계 등). 원본 그대로
   비율을 계산하고 자치구 간 백분위로만 쓰므로 순위에는 문제가 없으나, 이 값을 '검거율'로
   화면에 직접 표시하지는 말 것.

사용 예:
  python tools/build_safety_scores.py \
      --crime ../seoul-startup-opportunity-recommender/data/raw/crime_gu.csv \
      --pop   ../seoul-startup-opportunity-recommender/data/raw/gu_population.csv \
      --cctv  ../seoul-startup-opportunity-recommender/data/raw/cctv_gu.csv \
      --out   model-exports/meta/safety-scores.json
"""
from __future__ import annotations

import argparse
import json
import os

import pandas as pd

GUS = [
    "종로구", "중구", "용산구", "성동구", "광진구", "동대문구", "중랑구", "성북구", "강북구",
    "도봉구", "노원구", "은평구", "서대문구", "마포구", "양천구", "강서구", "구로구", "금천구",
    "영등포구", "동작구", "관악구", "서초구", "강남구", "송파구", "강동구",
]

# 서울 자치구 행정구역 면적(km²) — 서울시 행정구역 통계(2024) 고정값. --area 로 대체 가능.
GU_AREA_KM2 = {
    "종로구": 23.91, "중구": 9.96, "용산구": 21.87, "성동구": 16.82, "광진구": 17.06,
    "동대문구": 14.22, "중랑구": 18.50, "성북구": 24.58, "강북구": 23.60, "도봉구": 20.65,
    "노원구": 35.44, "은평구": 29.71, "서대문구": 17.63, "마포구": 23.85, "양천구": 17.41,
    "강서구": 41.45, "구로구": 20.12, "금천구": 13.02, "영등포구": 24.55, "동작구": 16.35,
    "관악구": 29.57, "서초구": 46.98, "강남구": 39.50, "송파구": 33.88, "강동구": 24.59,
}

# ⚠️ 산식 정본은 Commercial-AI-/config/scoring_weights.yaml 이다.
#    가중치를 바꾸면 (1) 그 YAML (2) 이 파일 (3) web-demo/lib/normalize.ts 의
#    computeSafetyScores(목업 경로) 를 함께 고칠 것. 아래 값은 출력 JSON 에도 기록되어
#    웹이 화면 문구를 그 값으로 만든다(문구 하드코딩 제거).
WEIGHTS = [
    ("crimeRatePer100k", 0.50, False),  # 인구 10만명당 5대범죄 발생률 — 낮을수록 안전
    ("arrestRate", 0.25, True),         # 검거/발생 비 — 원본 그대로 (1.0 초과 가능)
    ("cctvPerKm2", 0.25, True),         # 범죄예방 CCTV 밀도
]
MIN_COMPONENTS = 2

LABEL_KO = {
    "crimeRatePer100k": "범죄율(10만명당, 낮을수록↑)",
    "arrestRate": "검거 비율",
    "cctvPerKm2": "CCTV 밀도",
}

# 죄종별 발생 건수 — 리포트 ⑥ 섹션의 '죄종별 발생' 차트용.
# (원본 헤더 키워드, 표시 라벨). '강간·강제추행' 은 키워드 '강간' 으로 잡는다.
CRIME_TYPES = [("살인", "살인"), ("강도", "강도"), ("강간", "성범죄"),
               ("절도", "절도"), ("폭력", "폭력")]


def read_any(path: str, **kw) -> pd.DataFrame | None:
    """CSV(인코딩 자동) 또는 XLSX 를 헤더 없이 읽는다."""
    if path.lower().endswith((".xlsx", ".xlsm", ".xls")):
        return pd.read_excel(path, header=None, **kw)
    for enc in ["utf-8-sig", "utf-8", "cp949", "euc-kr"]:
        try:
            return pd.read_csv(path, encoding=enc, header=None, low_memory=False, **kw)
        except (UnicodeDecodeError, UnicodeError):
            continue
    return None


def parse_stat_table(path: str, label: str) -> tuple[pd.DataFrame, list[str]]:
    """멀티행 헤더 통계 CSV → (데이터 프레임, 합쳐진 헤더 라벨). 자치구명 등장 행부터 데이터."""
    df = read_any(path)
    if df is None or df.empty:
        raise SystemExit(f"[{label}] 읽기 실패: {path}")
    first_data = None
    for i in range(min(8, len(df))):
        row = [str(v).strip() for v in df.iloc[i].tolist()]
        if any(v in GUS for v in row):
            first_data = i
            break
    if first_data is None:
        raise SystemExit(f"[{label}] 자치구명을 찾지 못함 — 자치구별 표가 맞는지 확인: {path}")
    header = df.iloc[:first_data].fillna("").astype(str)
    labels = [" ".join(header[c].tolist()).strip() for c in df.columns]
    body = df.iloc[first_data:].reset_index(drop=True)
    return body, labels


def find_gu_col(body: pd.DataFrame) -> int:
    for j in range(len(body.columns)):
        if body[j].astype(str).str.strip().isin(GUS).sum() >= 10:
            return j
    raise SystemExit("자치구 컬럼을 찾지 못했습니다.")


def to_num(v) -> float | None:
    try:
        f = float(str(v).replace(",", "").strip())
        return f
    except (TypeError, ValueError):
        return None


def latest_year_filter(body: pd.DataFrame, labels: list[str]) -> tuple[pd.DataFrame, str]:
    """연도 열이 있으면 최신 연도만. 열 헤더가 연도(2024 등)로 갈라진 표는 그대로 둔다."""
    for j, lb in enumerate(labels):
        if any(k in lb for k in ("기간", "연도", "년도", "시점")):
            years = pd.to_numeric(body[j].astype(str).str.extract(r"(\d{4})")[0], errors="coerce")
            if years.notna().any():
                y = int(years.max())
                return body[years == y].reset_index(drop=True), str(y)
    # 헤더에서 연도 추출 (열 방향 연도 표)
    import re
    hdr_years = sorted({int(m.group(1)) for lb in labels for m in [re.search(r"(20\d{2})", lb)] if m})
    return body, str(hdr_years[-1]) if hdr_years else "unknown"


def pick_latest_year_col(labels: list[str], exclude: set[int] = frozenset()) -> tuple[int, str] | None:
    """
    라벨에 연도(20xx)가 박힌 열 중 **가장 최근 연도** 열을 고른다.
    연도별 열이 나열된 표(예: CCTV 2015~2025)에서 키워드 매칭이 헤더 문구
    ('단위 : 대' 등)에 걸려 순번 열을 집는 사고를 막기 위한 선택자.
    """
    import re

    best: tuple[int, int] | None = None
    for j, lb in enumerate(labels):
        if j in exclude:
            continue
        years = [int(y) for y in re.findall(r"(20\d{2})", lb)]
        if not years:
            continue
        y = max(years)
        if best is None or y > best[1]:
            best = (j, y)
    return (best[0], str(best[1])) if best else None


def pick_col(labels: list[str], must: list[str], prefer: list[str] | None = None,
             latest_year: str | None = None) -> int | None:
    """키워드가 모두 포함된 열 중 (최신 연도 라벨 →) prefer 키워드 우선으로 선택."""
    cands = [j for j, lb in enumerate(labels) if all(k in lb for k in must)]
    if latest_year:
        y = [j for j in cands if latest_year in labels[j]]
        cands = y or cands
    if prefer:
        for p in prefer:
            hit = [j for j in cands if p in labels[j]]
            if hit:
                return hit[0]
    return cands[0] if cands else None


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--crime", required=True)
    ap.add_argument("--pop", required=True)
    ap.add_argument("--cctv")
    ap.add_argument("--area")
    ap.add_argument("--out", default="model-exports/meta/safety-scores.json")
    args = ap.parse_args()

    # ---- 범죄 (발생·검거) ----
    body, labels = parse_stat_table(args.crime, "crime")
    body, year = latest_year_filter(body, labels)
    gu_col = find_gu_col(body)
    occ_col = pick_col(labels, ["발생"], latest_year=year) or pick_col(labels, ["합계"])
    arr_col = pick_col(labels, ["검거"], latest_year=year)
    if occ_col is None:
        raise SystemExit("[crime] '발생' 열을 찾지 못했습니다.")
    # 죄종별 '발생' 열 (없으면 해당 죄종 생략)
    type_cols = {label: pick_col(labels, [kw, "발생"], latest_year=year)
                 for kw, label in CRIME_TYPES}

    crime: dict[str, dict] = {}
    for _, r in body.iterrows():
        gu = str(r[gu_col]).strip()
        if gu not in GUS:
            continue
        occ = to_num(r[occ_col])
        arr = to_num(r[arr_col]) if arr_col is not None else None
        # 같은 구가 여러 행(죄종별)이면 합산
        slot = crime.setdefault(gu, {"occ": 0.0, "arr": 0.0, "has_arr": False, "types": {}})
        if occ is not None:
            slot["occ"] += occ
        if arr is not None:
            slot["arr"] += arr
            slot["has_arr"] = True
        for _kw, label in CRIME_TYPES:
            col = type_cols.get(label)
            if col is None:
                continue
            v = to_num(r[col])
            if v is not None:
                slot["types"][label] = slot["types"].get(label, 0.0) + v

    # ---- 인구 ----
    pbody, plabels = parse_stat_table(args.pop, "pop")
    pgu = find_gu_col(pbody)
    sex_col = None
    for j in range(len(pbody.columns)):
        vals = set(str(v).strip() for v in pbody[j].dropna().tolist()[:80])
        if j != pgu and vals and vals <= {"합계", "남자", "여자", "계", "남", "여", "nan", ""}:
            sex_col = j
            break
    pop_col = pick_col(plabels, ["합계"]) or (pgu + 1 if sex_col is None else sex_col + 1)
    pop: dict[str, float] = {}
    for _, r in pbody.iterrows():
        gu = str(r[pgu]).strip()
        if gu not in GUS:
            continue
        if sex_col is not None and str(r[sex_col]).strip() not in ("합계", "계"):
            continue
        v = to_num(r[pop_col])
        if v and v > 10_000:
            pop[gu] = v

    # ---- CCTV (선택) ----
    cctv: dict[str, float] = {}
    cctv_year: str | None = None
    if args.cctv and os.path.exists(args.cctv):
        cbody, clabels = parse_stat_table(args.cctv, "cctv")
        cgu = find_gu_col(cbody)
        # 연도별 누적 열이 나열된 형태 → 최신 연도 열. 없으면 키워드로 폴백.
        picked = pick_latest_year_col(clabels, exclude={cgu})
        if picked:
            cnt_col, cctv_year = picked
        else:
            cnt_col = pick_col(clabels, ["CCTV"]) or pick_col(clabels, ["합계"])
        for _, r in cbody.iterrows():
            gu = str(r[cgu]).strip()
            if gu not in GUS:
                continue
            v = to_num(r[cnt_col]) if cnt_col is not None else None
            if v:
                cctv[gu] = cctv.get(gu, 0.0) + v
        if len(cctv) < 20:
            print(f"  [경고] CCTV 자치구 {len(cctv)}개만 파싱됨 — CCTV 성분을 제외하고 계속합니다")
            cctv, cctv_year = {}, None

    area = dict(GU_AREA_KM2)
    if args.area and os.path.exists(args.area):
        abody, alabels = parse_stat_table(args.area, "area")
        agu = find_gu_col(abody)
        acol = pick_col(alabels, ["면적"])
        for _, r in abody.iterrows():
            gu = str(r[agu]).strip()
            v = to_num(r[acol]) if acol is not None else None
            if gu in GUS and v:
                area[gu] = v

    # ---- 지표 → 백분위 가중합 ----
    raw: dict[str, dict[str, float | None]] = {}
    for gu in GUS:
        c = crime.get(gu)
        if not c or not pop.get(gu):
            continue
        raw[gu] = {
            "crimeRatePer100k": round(c["occ"] / pop[gu] * 100_000, 1),
            "arrestRate": round(c["arr"] / c["occ"], 4) if (c["has_arr"] and c["occ"]) else None,
            "cctvPerKm2": round(cctv[gu] / area[gu], 1) if (cctv.get(gu) and area.get(gu)) else None,
        }

    def pct(vals: list[float], v: float) -> float:
        below = sum(1 for x in vals if x < v)
        equal = sum(1 for x in vals if x == v)
        return (below + equal * 0.5) / len(vals)

    # 발생 건수 통계 (리포트 ⑥ 타일용) — 발생 적은 순 순위·서울 평균
    occ_by_gu = {gu: crime[gu]["occ"] for gu in raw if crime.get(gu)}
    occ_vals = sorted(occ_by_gu.values())
    seoul_avg = round(sum(occ_vals) / len(occ_vals), 1) if occ_vals else None

    by_gu = {}
    for gu, r in raw.items():
        acc = wsum = comp = 0.0
        for key, w, higher in WEIGHTS:
            v = r[key]
            if v is None:
                continue
            vals = [x[key] for x in raw.values() if x[key] is not None]
            if len(vals) < 2:
                continue
            p = pct(vals, v)  # type: ignore[arg-type]
            if not higher:
                p = 1 - p
            acc += p * w
            wsum += w
            comp += 1
        if comp < MIN_COMPONENTS or wsum <= 0:
            continue
        occ = occ_by_gu.get(gu)
        types = crime[gu]["types"]
        by_gu[gu] = {
            **r,
            "score": round(acc / wsum * 100, 1),
            # ↓ 점수 성분이 아니라 화면 표시용 원본 집계
            "totalIncidents": int(round(occ)) if occ is not None else None,
            "byType": [{"label": lb, "count": int(round(types[lb]))}
                       for _kw, lb in CRIME_TYPES if lb in types] or None,
            "rankAmongGus": (1 + sum(1 for x in occ_vals if x < occ)) if occ is not None else None,
            "guCount": len(occ_vals) or None,
            "seoulAvgIncidents": seoul_avg,
        }

    if len(by_gu) < 20:
        raise SystemExit(f"자치구 {len(by_gu)}개만 산출됨 — 입력 파일을 확인하세요.")

    used = [k for k, _w, _h in WEIGHTS if any(v.get(k) is not None for v in by_gu.values())]
    terms = " + ".join(
        f"{LABEL_KO[k]} {int(w * 100)}%" for k, w, _h in WEIGHTS if k in used
    )
    weights_note = (
        f"안전점수 = {terms} — 자치구 간 백분위 가중합(0~100). "
        "가중치는 서비스 정책값이며 통계적으로 검증된 사실이 아닙니다."
    )
    sources = [f"서울 열린데이터광장 — 자치구별 5대 범죄 발생·검거 ({year})",
               "서울 열린데이터광장 — 자치구별 주민등록인구"]
    if cctv_year:
        sources.append(f"서울시 — 자치구 범죄예방 CCTV 설치현황 ({cctv_year})")

    out = {
        "year": year,
        "cctvYear": cctv_year,
        # 웹이 화면 문구를 이 값으로 만든다 (UI 하드코딩 금지 — 산식이 갈라지는 것을 막는다)
        "weights": {k: {"weight": w, "higherBetter": h} for k, w, h in WEIGHTS if k in used},
        "minComponents": MIN_COMPONENTS,
        "weightsNote": weights_note,
        "sources": sources,
        "byGu": by_gu,
    }
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    # 콘솔 인코딩(cp949)에서 깨지지 않도록 ASCII 기호만 사용
    print(f"OK: {args.out} / gu={len(by_gu)} crime_year={year} "
          f"cctv={cctv_year or 'none'} components={len(used)}")


if __name__ == "__main__":
    main()

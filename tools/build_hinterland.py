# -*- coding: utf-8 -*-
"""
build_hinterland.py — 상권 배후지 실측 산출 (model-exports/meta/hinterland.json.gz)

리포트 ⑦ '배후지 분석' 을 목업(lib/mockExtras.ts) 에서 실데이터로 바꾸기 위한 산출물.
`build_safety_scores.py` 와 같은 패턴이다 — 이 파일이 있으면 웹이 실측을 쓰고,
없으면 목업 배지로 폴백한다.

입력 (서울 열린데이터광장 상권분석서비스, data/raw/):
  --resident   상주인구-상권   (OA-15584)
  --worker     직장인구-상권   (OA-15569)
  --apartment  아파트-상권     (OA-15566)
  --facility   집객시설-상권   (OA-15580)
  --income     소득소비-상권배후지 (OA-15571) — 선택

기준 분기(as-of): 파일마다 **값이 있는 가장 최근 분기**를 각각 고르고 그 분기를 함께 기록한다.
분기를 하나로 강제하지 않는 이유 —

  · 상주/직장/아파트/집객시설: 2026Q1 까지 값이 있다
  · 소득소비(지출): **2023Q4 이후 값이 비어 있다** (원본 미공개. 행은 있고 금액이 NaN)

한 분기로 맞추면 최신 4종을 2023Q4 로 끌어내리거나 지출을 버려야 한다. 그래서 항목별
as-of 를 쓰고, **각 블록에 기준 분기를 표기**한다(혼합 빈티지를 숨기지 않는다).

⚠️ 이 데이터셋에 **없어서 리포트에서 뺀 항목**:
  · 소득 분위 — 이 파일에는 소득이 아니라 '지출 금액' 만 있다 (`지출_총금액` + 카테고리 9종).
    golmok 의 '소득수준 N분위' 는 다른 소스다. 없는 값을 목업으로 채우지 않기로 했다
  · 총 가구 수 — 아파트 세대수만 있어 전체 가구를 알 수 없다
  · 임대시세 — 한국부동산원 R-ONE 별도. 정본 파이프라인(`re_*`)은 있으나 값 미보유

⚠️ 소비지출의 ML 편입은 보류다. sales.csv(2025Q1~2026Q1)와 income 값 구간(2021Q1~2023Q4)이
   **겹치는 분기가 0개**라 타깃 누출 여부를 검증할 방법이 없다. 표시용으로만 쓴다.
"""
from __future__ import annotations

import argparse
import gzip
import json
import os

import pandas as pd

ENCS = ["utf-8-sig", "utf-8", "cp949", "euc-kr"]
QCOL = "기준_년분기_코드"
KEY = "상권_코드"

# 집객시설 — 원본 컬럼 → 표시 라벨. 상권에서 유의미한 것만 골라 묶는다.
FACILITY_MAP = [
    ("관공서_수", "관공서"),
    ("은행_수", "금융기관"),
    ("종합병원_수", "종합병원"),
    ("일반_병원_수", "병·의원"),
    ("약국_수", "약국"),
    ("초등학교_수", "초등학교"),
    ("중학교_수", "중학교"),
    ("고등학교_수", "고등학교"),
    ("대학교_수", "대학교"),
    ("백화점_수", "백화점"),
    ("슈퍼마켓_수", "슈퍼마켓"),
    ("극장_수", "극장"),
    ("숙박_시설_수", "숙박시설"),
    ("지하철_역_수", "지하철역"),
    ("버스_정거장_수", "버스정거장"),
    ("철도_역_수", "철도역"),
    ("버스_터미널_수", "버스터미널"),
]

# 소비지출 카테고리 — 원본 컬럼 → 표시 라벨
SPEND_MAP = [
    ("식료품_지출_총금액", "식료품"),
    ("의류_신발_지출_총금액", "의류·신발"),
    ("생활용품_지출_총금액", "생활용품"),
    ("의료비_지출_총금액", "의료비"),
    ("교통_지출_총금액", "교통"),
    ("여가_지출_총금액", "여가"),
    ("문화_지출_총금액", "문화"),
    ("교육_지출_총금액", "교육"),
    ("유흥_지출_총금액", "유흥"),
]

AGE_BANDS = ["10", "20", "30", "40", "50", "60_이상"]
AGE_LABELS = {"10": "10s", "20": "20s", "30": "30s", "40": "40s", "50": "50s", "60_이상": "60s+"}


def read_csv_any(path: str, usecols=None) -> pd.DataFrame:
    for enc in ENCS:
        try:
            return pd.read_csv(path, encoding=enc, usecols=usecols, low_memory=False)
        except (UnicodeDecodeError, UnicodeError):
            continue
    raise SystemExit(f"인코딩을 판별할 수 없습니다: {path}")


def quarter_label(yq: int) -> str:
    return f"{int(yq) // 10}Q{int(yq) % 10}"


def latest_quarter_with_values(df: pd.DataFrame, value_col: str) -> int | None:
    """value_col 에 실제 값이 있는 가장 최근 분기 (빈 행만 있는 분기는 건너뛴다)."""
    ok = df.dropna(subset=[value_col])
    if ok.empty:
        return None
    return int(ok[QCOL].max())


def num(v):
    try:
        f = float(v)
        return None if pd.isna(f) else f
    except (TypeError, ValueError):
        return None


def i(v):
    f = num(v)
    return int(round(f)) if f is not None else None


def ratio_slices(row, mapping, total_key=None) -> list | None:
    """[{label, ratio}] — 합 대비 비중. 합이 0/결측이면 None."""
    vals = [(lb, num(row.get(col))) for col, lb in mapping]
    vals = [(lb, v) for lb, v in vals if v is not None]
    total = num(row.get(total_key)) if total_key else None
    s = total if (total and total > 0) else sum(v for _, v in vals)
    if not s or s <= 0:
        return None
    return [{"label": lb, "ratio": round(v / s, 4)} for lb, v in vals]


def counts(row, mapping, top: int | None = None) -> list | None:
    out = [{"label": lb, "count": i(row.get(col))} for col, lb in mapping]
    out = [x for x in out if x["count"]]
    if not out:
        return None
    out.sort(key=lambda x: -x["count"])
    return out[:top] if top else out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--resident", required=True)
    ap.add_argument("--worker", required=True)
    ap.add_argument("--apartment", required=True)
    ap.add_argument("--facility", required=True)
    ap.add_argument("--income")
    ap.add_argument("--out", default="model-exports/meta/hinterland.json.gz")
    args = ap.parse_args()

    by_sangwon: dict[str, dict] = {}
    as_of: dict[str, str] = {}
    sources: list[str] = []

    def slot(code) -> dict:
        c = str(int(code))
        return by_sangwon.setdefault(c, {})

    # ---- 상주인구 (성별·연령 구성 포함) ----
    res = read_csv_any(args.resident)
    q = latest_quarter_with_values(res, "총_상주인구_수")
    if q:
        as_of["resident"] = quarter_label(q)
        sources.append(f"서울 열린데이터광장 상권분석서비스 — 상주인구-상권 ({quarter_label(q)})")
        for r in res[res[QCOL] == q].to_dict("records"):
            total = num(r.get("총_상주인구_수"))
            if not total:
                continue
            male, female = num(r.get("남성_상주인구_수")), num(r.get("여성_상주인구_수"))
            slot(r[KEY])["resident"] = {
                "total": i(total),
                "byGender": ([{"label": "남성", "ratio": round(male / total, 4)},
                              {"label": "여성", "ratio": round(female / total, 4)}]
                             if male is not None and female is not None else None),
                "byAge": ratio_slices(
                    r, [(f"연령대_{b}_상주인구_수", AGE_LABELS[b]) for b in AGE_BANDS],
                    total_key="총_상주인구_수"),
                "asOf": quarter_label(q),
            }

    # ---- 직장인구 ----
    wrk = read_csv_any(args.worker)
    q = latest_quarter_with_values(wrk, "총_직장_인구_수")
    if q:
        as_of["worker"] = quarter_label(q)
        sources.append(f"서울 열린데이터광장 상권분석서비스 — 직장인구-상권 ({quarter_label(q)})")
        for r in wrk[wrk[QCOL] == q].to_dict("records"):
            total = num(r.get("총_직장_인구_수"))
            if not total:
                continue
            slot(r[KEY])["worker"] = {
                "total": i(total),
                "byAge": ratio_slices(
                    r, [(f"연령대_{b}_직장_인구_수", AGE_LABELS[b]) for b in AGE_BANDS],
                    total_key="총_직장_인구_수"),
                "asOf": quarter_label(q),
            }

    # ---- 아파트 (세대수·평균시가·면적) ----
    apt = read_csv_any(args.apartment)
    q = latest_quarter_with_values(apt, "아파트_단지_수")
    if q:
        as_of["apartment"] = quarter_label(q)
        sources.append(f"서울 열린데이터광장 상권분석서비스 — 아파트-상권 ({quarter_label(q)})")
        size_cols = [c for c in apt.columns if c.startswith("아파트_면적_") and c.endswith("세대_수")]
        for r in apt[apt[QCOL] == q].to_dict("records"):
            complexes = i(r.get("아파트_단지_수"))
            households = sum(x for x in (i(r.get(c)) for c in size_cols) if x) or None
            if not complexes and not households:
                continue
            slot(r[KEY])["apartment"] = {
                "complexes": complexes,
                # 전체 가구가 아니라 '아파트 세대수 합' 이다 (UI 라벨을 그렇게 쓸 것)
                "households": households,
                "avgPriceKRW": i(r.get("아파트_평균_시가")),
                "avgAreaM2": round(num(r.get("아파트_평균_면적")) or 0, 1) or None,
                "asOf": quarter_label(q),
            }

    # ---- 집객시설 ----
    fac = read_csv_any(args.facility)
    q = latest_quarter_with_values(fac, "집객시설_수")
    if q:
        as_of["facility"] = quarter_label(q)
        sources.append(f"서울 열린데이터광장 상권분석서비스 — 집객시설-상권 ({quarter_label(q)})")
        for r in fac[fac[QCOL] == q].to_dict("records"):
            total = i(r.get("집객시설_수"))
            items = counts(r, FACILITY_MAP, top=8)
            if not total and not items:
                continue
            slot(r[KEY])["facility"] = {"total": total, "items": items, "asOf": quarter_label(q)}

    # ---- 소비지출 (선택 · 값이 있는 최신 분기 = 2023Q4) ----
    if args.income and os.path.exists(args.income):
        inc = read_csv_any(args.income)
        q = latest_quarter_with_values(inc, "지출_총금액")
        if q:
            as_of["spending"] = quarter_label(q)
            sources.append(
                f"서울 열린데이터광장 상권분석서비스 — 소득소비-상권배후지 ({quarter_label(q)})")
            for r in inc[inc[QCOL] == q].to_dict("records"):
                total = num(r.get("지출_총금액"))
                if not total:
                    continue
                slot(r[KEY])["spending"] = {
                    "totalKRW": i(total),
                    "byCategory": ratio_slices(r, SPEND_MAP, total_key="지출_총금액"),
                    "asOf": quarter_label(q),
                }

    by_sangwon = {k: v for k, v in by_sangwon.items() if v}
    if len(by_sangwon) < 500:
        raise SystemExit(f"상권 {len(by_sangwon)}개만 산출됨 — 입력 파일을 확인하세요.")

    out = {
        "asOf": as_of,
        "sources": sources,
        # 데이터셋에 없어서 리포트에서 뺀 항목 (UI 가 그대로 노출 — 왜 없는지 밝힌다)
        "unavailable": [
            {"item": "소득 분위",
             "reason": "소득소비-상권배후지 데이터셋에는 소득이 아니라 지출 금액만 있습니다."},
            {"item": "총 가구 수",
             "reason": "아파트-상권 데이터셋은 아파트 세대수만 제공해 전체 가구를 알 수 없습니다."},
            {"item": "임대시세",
             "reason": "한국부동산원 R-ONE 별도 데이터로 아직 연동되지 않았습니다."},
        ],
        "bySangwon": by_sangwon,
    }
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with gzip.GzipFile(args.out, "wb", mtime=0) as gz:  # mtime=0 → 결정적 출력
        gz.write(json.dumps(out, ensure_ascii=False).encode("utf-8"))

    have = {k: sum(1 for v in by_sangwon.values() if k in v)
            for k in ("resident", "worker", "apartment", "facility", "spending")}
    print(f"OK: {args.out} / sangwon={len(by_sangwon)} "
          f"size={os.path.getsize(args.out):,}B")
    print(f"    as_of={as_of}")
    print(f"    coverage={have}")


if __name__ == "__main__":
    main()

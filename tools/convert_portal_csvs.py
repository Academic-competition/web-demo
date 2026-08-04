# -*- coding: utf-8 -*-
"""
sanggwon-web/tools/convert_portal_csvs.py

포털(data.seoul.go.kr 수동 다운로드) CSV 3종을 API 스키마(영문 헤더·utf-8-sig)로 변환해
Commercial-AI-/data/raw/ 에 놓는다. export_web_static.py 의 입력을 만들기 위한 도구다.

■ 왜 필요한가
export_web_static.py 는 API 수집본(영문 헤더 STDR_YYQU_CD 등, utf-8-sig)을 읽는데,
openapi.seoul.go.kr 이 막힌 망에서는 포털 CSV(한글 헤더, cp949)만 구할 수 있다.
둘은 같은 데이터의 다른 표현이며, 이 스크립트가 컬럼명·인코딩만 맞춰준다. 값은 건드리지 않는다.

■ 컬럼명 함정 (aliases.py 와 포털명이 다른 것들 — 직접 대조로 확인)
  - store: 포털 `전체_점포_수` = API `SIMILR_INDUTY_STOR_CO`,
           포털 `일반_점포_수` = API `STOR_CO` (프랜차이즈 제외 수).
           aliases.py 의 한글명(유사_업종_점포_수/점포_수)과 포털명이 다르다!
  - sales: 시간대 컬럼이 포털에선 물결표(`시간대_00~06_매출_금액`).
           매출_건수 시간대 컬럼은 포털 헤더 자체가 깨져 있어(`시간대_건수~06_매출_건수`)
           매핑하지 않는다 (export 는 금액만 쓴다).
  - population: 포털명이 aliases.py 한글명과 동일 (시간대도 언더바).

실행:
    <python> sanggwon-web/tools/convert_portal_csvs.py
        [--src <포털 CSV 폴더>] [--dst <Commercial-AI-/data/raw>]
"""

from __future__ import annotations

import argparse
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ACADEMY_ROOT = os.path.dirname(os.path.dirname(HERE))
DEFAULT_SRC = os.path.join(ACADEMY_ROOT, "seoul-startup-opportunity-recommender", "data", "raw")
DEFAULT_DST = os.path.join(ACADEMY_ROOT, "Commercial-AI-", "data", "raw")

# ---------------------------------------------------------------- 매핑
COMMON = {
    "기준_년분기_코드": "STDR_YYQU_CD",
    "상권_구분_코드": "TRDAR_SE_CD",
    "상권_구분_코드_명": "TRDAR_SE_CD_NM",
    "상권_코드": "TRDAR_CD",
    "상권_코드_명": "TRDAR_CD_NM",
    "서비스_업종_코드": "SVC_INDUTY_CD",
    "서비스_업종_코드_명": "SVC_INDUTY_CD_NM",
}

_DAYS = [("월", "MON"), ("화", "TUES"), ("수", "WED"), ("목", "THUR"),
         ("금", "FRI"), ("토", "SAT"), ("일", "SUN")]
_TMZONS = ["00~06", "06~11", "11~14", "14~17", "17~21", "21~24"]
_AGES = ["10", "20", "30", "40", "50", "60_이상"]


def _age_en(a: str) -> str:
    return "AGRDE_60_ABOVE" if a == "60_이상" else f"AGRDE_{a}"


SALES = dict(COMMON)
SALES.update({
    "당월_매출_금액": "THSMON_SELNG_AMT",
    "당월_매출_건수": "THSMON_SELNG_CO",
    "주중_매출_금액": "MDWK_SELNG_AMT",
    "주말_매출_금액": "WKEND_SELNG_AMT",
    "주중_매출_건수": "MDWK_SELNG_CO",
    "주말_매출_건수": "WKEND_SELNG_CO",
    "남성_매출_금액": "ML_SELNG_AMT",
    "여성_매출_금액": "FML_SELNG_AMT",
    "남성_매출_건수": "ML_SELNG_CO",
    "여성_매출_건수": "FML_SELNG_CO",
})
for ko, en in _DAYS:
    SALES[f"{ko}요일_매출_금액"] = f"{en}_SELNG_AMT"
    SALES[f"{ko}요일_매출_건수"] = f"{en}_SELNG_CO"
for tz in _TMZONS:
    SALES[f"시간대_{tz}_매출_금액"] = f"TMZON_{tz.replace('~', '_')}_SELNG_AMT"
for a in _AGES:
    SALES[f"연령대_{a}_매출_금액"] = f"{_age_en(a)}_SELNG_AMT"
    SALES[f"연령대_{a}_매출_건수"] = f"{_age_en(a)}_SELNG_CO"

POPULATION = dict(COMMON)
POPULATION.update({
    "총_유동인구_수": "TOT_FLPOP_CO",
    "남성_유동인구_수": "ML_FLPOP_CO",
    "여성_유동인구_수": "FML_FLPOP_CO",
})
for ko, en in _DAYS:
    POPULATION[f"{ko}요일_유동인구_수"] = f"{en}_FLPOP_CO"
for tz in _TMZONS:
    u = tz.replace("~", "_")
    POPULATION[f"시간대_{u}_유동인구_수"] = f"TMZON_{u}_FLPOP_CO"   # 포털은 언더바
    POPULATION[f"시간대_{tz}_유동인구_수"] = f"TMZON_{u}_FLPOP_CO"  # 물결표 변형 대비
for a in _AGES:
    POPULATION[f"연령대_{a}_유동인구_수"] = f"{_age_en(a)}_FLPOP_CO"

STORE = dict(COMMON)
STORE.update({
    "전체_점포_수": "SIMILR_INDUTY_STOR_CO",   # ★ 전체 = 유사업종 (일반+프랜차이즈)
    "일반_점포_수": "STOR_CO",                 # ★ 프랜차이즈 제외
    "프랜차이즈_점포_수": "FRC_STOR_CO",
    "개업_율": "OPBIZ_RT",
    "개업_점포_수": "OPBIZ_STOR_CO",
    "폐업_률": "CLSBIZ_RT",
    "폐업_점포_수": "CLSBIZ_STOR_CO",
})

# export_web_static.py 가 실제로 참조하는 컬럼 — 변환 후 반드시 존재해야 한다
REQUIRED = {
    "sales": ["STDR_YYQU_CD", "TRDAR_CD", "SVC_INDUTY_CD", "THSMON_SELNG_AMT",
              "ML_SELNG_AMT", "FML_SELNG_AMT"]
             + [f"{en}_SELNG_AMT" for _, en in _DAYS]
             + [f"TMZON_{tz.replace('~', '_')}_SELNG_AMT" for tz in _TMZONS]
             + [f"{_age_en(a)}_SELNG_AMT" for a in _AGES],
    "population": ["STDR_YYQU_CD", "TRDAR_CD", "TOT_FLPOP_CO", "ML_FLPOP_CO", "FML_FLPOP_CO"]
                  + [f"{en}_FLPOP_CO" for _, en in _DAYS]
                  + [f"TMZON_{tz.replace('~', '_')}_FLPOP_CO" for tz in _TMZONS],
    "store": ["STDR_YYQU_CD", "TRDAR_CD", "SVC_INDUTY_CD", "SIMILR_INDUTY_STOR_CO",
              "STOR_CO", "FRC_STOR_CO", "OPBIZ_RT", "OPBIZ_STOR_CO", "CLSBIZ_STOR_CO"],
}

MAPS = {"sales": SALES, "population": POPULATION, "store": STORE}


def read_any(path: str):
    import pandas as pd
    for enc in ("cp949", "utf-8-sig"):
        try:
            return pd.read_csv(path, encoding=enc, low_memory=False)
        except UnicodeDecodeError:
            continue
    raise SystemExit(f"[오류] 인코딩 판별 실패: {path}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=DEFAULT_SRC)
    ap.add_argument("--dst", default=DEFAULT_DST)
    args = ap.parse_args()
    os.makedirs(args.dst, exist_ok=True)

    for name in ("sales", "population", "store"):
        src = os.path.join(args.src, f"{name}.csv")
        dst = os.path.join(args.dst, f"{name}.csv")
        df = read_any(src)
        df.columns = [c.strip() for c in df.columns]

        mapping = MAPS[name]
        df = df.rename(columns=mapping)
        unmapped = [c for c in df.columns if ("가" <= c[0] <= "힣")]
        missing = [c for c in REQUIRED[name] if c not in df.columns]
        if missing:
            print(f"[오류] {name}: 필수 컬럼 누락 {missing}")
            return 2

        df.to_csv(dst, index=False, encoding="utf-8-sig")
        print(f"[OK] {name}: {len(df):,}행 · 매핑 {sum(c in df.columns for c in mapping.values())}개"
              f" · 미매핑(미사용) {len(unmapped)}개 → {dst}")
        if unmapped:
            print(f"     미매핑 유지: {unmapped[:6]}{' ...' if len(unmapped) > 6 else ''}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

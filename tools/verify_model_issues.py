# -*- coding: utf-8 -*-
"""
verify_model_issues.py — docs/MODEL-REQUESTS.md 의 주장을 직접 확인하는 스크립트

문서만 읽고 믿지 말고 이걸 돌려서 눈으로 확인하기 위한 것이다. 데이터를 바꾸거나
학습을 돌리지 않는다 (읽기 전용).

확인하는 것:
  ① 매출 과대추정 — `점포_수` 가 전체가 아니라 '프랜차이즈 제외' 인지 (원천 데이터 항등식)
  ② 정보 누락    — 학습 피처 목록에 상주인구/직장인구가 없는지 + 성능이 단순규칙에 열세인지
  ③ 치안 공백    — 치안 피처는 등록돼 있는데 서빙 값이 비어 있는지 (+ 학습 때는 있었던 흔적)

사용법 (academy 루트에서):
    seoul-startup-opportunity-recommender/.venv/Scripts/python.exe \
        web-demo/tools/verify_model_issues.py

경로가 다르면 인자로 넘긴다:
    --store <점포-상권 CSV>  --model-repo <Commercial-AI- 경로>
"""
from __future__ import annotations

import argparse
import io
import json
import os
import sys

import pandas as pd

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))  # academy 루트 추정
DEFAULT_STORE = os.path.join(ROOT, "seoul-startup-opportunity-recommender", "data", "raw", "store.csv")
DEFAULT_MODEL_REPO = os.path.join(ROOT, "Commercial-AI-")
ENCS = ["utf-8-sig", "utf-8", "cp949", "euc-kr"]

# 우리가 내려받은 한글 헤더 CSV ↔ 모델이 쓰는 API 필드 대응
#   전체_점포_수       = SIMILR_INDUTY_STOR_CO (유사_업종_점포_수)  ← 진짜 전체
#   일반_점포_수       = STOR_CO              (점포_수)            ← 모델이 '전체'로 오인
#   프랜차이즈_점포_수 = FRC_STOR_CO
COL_TOTAL, COL_GENERAL, COL_FRANCHISE = "전체_점포_수", "일반_점포_수", "프랜차이즈_점포_수"


def read_csv_any(path: str, **kw) -> pd.DataFrame:
    for enc in ENCS:
        try:
            return pd.read_csv(path, encoding=enc, low_memory=False, **kw)
        except (UnicodeDecodeError, UnicodeError):
            continue
    raise SystemExit(f"인코딩 판별 실패: {path}")


def head(title: str) -> None:
    print()
    print("=" * 74)
    print(title)
    print("=" * 74)


# ---------------------------------------------------------------- ①
def check_store_denominator(store_path: str) -> None:
    head("① 매출 과대추정 — '점포_수' 가 전체가 아니라 '프랜차이즈 제외' 인가")

    if not os.path.exists(store_path):
        print(f"  [건너뜀] 점포 CSV 없음: {store_path}")
        return
    df = read_csv_any(store_path)
    need = {COL_TOTAL, COL_GENERAL, COL_FRANCHISE, "기준_년분기_코드", "서비스_업종_코드_명"}
    if not need.issubset(df.columns):
        print(f"  [건너뜀] 기대 컬럼이 없다. 있는 컬럼: {list(df.columns)[:12]}")
        return

    ok = (df[COL_GENERAL] + df[COL_FRANCHISE]) == df[COL_TOTAL]
    print(f"  항등식 '일반 + 프랜차이즈 == 전체' : "
          f"성립 {ok.sum():,}행 / 불일치 {(~ok).sum():,}행 (전체 {len(df):,}행)")
    print("  → 불일치가 0 이면, '일반_점포_수'(모델의 점포_수)는 전체가 아니라는 뜻이다")

    latest = int(df["기준_년분기_코드"].max())
    q = df[(df["기준_년분기_코드"] == latest) & (df[COL_GENERAL] > 0)].copy()
    q["_배수"] = q[COL_TOTAL] / q[COL_GENERAL]

    bad = q[COL_FRANCHISE] / q[COL_GENERAL] * 100
    print(f"\n  프랜차이즈 비율을 잘못된 분모로 계산하면 ({latest}): "
          f"100% 초과 {(bad > 100).sum():,}건, 최대 {bad.max():,.0f}%")

    print(f"\n  업종별 평균 부풀림 배수 (상위 8, {latest})")
    g = (q.groupby("서비스_업종_코드_명")
           .apply(lambda d: d[COL_TOTAL].sum() / d[COL_GENERAL].sum(), include_groups=False)
           .sort_values(ascending=False).head(8))
    for name, mul in g.items():
        print(f"    {str(name)[:20]:22s} {mul:.2f}배")

    conv = q[q["서비스_업종_코드_명"] == "편의점"]
    if len(conv):
        print(f"\n  편의점에서 가장 심한 상권 5곳")
        for _, x in conv.nlargest(5, "_배수").iterrows():
            print(f"    {str(x['상권_코드_명'])[:22]:24s} 전체 {int(x[COL_TOTAL]):>3}개 = "
                  f"일반 {int(x[COL_GENERAL]):>2} + 프랜차이즈 {int(x[COL_FRANCHISE]):>3} "
                  f"→ {x['_배수']:.0f}배")

    print("\n  코드에서 확인할 곳 (모델 저장소)")
    print("    src/features/build.py:127  TARGET = next_당월_매출_금액 ÷ next_점포_수")
    print("    src/features/build.py:99   프랜차이즈_비율 = 프랜차이즈_점포_수 ÷ 점포_수")
    print("    src/features/build.py:72   점포당_매출_t = 당월_매출_금액 ÷ 점포_수")


# ---------------------------------------------------------------- ②③
def check_model_metadata(repo: str) -> None:
    path = os.path.join(repo, "models", "model_metadata.json")
    if not os.path.exists(path):
        head("②③ [건너뜀] 모델 메타데이터 없음")
        print(f"  {path}")
        return
    md = json.load(open(path, encoding="utf-8"))
    # features 는 리스트가 아니라 {numeric, categorical} dict 다 (얕게 읽으면 '2개'로 오독)
    num, cat = md["features"]["numeric"], md["features"]["categorical"]

    head("② 정보 누락 — 학습 피처에 상주인구/직장인구가 있는가")
    print(f"  숫자형 {len(num)}개 · 범주형 {len(cat)}개")
    hits = [c for c in num + cat if ("상주" in c or "직장" in c)]
    print(f"  '상주'/'직장' 포함 피처: {hits if hits else '없음  ← 이것이 문제'}")
    print(f"  인구 관련으로 있는 것  : {[c for c in num if '유동인구' in c]}")
    print(f"  전체 숫자형 피처 목록  :")
    for i in range(0, len(num), 3):
        print("    " + " · ".join(num[i:i + 3]))

    ct = md.get("chosen_config_test_metrics") or {}
    bl = ((md.get("model_comparison") or {}).get("baseline_last_quarter") or {}).get("test") or {}
    if ct and bl:
        print(f"\n  성능 (test) — 낮을수록 좋다")
        print(f"    모델      MAE {ct['MAE']:>14,.0f}")
        print(f"    단순규칙  MAE {bl['MAE']:>14,.0f}  ('지난 분기와 같다')")
        diff = ct["MAE"] - bl["MAE"]
        print(f"    차이      {diff:>18,.0f}  ({diff / bl['MAE'] * 100:+.1f}%)")
        print(f"    ml_beats_baseline_on_test = {md.get('ml_beats_baseline_on_test')}")

    head("③ 치안 공백 — 피처는 등록돼 있는데 값이 비어 있는가")
    sf = [c for c in num if c.startswith("sf_")]
    re_ = [c for c in num if c.startswith("re_")]
    print(f"  치안 피처   : {sf}")
    print(f"  부동산 피처 : {re_}")
    fs = md.get("feature_selection") or {}
    print(f"  선택 단계   : {fs.get('chosen_step')} / 외부 포함 = {fs.get('external_features_included')}")

    ab = md.get("ablation_valid") or []
    if ab:
        print(f"\n  ablation (valid MAE) — 피처를 단계별로 더했을 때")
        prev = None
        for row in ab:
            mae = row.get("MAE")
            delta = "" if prev is None else f"  ({mae - prev:+,.0f})"
            print(f"    {row.get('step'):26s} {mae:>13,.0f}{delta}")
            prev = mae
        print("    → 치안(E)은 오차를 줄였고, 부동산(D)은 늘렸다")

    ext_path = os.path.join(repo, "exports", "meta", "external_columns.json")
    if os.path.exists(ext_path):
        print(f"\n  학습 때 외부 데이터가 있었다는 흔적 (external_columns.json)")
        for c in json.load(open(ext_path, encoding="utf-8")):
            print(f"    {c['column']:26s} 기준 {c['data_as_of']}")
        print(f"  학습 시각: {md.get('trained_at')}")
        print("  → 그때는 data/raw/external/*.csv 가 있었다는 뜻. 남아 있으면 재실행만으로 복구된다")

    bf = os.path.join(repo, "scripts", "build_features.py")
    if os.path.exists(bf):
        print(f"\n  파일이 없으면 어떻게 되는가 (scripts/build_features.py)")
        for i, line in enumerate(open(bf, encoding="utf-8").read().splitlines(), 1):
            if "없음" in line and ("sf_" in line or "re_" in line):
                print(f"    {i}: {line.strip()[:96]}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--store", default=DEFAULT_STORE)
    ap.add_argument("--model-repo", default=DEFAULT_MODEL_REPO)
    a = ap.parse_args()
    print("verify_model_issues.py — 읽기 전용 검증 (데이터·모델을 바꾸지 않는다)")
    print(f"  점포 CSV   : {a.store}")
    print(f"  모델 저장소: {a.model_repo}")
    check_store_denominator(a.store)
    check_model_metadata(a.model_repo)
    print("\n완료. 자세한 배경은 docs/MODEL-REQUESTS.md 참조")


if __name__ == "__main__":
    main()

# -*- coding: utf-8 -*-
"""
tools/prepare_feature_table.py

build_features.py 와 build_serving_table.py 사이에 끼워 넣는 보정 단계.

■ 왜 필요한가
커밋된 학습본(models/sales_model.pkl)은 외부(부동산·안전) 피처 6개를 피처 목록에 갖고 있다:
    re_rent_per_m2, re_vacancy_rate, re_rent_index,
    sf_crime_rate_per_100k, sf_arrest_rate, sf_cctv_per_km2

예측 시 src/training/models.py 의 _prep() 이 X[numeric_cols + categorical_cols] 로
컬럼을 하드 선택하므로, 외부 CSV 를 넣지 않으면 build_serving_table.py 가 이렇게 죽는다:

    KeyError: "['re_rent_per_m2', ... 'sf_cctv_per_km2'] not in index"

그런데 필요한 것은 "값"이 아니라 "컬럼의 존재"다. LightGBM 은 결측을 native 로 처리하므로
빈(NaN) 컬럼만 만들어 주면 정상 예측된다 (측정 결과 예측값 평균 차이 약 1.9%).

■ 정직성 원칙
없는 값을 0 이나 평균으로 채우지 않는다 — 반드시 NaN 이다.
0 으로 채우면 "임대료 0원, 범죄율 0" 이라는 거짓 사실이 되어 점수·등급을 왜곡한다.
NaN 이면 모델은 '모름'으로 취급하고, 서빙 단계도 has_* 플래그로 결측을 표시한다.

■ 사용
    # academy 루트에서 (cwd 무관 — 경로는 __file__ 기준으로 해석된다)
    Commercial-AI-/.venv/Scripts/python.exe sanggwon-web/tools/prepare_feature_table.py
    ... prepare_feature_table.py --repo <모델저장소>

실행 순서 (모델 저장소 기준):
    scripts/build_features.py
      →  sanggwon-web/tools/prepare_feature_table.py
      →  scripts/build_serving_table.py

실제 외부 데이터를 data/raw/external/ 에 넣었다면 이 단계는 아무것도 하지 않는다(무해).
"""

from __future__ import annotations

import argparse
import os
import sys

# 이 스크립트는 sanggwon-web/tools/ 에 있고, 모델 저장소는 그 형제 디렉터리다.
#   <academy>/sanggwon-web/tools/prepare_feature_table.py  ← __file__
#   <academy>/Commercial-AI-/                              ← 대상
_WEB_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_REPO = os.path.join(os.path.dirname(_WEB_ROOT), "Commercial-AI-")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", default=DEFAULT_REPO, help="Commercial-AI- 저장소 경로")
    args = ap.parse_args()
    repo = os.path.abspath(args.repo)

    try:
        import joblib
        import numpy as np
        import pandas as pd
    except ImportError as e:
        print(f"[오류] 의존성 없음: {e}. Commercial-AI-/.venv 의 python 으로 실행하세요.")
        return 2

    feat_path = os.path.join(repo, "data", "processed", "feature_table.parquet")
    model_path = os.path.join(repo, "models", "sales_model.pkl")

    for p in (feat_path, model_path):
        if not os.path.exists(p):
            print(f"[오류] 파일 없음: {p}")
            if p == feat_path:
                print("       먼저 scripts/build_features.py 를 실행하세요.")
            return 2

    # sales_model.pkl 은 src.training.models.NativeCategoricalModel 을 참조하므로
    # 언피클 전에 저장소 루트가 sys.path 에 있어야 한다 (없으면 ModuleNotFoundError: 'src')
    if repo not in sys.path:
        sys.path.insert(0, repo)

    bundle = joblib.load(model_path)
    numeric = list(bundle.get("numeric_features", []))
    categorical = list(bundle.get("categorical_features", []))

    feat = pd.read_parquet(feat_path)
    before = len(feat.columns)

    missing_num = [c for c in numeric if c not in feat.columns]
    missing_cat = [c for c in categorical if c not in feat.columns]

    if not missing_num and not missing_cat:
        print(f"[확인] 학습본이 요구하는 {len(numeric) + len(categorical)}개 컬럼이 모두 존재합니다. 변경 없음.")
        return 0

    # 없는 값은 NaN 으로만 채운다 (0/평균 대치 금지 — 거짓 사실이 된다)
    for c in missing_num:
        feat[c] = np.nan
    for c in missing_cat:
        feat[c] = pd.Series([None] * len(feat), dtype="object")

    feat.to_parquet(feat_path, index=False)

    print(f"[보정] feature_table.parquet — 컬럼 {before} → {len(feat.columns)}")
    if missing_num:
        print(f"  · 수치 {len(missing_num)}개를 NaN 으로 추가: {missing_num}")
    if missing_cat:
        print(f"  · 범주 {len(missing_cat)}개를 결측으로 추가: {missing_cat}")
    print()
    print("⚠️ 이 컬럼들은 값이 없는 상태입니다. 해당 지표(임대료·공실률·치안 등)는")
    print("   리포트에서 비어 있게 표시되며, 실측값이 아닙니다.")
    print("   실데이터가 필요하면 data/raw/external/ 에 CSV 를 넣고 build_features.py 를 다시 실행하세요.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

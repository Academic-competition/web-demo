# -*- coding: utf-8 -*-
"""
sanggwon-web/tools/collect_population.py

상주인구-상권(OA-15584) · 직장인구-상권(OA-15569) 두 데이터셋만 수집한다.

■ 왜 별도 스크립트인가
`Commercial-AI-/scripts/collect_data.py` 는 SERVICE_NAMES 전체(매출 101MB·점포 79MB 포함)를
다시 받는다. 이 두 개만 추가하면 되는 상황에서 30분 넘게 재다운로드할 이유가 없다.

■ 배경 — 왜 여태 수집이 안 됐나
전처리 매핑(`src/preprocessing/aliases.py:82~`)과 병합 로직(`scripts/build_features.py:63~`)은
처음부터 준비돼 있었다. 막힌 곳은 수집 목록(`src/legacy_api_config.py` 의 SERVICE_NAMES)에
두 서비스가 아예 없어서 **호출 자체가 안 된 것**이었다.
(`config/data_sources.yaml` 의 `verified: false` 는 코드가 읽지 않는 메모다.)

■ 사용 (PowerShell)
    $env:SEOUL_API_KEY = "발급키"
    C:\_develop\academy\Commercial-AI-\.venv\Scripts\python.exe `
        C:\_develop\academy\sanggwon-web\tools\collect_population.py

출력: Commercial-AI-/data/raw/{resident_population,worker_population}.csv
그 뒤 build_features.py 가 자동으로 선택 데이터로 인식해 병합한다.

■ 서비스명 검증
data_sources.yaml 에서 `verified: false` 였던 항목이다. 이 스크립트가 첫 페이지 응답의
컬럼을 출력하므로, 기대 필드(TOT_REPOP_CO / TOT_WRC_POPLTN_CO)가 보이면 검증된 것이다.
보이지 않으면 서비스명이나 필드명이 다른 것이므로 중단하고 실제 응답을 확인할 것.
"""

from __future__ import annotations

import os
import sys

ACADEMY = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
REPO = os.path.join(ACADEMY, "Commercial-AI-")

TARGETS = {
    "resident_population": "TOT_REPOP_CO",       # 총_상주인구_수
    "worker_population": "TOT_WRC_POPLTN_CO",    # 총_직장인구_수
}


def main() -> int:
    if not os.environ.get("SEOUL_API_KEY"):
        print("[오류] 환경변수 SEOUL_API_KEY 가 없습니다.")
        print('  PowerShell:  $env:SEOUL_API_KEY = "발급키"')
        return 2
    if not os.path.isdir(REPO):
        print(f"[오류] 모델 저장소를 찾을 수 없습니다: {REPO}")
        return 2

    sys.path.insert(0, os.path.join(REPO, "src"))
    try:
        import api_loader  # noqa: E402  (레거시 모듈 — 형제 import 라 src/ 를 path 에 넣어야 한다)
    except ImportError as e:
        print(f"[오류] api_loader import 실패: {e}")
        return 2

    ok = True
    for key, expect_col in TARGETS.items():
        name = api_loader.SERVICE_NAMES.get(key, "")
        if not name:
            print(f"[오류] SERVICE_NAMES 에 '{key}' 가 없습니다 — legacy_api_config.py 확인")
            ok = False
            continue

        print(f"\n{'='*60}\n[{key}] 서비스명 {name}")
        try:
            df = api_loader.fetch_dataset(key, verbose=True)
        except Exception as e:  # noqa: BLE001 — 어떤 실패든 다음 데이터셋은 계속 시도
            print(f"[실패] {key}: {type(e).__name__} {e}")
            ok = False
            continue

        if df is None or df.empty:
            print(f"[실패] {key}: 응답이 비어 있습니다 (서비스명·인증키 확인)")
            ok = False
            continue

        # 서비스명 검증 — 기대 필드가 있는지
        if expect_col in df.columns:
            print(f"  ✅ 기대 필드 {expect_col} 확인 — 서비스명이 맞습니다")
        else:
            print(f"  ⚠️ 기대 필드 {expect_col} 없음! 실제 컬럼 일부:")
            print("     ", list(df.columns)[:14])
            print("     → aliases.py 의 매핑을 실제 필드명에 맞춰 고쳐야 합니다")
            ok = False

        out = os.path.join(REPO, "data", "raw", api_loader.OUTPUT_FILE_NAMES[key])
        os.makedirs(os.path.dirname(out), exist_ok=True)
        df.to_csv(out, index=False, encoding="utf-8-sig")
        print(f"  저장: {out} ({len(df):,}행 × {len(df.columns)}열)")

    print(f"\n{'='*60}")
    if ok:
        print("완료. 다음: build_features.py → build_serving_table.py → export_web_static.py")
    else:
        print("일부 실패 — 위 메시지를 확인하세요. 성공한 파일만 저장돼 있습니다.")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())

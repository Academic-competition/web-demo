# 모델 v2 반영 작업 인계 — 파이프라인 머신(`C:\_develop\academy`)용

> 작성: 2026-08-04. 모델 저장소 main 에 v2(분모 수정 + 검증 2분기 + 외부데이터)가 병합·재학습
> 완료됐으나 **웹 데모는 아직 v1 데이터로 동작 중**이다. 이 문서는 그 반영 작업을
> 파이프라인 머신에서 이어받기 위한 체크리스트다.
> 배경: [MODEL-EXPERIMENT-REPORT.md](MODEL-EXPERIMENT-REPORT.md) · 쉬운 해설 [MODEL-EXPERIMENT-EXPLAINED.md](MODEL-EXPERIMENT-EXPLAINED.md)

## 0. 상황 요약 — 왜 이 머신인가

- 모델 저장소 main(`cbaab3d`): RandomForest v2.0.0, `ml_beats_baseline: true`(−2.7%),
  타깃 분모 수정, 인구 피처 포함, 치안은 **피처에서 제외**(ablation `D_plus_real_estate` 채택,
  점수·지표로만 활용), `serving_table.parquet`(2025Q2 스냅샷)·외부데이터 **커밋됨**
- 개발 PC(웹 작업용)에서 재생성을 시도했고 **파이프라인 자체는 끝까지 통과**했으나,
  그 PC 의 원본 CSV 가 2025Q1~2026Q1 뿐이라 **리포트 추이 차트가 5→2포인트로 퇴화**
  (서빙 스냅샷 2025Q2 기준 추이엔 2024Q2~Q4 필요) → 산출물 커밋 보류, 기존 번들 유지 중
- 이 머신은 API 수집본(영문 헤더, 전 분기)이 있으므로 그 문제가 없다

## 1. 선행 확인

```bash
git -C Commercial-AI- pull            # main cbaab3d 이상
git -C sanggwon-web pull              # a8ed570 이상
```

- ⚠️ `Commercial-AI-/data/processed/serving_table.parquet` 이 **이제 git 추적 대상**이다.
  로컬에 직접 생성한 파일이 있으면 pull 충돌 가능 — **커밋본(팀원 재학습 결과물)이 정본**이므로
  로컬본을 버리고 커밋본을 받을 것. 직접 재생성하지 말 것(모델·데이터가 같아도 무방하나
  정본 관리 주체는 모델 저장소다)
- `Commercial-AI-/data/raw/` 의 sales/population/store 가 **2024Q2~2025Q2 를 포함**하는지 확인:

```bash
Commercial-AI-/.venv/Scripts/python.exe -c "import pandas as pd; print(sorted(pd.read_csv('Commercial-AI-/data/raw/sales.csv', encoding='utf-8-sig', usecols=['STDR_YYQU_CD'])['STDR_YYQU_CD'].unique()))"
```

- 개발 PC 전용 우회로였던 `sanggwon-web/tools/convert_portal_csvs.py`(포털 한글 CSV 변환기)는
  **이 머신에서는 불필요**하다 — API 수집본이 이미 영문 헤더다

## 2. 작업 ① — `model-exports/` 재생성

```bash
Commercial-AI-/.venv/Scripts/python.exe sanggwon-web/tools/export_web_static.py
```

검증 (커밋 전 필수):

1. **추이 복원**: 아래가 "5포인트 다수"로 나와야 한다 (기존 번들 수준 = 1,403 중 1,387)

```bash
Commercial-AI-/.venv/Scripts/python.exe -c "
import json, gzip
d = json.load(gzip.open('sanggwon-web/model-exports/analyze/CS100001.json.gz'))
L = {}
for r in d.values():
    n = len(((r.get('detail') or {}).get('sales') or {}).get('trend') or [])
    L[n] = L.get(n, 0) + 1
print(sorted(L.items()))"
```

2. **매출 하향 확인** (분모 수정 효과): 편의점(CS300033) 등 프랜차이즈 비중 큰 업종의
   `revenue.monthlyEstimateKRW` 가 기존 대비 내려갔는지 몇 개 상권 표본 비교
   (`git show HEAD:model-exports/analyze/CS300033.json.gz` 로 기존값 추출 가능)
3. gzip 은 결정적(mtime=0)이므로 **diff 가 곧 데이터 변화량**이다. meta/heatmap/analyze 가
   광범위하게 바뀌는 것이 정상 (모델이 통째로 바뀌었으므로)

## 3. 작업 ② — 같은 커밋으로 묶을 웹 정리 (이중 표기 방지)

v2 데이터가 들어오는 순간 거짓이 되는 문구·코드들이다. **산출물과 반드시 한 커밋/배포로.**

### 3-1. "매출 과대 추정" 문구 3곳 — 이제 사실이 아님

| 위치 | 현재 | 조치 |
|---|---|---|
| `lib/normalize.ts:215` | scaleNote "프랜차이즈 비중이 큰 업종에서는 과대 추정될 수 있습니다" | "점포당 예측값(전체 점포 기준)" 등 중립 설명으로 교체 (scaleNote 주입 메커니즘 자체는 유지 — CLAUDE.md 원칙) |
| `components/ResultPanel.tsx:1203` | ⑧ 유의사항 "예상 매출은 같은 원인으로 과대 추정" | 해당 항목 삭제 또는 "v2 에서 수정됨" 이력 문구로 |
| `tools/export_web_static.py:28, 477-478` | 헤더 주석·완료 경고 "분모가 일반 점포 수라 과대" | 낡은 경고 제거 (분모 수정 완료) |

### 3-2. `correctStoreCounts()` 역산 보정 — no-op 확인 후 제거

- 정의 `lib/normalize.ts:241`, 사용처 `:362` (+ "보정됨" 표기 UI 3곳 — normalize 의 주석과
  ResultPanel 참조를 따라갈 것)
- v2 는 원천에서 분모·비율이 올바르므로 보정 조건(비율>1)이 **발동하지 않아야 정상**.
  새 번들에서 no-op 임을 확인하고 로직·배지를 제거한다. 라이브 경로(FastAPI)도 같은
  서빙 테이블을 읽으므로 동일하게 불필요

### 3-3. 치안 서술 반전 — "학습 피처" → "점수 지표"

v1 문서·UI 는 "치안은 학습 피처인데 값이 비어 있다"고 썼다. v2 의 사실은 반대다:
**값은 채워졌고, ablation(`D_plus_real_estate` 채택)에서 피처로는 빠졌으며, 종합점수의
안전점수(5%)로는 실제 동작한다** (`feature_selection.note` 에 정책 명문화됨).

| 위치 | 수정 |
|---|---|
| `README.md:212` (데이터 흐름 표) | "학습 피처에 포함 · 값 NaN" → "피처 미채택(ablation) · `score_safety_gu` 실측으로 종합점수 5% 반영" |
| `README.md:236` | 같은 취지로 |
| `components/ResultPanel.tsx:1217` | "모델은 치안을 학습 피처로 쓰도록 설계돼 있으나…" 문장 교체 |
| `docs/data-flow.svg` | 점선(서빙테이블→모델 학습) 캡션 "현재 값 NaN" 수정 |
| `docs/OPEN-ITEMS.md` §0 "자주 하는 오해" | 절 전체를 v2 기준으로 갱신 (기존 서술이 이제 거꾸로 오해를 만든다) |

### 3-4. (권장) `detail.safety` 채우기

`tools/export_web_static.py:402` 가 `"safety": None` 하드코딩(주석 "자치구 범죄 CSV 미보유" —
이제 낡음). 서빙 테이블에 `score_safety_gu`·`sf_crime_rate_per_100k`·`sf_arrest_rate`·
`sf_cctv_per_km2`(+`sf_*_data_year`) 실측값이 있으므로 매핑해서 내보낼 수 있다.
채우면 웹 `app/page.tsx` 의 `safetyFromScores` 우선순위(서빙 우선)가 실제로 작동하기
시작한다 — 기존 `/api/safety` 경로(자치구 산식)와 값이 일치하는지 몇 개 구 표본 대조할 것.
계보(provenance)도 확인: detail.safety 가 채워지면 ⑥치안의 분류가 바뀌는지
`lib/provenance.ts` 로직 점검.

## 4. 작업 ③ — (선택) v2 신규 필드로 웹 데모 개선

서빙 테이블에 새로 생긴 것들. 리포트에 추가하면 차별점이 된다.
**추가 시 `lib/provenance.ts` 계보 표에 행 추가 + `inspect()` 이벤트 필수** (CLAUDE.md 원칙):

| 필드 | 내용 | 활용 아이디어 |
|---|---|---|
| `indep_*` (9개) | 독립점포(비프랜차이즈) 매출 분석 — 업종별 k 추정(17/63 업종), 시나리오, 순수독립 백분위 | ④업종·경쟁 섹션에 "독립점포 관점" 카드 (품질 게이트 미통과 업종은 시나리오만 — 값 없음 처리 주의) |
| `market_stage` | 시장 단계 (버그 수정으로 560개 상권이 경쟁심화기→안정기 정정됨) | ①종합의견 근거로 |
| `resident/worker/foot_traffic_density_km2` | 인구 밀도 3종 | 지도 레이어 또는 ⑦배후지 보강 |
| `상권_유형` (5종 완전판) | 주거형/직장형 신규 배정 (869 혼합·423 직장·163 주거·112 유동·3 주말여가) | 리포트 헤더 뱃지 |
| metadata `test_breakdown.by_industry` | 업종별 test SMAPE | "이 업종 예측 신뢰도" 표시 — 투명성 셀링 포인트와 부합 |

## 5. 마무리 체크리스트

- [ ] `pnpm exec tsc --noEmit` → `pnpm build`
- [ ] 편의점 상권 하나 열어 눈검증: 매출 하향·프차 비율 ≤100%·추이 5포인트·치안 카드 정상
- [ ] **산출물 + 문구/코드 정리를 한 커밋**으로 푸시 (자동 배포 ~1분)
- [ ] 문서 상태 갱신: `OPEN-ITEMS.md` §0(오해 절)·§2(✅반영 완료로)·§9(트랙1 완료 —
      외부데이터가 저장소에 커밋됨)·헤더 "지금 이어서 할 일" / `MODEL-REQUESTS.md` 는
      상단 상태줄만 (요청 3건 모두 이행됨 — 역사 기록으로 보존) /
      `MODEL-EXPERIMENT-EXPLAINED.md` §9 "반영 전" 문구
- [ ] 남는 후속: 롤링 백테스트(OPEN-ITEMS §10 — metadata 에 walk_forward 4-fold 는
      이미 들어옴, 전 구간 확장이 남음)

## 부록 — 개발 PC(웹 작업용)와의 분업

| | 개발 PC (`C:\toy\academic-competition`) | 이 머신 (`C:\_develop\academy`) |
|---|---|---|
| 가능 | 웹 코드·문서, 포털 CSV 기반 도구(치안·배후지·검증), **포털 CSV 변환기로 export 재생성(2024 분기 확보 시)** | 파이프라인 전체(수집→학습→서빙→export) |
| 불가 | 모델 학습·서빙 테이블 생성 (.venv 없음), 2024 분기 이전 추이 (원본 미보유) | — |
| 참고 | pyarrow 설치됨 → serving_table.parquet 직접 읽기 가능해짐 | serving_table 은 커밋본이 정본 |

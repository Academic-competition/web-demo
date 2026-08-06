# 데이터 카탈로그 — 모델이 제공하는 것 ↔ 웹이 쓰는 곳

> 기준: 모델 저장소 main `cbaab3d`(v2.0.0, 2025Q2 스냅샷) · 웹 `627bf33` · 2026-08-05.
> 상태 표기 — ✅ 화면 사용 중 · ⬜ 모델은 주는데 웹이 아직 안 씀(활용 후보) ·
> 🔧 내부용(화면 비노출이 정상)
>
> ✅ **2026-08-05 재생성 완료** — 이전 판의 🕐(재생성 대기) 23건은 파이프라인 머신에서
> `export_web_static.py` 재실행·배포(`627bf33`)로 전부 ✅ 로 전환됐다. 프로덕션에서
> 9종 응답 확인 (진단 54.2/C+·성분 9·▲3▼3·성장기·혼합형·밀도·임대 gu_mean·
> SMAPE 21%/26.7%·독립점포 시나리오 3). **더 이상 대기 중인 항목은 없다.**

---

## 0. 웹 화면 기준 역매핑 — "이 기능은 무슨 데이터로 도는가"

| 웹 기능 | 원천 데이터 | 성격 | 상태 |
|---|---|---|---|
| 지도 **히트맵** (매출 백분위/생존율) | `predicted_sales_per_store`·`sales_percentile` / 폐업률+축소추정 | ML 예측 / 통계 | ✅ |
| 히트맵 **종합점수 + 치안 토글** | 웹이 매출60·생존40 백분위 합성 + `safety-scores.json`(=서빙 `score_safety_gu`) 5% 옵트인 | 통계+규칙 | ✅ |
| **추천 상권 TOP 10** (업종 먼저) | 히트맵과 같은 지표의 상위 10 | 통계 | ✅ |
| **상권 내 업종 기회순위** (자리 먼저) | 서빙 `overall_score` 의 상권 내 백분위(`opportunityScore`) | 통계 | ✅ |
| ① 종합 의견 (신호등+불릿+조언) | 생존율·백분위·경쟁·인구 + 웹 규칙 문장(advice.ts) | 규칙 | ✅ |
| ① 경쟁 불릿 **시장 단계** (성장기 등 5종) | `market_stage` (개업·폐업·점포증감 규칙) | 규칙 | ✅ |
| ① **모델 종합진단 분해** (점수/100·등급 A+~C·성분 9종 바) | `overall_score`·`grade`·성분 점수 9종 + 가중치(scoring_weights.yaml — export 가 실어 보냄) | 통계+규칙 | ✅ |
| ~~① 강점·리스크 목록~~ | `strengths`·`risks` — **화면에서 제거(8/5)**: ① 불릿(advice.ts)과 같은 말 반복. 계약·산출물에는 남아 있어 언제든 되살릴 수 있다 | 규칙 | ⬜(의도적 미노출) |
| ① 해석 문장 | 서빙 `recommendation` | 규칙 | ✅ |
| ② 생존 전망 (3년 게이지) | 원천 폐업률 → `(1−r)^12` + EB 축소추정(k=20) | 통계 | ✅ |
| ③ **예상 매출** (리포트 유일의 ML) | `predicted_sales_per_store` (다음 분기·점포당) | **ML 예측** | ✅ |
| ③ 동일업종 상위 % | `sales_percentile` | 통계 | ✅ |
| ③ **예측 신뢰도 (±N% 오차, 업종 + 상권유형 이중)** | 성적표 `test_breakdown.by_industry` + `by_commercial_type` SMAPE | 모델 채점 | ✅ |
| ③ 실측 매출·요일/시간대/성별/연령·5분기 추이·전분기/전년비 | 원천 sales CSV (export 가 분해·집계) | 실측 | ✅ |
| ④ 점포 수·프랜차이즈/일반·개폐업 | `유사_업종_점포_수`·`프랜차이즈_점포_수`·개폐업 컬럼 | 실측 | ✅ |
| ④ **독립점포 관점 매출 카드** | `indep_*` 10필드 (업종별 k 추정·시나리오·피어 관측) | 통계 추정 | ✅ |
| ④ 상권/자치구/서울 3단 비교 | 원천 sales·store 를 자치구·서울로 합산 | 실측 | ✅ |
| ⑤ 유동인구 (분포·8분기 추이) | 원천 population CSV | 실측 | ✅ |
| ⑤ **인구 밀도 3종** (명/km² 타일 + **서울 중앙값 대비 · 자치구 중앙값**) | `*_density_km2` (실측 ÷ 영역 면적) + export 가 계산한 자치구·서울 중앙값 | 통계 | 🕐 비교 기준은 재생성 대기 |
| ⑥ 치안 (죄종별·순위·10만명당 + 이중 점수) | `data/raw/external/` 범죄·CCTV → `detail.safety`+`safety-scores.json` (단일 소스) | 실측+규칙 | ✅ |
| ⑦ 배후지 (상주·직장·아파트·집객·소비지출) | 인구 2종(모델 수집본)+아파트·집객·소득소비 CSV → `hinterland.json.gz` | 실측 | ✅ |
| ⑦ **임대 시세** (m²당·공실률·지수, 자치구 평균 + **서울 중앙값 대비 차액**) | `re_rent_per_m2`·`re_vacancy_rate`·`re_rent_index(+yoy)` — R-ONE, `gu_mean` 조인 명시. ⚠️ 값 자체가 자치구 평균이라 '자치구 대비'는 무의미 → 서울 대비만 | 실측 | 🕐 서울 중앙값은 재생성 대기 |
| **헤더 상권 유형 뱃지** (직장형 등 5종) | `상권_유형`·`상권_유형_근거` | 규칙 분류 | ✅ |
| ⑧ 유의사항 / ⑨ 출처 | 응답 basis·sourceMode·asOf 필드에서 파생 | — | ✅ |
| **상권 비교** (최대 3개, 17행 표) | 비교 대상별 `/api/analyze` 응답을 **그대로 나란히** — 새 수치 없음. 각 행의 출처 필드는 `ComparePanel.tsx` 의 `ROWS[].from` (화면 title 로도 노출) | 원본 그대로 | ✅ |
| AI 인스펙터 **데이터 계보** | 위 전부의 basis/granularity/sourceMode | — | ✅ |
| 라이브 생존율 보정 (옵트인 경로) | `meta/closure-priors.json` (업종 사전 폐업률) | 통계 | ✅(대기용) |

> 리포트에서 **ML 예측은 "③ 예상 매출" 딱 하나** — 나머지는 실측·통계·규칙. 이 구분이
> 인스펙터 계보의 핵심 메시지다.

---

## 1. 서빙 테이블 (`serving_table.parquet`, 상권×업종 21,452행 · 226컬럼)

### 1-1. ML 예측 (모델 v2.0.0 RandomForest 산출)

| 필드 | 내용 | 웹 사용처 | 상태 |
|---|---|---|---|
| `predicted_sales_per_store` | 다음 분기 점포당 매출 예측 | ③·히트맵·TOP10 | ✅ |
| `sales_percentile` | 업종 내 예측 매출 백분위 | ③·히트맵 | ✅ |

### 1-2. 종합진단 (규칙·점수 계산 — `diagnosis.py`, 가중치 `scoring_weights.yaml`)

| 필드 | 내용 | 웹 사용처 | 상태 |
|---|---|---|---|
| `overall_score` | 성분 가중합 종합점수 | 상권 내 업종 기회순위 + **① 진단 분해 카드** | ✅ |
| `grade` (A+~C) | 등급 | ① 진단 분해 카드 (웹 신호등과 구분 표기) | ✅ |
| `recommendation` | 한 줄 진단 문장 | ① 해석 문장 | ✅ |
| `strengths` / `risks` | 강점·리스크 목록 (JSON 배열) | ① ▲/▼ 목록 | ✅ |
| `market_stage` | 시장 단계 5종(성장/안정/경쟁심화/재편/쇠퇴) — 8/3 버그 수정으로 560상권 정정 | ① 경쟁 불릿 | ✅ |
| `confidence`·`available_quarter_count` | 신뢰도·표본 분기 수 | 리포트 메타(UC-004 안내 포함) | ✅ |
| 점수 성분 9종: 가점 `sales_potential`·`growth`·`demand`·`competition`·`score_safety_gu` / 감점 `closure_risk`·`score_rent_burden`·`score_vacancy_risk`·`score_price_rise_risk` (전부 업종 내 백분위) | 종합점수의 부품 — 가중치는 export 가 scoring_weights.yaml 에서 읽어 파일에 동봉 (웹 하드코딩 금지) | ① 진단 분해 카드 (가점/감점 바) | ✅ |
| `score_safety_gu` | 자치구 안전점수(범죄50·검거25·CCTV25 백분위) | ⑥ 이중 점수·히트맵 토글 + ① 성분 바 | ✅ |

### 1-3. v2 신규 — 독립점포·유형·밀도

| 필드 | 내용 | 웹 사용처 | 상태 |
|---|---|---|---|
| `indep_k_used`·`indep_k_source`·`indep_k_fit_r2`·`indep_k_sample_size` | 업종별 프랜차이즈 배수 k 와 추정 품질 (17/63 업종 통과) | ④ 독립점포 카드 근거 문장 | ✅ |
| `indep_estimated_sales` | k 적용 독립점포 기대 매출 (통과 업종만) | ④ 카드 본값 | ✅ |
| `indep_sales_scenarios` | 고정 k(1/1.5/2) 시나리오 | ④ 미통과 업종용 칩 | ✅ |
| `indep_is_pure`·`indep_only_percentile`·`indep_peer_count`·`indep_peer_median_sales` | 순수 독립 상권 여부·백분위·피어 관측 | ④ 카드 보조 | ✅ |
| `상권_유형`·`상권_유형_근거` | 5종 분류(혼합 869·직장 423·주거 163·유동 112·주말여가 3) | 헤더 뱃지 (+by-sangwon) + ③ 유형별 신뢰도 라벨 | ✅ |
| `resident/worker/foot_traffic_density_km2` (+`영역_면적`) | 인구 밀도 3종 (명/km²) | ⑤ 밀도 타일 (지도 레이어는 선택 과제로 남김) | ✅ |

### 1-4. 실측 스냅샷 (원천 이월 — 최신 분기)

| 그룹 | 대표 필드 | 웹 사용처 | 상태 |
|---|---|---|---|
| 매출 | `당월_매출_금액`·요일/시간대/성별/연령별 | ③ 실측 블록 (export 는 원본 CSV 로 재계산) | ✅ |
| 점포 | `유사_업종_점포_수`(전체)·`점포_수`(일반)·`프랜차이즈_점포_수`·개폐업 4종 | ④ | ✅ |
| 유동인구 | `총_유동인구_수` + 분포·`주말/야간 비율` | ⑤·컨텍스트 | ✅ |
| 상주·직장인구 | `총_상주인구_수`·`총_직장인구_수` (+성별·연령 분해) | ⑦ 배후지·유형 분류 재료 | ✅ |
| 가구 | `TOT/APT/NON_APT_HSHLD_CO` | ⑦ 아파트 블록 재료 | ✅ |
| 위치 | 좌표(EPSG:5181→위경도)·`영역_면적`·자치구·행정동 | 지도·최근접 매핑 | ✅ |
| 외부-부동산 | `re_rent_per_m2`·`re_vacancy_rate`·`re_rent_index`(+yoy·조인 메타) | 학습 피처 + 임대부담 점수 재료 + **⑦ 임대 시세 블록** (`gu_mean`=자치구 평균 조인임을 캡션 명시) | ✅ |
| 외부-치안 | `sf_crime_rate_per_100k`·`sf_arrest_rate`·`sf_cctv_per_km2`(+기준연도) | ⑥ (detail.safety 로 운반) | ✅ |
| 학습 파생 | `점포당_매출_ma2/ma4`·qoq/yoy 성장률·`분기_계절` 등 | 모델 내부 피처 | 🔧 |

## 2. 성적표 (`models/model_metadata.json`)

| 항목 | 내용 | 웹/팀 사용처 | 상태 |
|---|---|---|---|
| `test_breakdown.by_industry` | 업종별 MAE·SMAPE·표본·low_sample | ③ 예측 신뢰도 문구 | ✅ |
| `test_breakdown.by_commercial_type` | 상권유형별 채점 | ③ 유형별 신뢰도 (이중 표기) | ✅ |
| `test_breakdown.by_sales_size` | 매출규모별 채점 | 웹 표시 불가 — 레코드가 자신의 규모 구간 라벨을 갖고 있지 않음 (구간 경계가 metadata 에만 있음). 발표 자료용 | ⬜(사유) |
| `walk_forward` (4-fold) | 분기 이동 재채점 | §10 롤링 백테스트의 축소판 (발표 근거) | ⬜ |
| `model_comparison`·`ml_beats_baseline_on_test` | 모델 zoo vs 나이브 | 발표 핵심 수치 (−2.7%) | 발표용 |
| `ablation_valid`·`feature_selection` | 피처 묶음별 기여·채택 정책 | 문서·발표 (치안 제외 근거) | 발표용 |
| `known_limitations` | 한계 목록 | ⑧ 유의사항 서술 참고 | 참고 |

## 3. 정적 산출물 구성 (`model-exports/` — 웹이 실제로 읽는 파일)

| 파일 | 만들어지는 것 | 웹 기능 |
|---|---|---|
| `analyze/{업종}.json.gz` ×62 | 상권×업종 리포트 레코드 (①~⑨ 재료 전부) | `/api/analyze` |
| `heatmap/{업종}.json` ×62 | 셀 18,077 (생존·매출·백분위) | `/api/heatmap`·TOP10 |
| `by-sangwon.json.gz` | 상권별 업종 랭킹 (opportunityScore) | `/api/top-industries` |
| `meta/sangwons.json`·`industries.json` | 상권 1,570·업종 62 목록 | 검색·드롭다운·최근접 매핑 |
| `meta/safety-scores.json` | 자치구 25 안전점수+죄종 상세 (서빙 `score_safety_gu` 단일 소스) | ⑥·치안 토글 |
| `meta/hinterland.json.gz` | 배후지 1,633+ 상권 | ⑦ |
| `meta/closure-priors.json` | 업종 사전 폐업률 | 라이브 경로 축소추정 |

## 4. 활용 후보 재고 — **2026-08-05 전량 소진**

"모델이 주는 것 전부 구현 후 하나씩 의논하며 제거" 방침에 따라 1~5번을 모두 구현했다
(전부 optional — 재생성 후 등장). 남은 것:

1. ~~market_stage~~ ✅ · ~~인구 밀도~~ ✅(⑤ 타일 — 지도 레이어는 별도 선택 과제) ·
   ~~strengths/risks~~ ✅ · ~~by_commercial_type 이중 신뢰도~~ ✅ · ~~점수 성분 분해~~ ✅(① 카드)
2. `by_sales_size` 채점 — **웹 표시 불가** (위 §2 사유), 발표 자료용
3. `walk_forward` — 웹 리포트 성격 아님, 발표 슬라이드용 (분기별 성적 흐름)
4. (선택) 밀도 3종의 **지도 레이어** 버전 — ⑤ 타일로 일단 제공, 레이어는 지도 UX 작업

> ⚠️ 항목 추가 시 규칙 (CLAUDE.md): 계약은 optional 로, `provenance.ts` 계보 행 추가,
> 운반은 `export_web_static.py` 수정 후 **파이프라인 머신에서 재생성**.

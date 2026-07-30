# 미해결 과제 · 인계 문서

> 다른 세션/사람이 이어받을 수 있도록 **남은 문제와 해결 방법**을 정리한 문서.
> 최종 갱신: 2026-07-29 (세션 종료 인계)
>
> **지금 이어서 할 일**: 모델 쪽 데이터 편입 — 아래 §9 의 **2트랙** 을 먼저 읽을 것.
> 웹은 표시까지 실데이터 전환이 끝났다(§1 치안 · §6 배후지 · 계보 인스펙터). 남은 것은
> 파이프라인/학습 편입이며 팀원 소유 저장소(`Commercial-AI-`) 작업이라 합의가 필요하다.
>
> ⚠️ **이 PC 에서는 파이프라인을 돌릴 수 없다** — `Commercial-AI-/.venv` 도 `data/` 도 없다.
> README 의 데이터 재생성 커맨드는 이 머신에서 실패한다 (§9 참조).
>
> 📤 모델 저장소 담당자에게 보낼 요청서는 **[docs/MODEL-REQUESTS.md](MODEL-REQUESTS.md)** 에
> 정리해 뒀다 (§1~§3 을 근거·파일·라인 단위로 옮긴 것). 공유 후 회신 내용을 여기에 반영할 것.
> 근거를 직접 재현하려면 **[docs/VERIFY-GUIDE.md](VERIFY-GUIDE.md)** +
> `tools/verify_model_issues.py` (읽기 전용).
> 모델 저장소 구조를 처음 본다면 **[docs/MODEL-CODE-TOUR.md](MODEL-CODE-TOUR.md)**
> (신입 인수인계용 코드 투어)부터.
>
> 작업 전 [§0 자주 하는 오해](#자주-하는-오해-2026-07-28-정정)를 먼저 읽을 것 (치안·부동산이
> 학습 피처에 포함돼 있다는 사실을 놓치면 문서·UI 에 틀린 서술을 또 쓰게 된다).

## ⚠️ 먼저 알아야 할 것 — 저장소가 3개다

| 저장소 | 원격 | 상태 |
|---|---|---|
| `sanggwon-web/` (이 레포) | `Academic-competition/web-demo` | 푸시됨 |
| `Commercial-AI-/` (모델 정본) | `Academic-competition/Commercial-AI-` | 팀원 소유. 수정 전 합의 필요 |
| `academy/` (루트, 문서) | **없음** | **커밋도 안 됨 — 로컬 전용** |

**루트 저장소에 원격이 없다.** 그래서 `academy/CLAUDE.md`, `academy/files/DATA_REQUIREMENTS.md`,
`academy/README.md` 는 **이 레포를 clone 해도 볼 수 없다.** 아래 §0 에 핵심만 옮겨 뒀다.
루트 저장소를 살릴지(원격 생성) 문서를 이 레포로 옮길지는 미결정이다.

---

## 0. 옮겨온 핵심 컨텍스트 (루트 문서가 없어도 작업 가능하게)

### 데이터 재현 절차

```bash
# academy 루트에서. SEOUL_API_KEY 는 서울 열린데이터광장 무료 발급
Commercial-AI-/.venv/Scripts/python.exe Commercial-AI-/scripts/collect_data.py
Commercial-AI-/.venv/Scripts/python.exe Commercial-AI-/scripts/build_features.py
Commercial-AI-/.venv/Scripts/python.exe sanggwon-web/tools/prepare_feature_table.py
Commercial-AI-/.venv/Scripts/python.exe Commercial-AI-/scripts/build_serving_table.py
Commercial-AI-/.venv/Scripts/python.exe sanggwon-web/tools/export_web_static.py   # → model-exports/
```

- `scripts/train_model.py` 는 **실행하지 말 것** — 실데이터 189,411행 학습본을 덮어쓴다
- Python 은 시스템에 없다. `Commercial-AI-/.venv` (uv 로 생성) 사용
- `export_web_static.py` 는 **결정적**이다 (gzip mtime=0). 재실행 후 git diff 가 비어야 정상 —
  비어있지 않으면 데이터가 실제로 바뀐 것이다

### 되돌리면 안 되는 결정

- **생존율은 예측이 아니라 실측 폐업률 환산** `(1−분기폐업률)^12`, 3년 고정.
  **축소추정(k=20) 필수** — 안 하면 76.8% 가 정확히 100% 로 표시된다
  (상권×업종 점포 수 중앙값이 2개인 소표본 artifact)
- **매출은 점포당 예측값**, 상권 합산이 아니다. `scaleNote`/`scaleLabel` 을 서버가 주입한다.
  UI 에 집계수준을 하드코딩하면 한 리포트에서 문구가 모순된다 (실제 발생함)
- **점포 수 전체 = `유사_업종_점포_수`** (`점포_수` 는 프랜차이즈 제외).
  원천에서 `점포_수 + 프랜차이즈_점포_수 == 유사_업종_점포_수` 성립 — 받아둔 점포 CSV
  380,747행(2025Q1~2026Q1) 전부, 예외 0건. 재현: `tools/verify_model_issues.py`
- **신호등 판정은 웹 route handler 책임** (safe≥0.60 / caution≥0.45)
- **라이브는 옵트인** (`MODEL_SERVER_URL` 미설정 = 정적 사용)

### 자주 하는 오해 (2026-07-28 정정)

**"치안·부동산은 모델과 무관하다" — 틀렸다.** `models/model_metadata.json` 의 실제 피처 목록에
`sf_crime_rate_per_100k`·`sf_arrest_rate`·`sf_cctv_per_km2`·`re_rent_per_m2`·`re_vacancy_rate`·
`re_rent_index` 가 들어 있고, `chosen_step: "E_plus_safety"` / `external_features_included: true` —
**ablation 에서 MAE 가 개선돼 채택된 학습 피처다.** (metadata 의 `features` 는 리스트가 아니라
`{numeric, categorical}` dict 라 얕게 읽으면 "피처 2개"로 오독된다.)

치안이 쓰이는 곳은 셋이고, 지금 살아있는 것은 세 번째뿐이다:

| 경로 | 설계 | 현재 |
|---|---|---|
| 매출 예측 모델 학습 피처 | 포함 (ablation 채택) | **값이 NaN** → '모름' 처리, 예측값 평균 차이 ≈1.9% |
| 종합진단 `overall_score` (기회점수의 원천) | `safety_score` 5% (`scoring_weights.yaml`) | NaN 성분 제외 후 **가중치 재정규화** → 실질 미반영 |
| 웹 종합점수 '치안 반영' 토글 | `/api/safety` 5% (사용자 옵트인) | **동작** — 범죄 2024·CCTV 2025 실측 (§1) |

원인은 `prepare_feature_table.py` 가 외부 데이터 없이 파이프라인을 돌릴 때 이 6개 컬럼을
NaN 으로만 만들어 주기 때문이다(0·평균 대치 금지 — 거짓 사실이 된다). **문서·UI 에 "모델에
치안이 들어가지 않는다"고 쓰지 말 것.** 정확한 서술은 "학습에는 쓰이지만 현재 서빙 값이 비어
있다" 다. (README '데이터 흐름' 섹션·`docs/data-flow.svg`·리포트 ⑧ 유의사항이 이 표현을 쓴다.)

### 데이터 함정

- 분기 컬럼은 영문 `STDR_YYQU_CD` 만 자동 분리된다. 한글 헤더 CSV 의 `기준_년분기_코드` 는
  처리하지 않아 즉시 예외 → **API 로 받을 것**
- 좌표계는 **EPSG:5181** (m 평면). 위경도를 넣으면 최근접 매핑·지도가 깨진다
- 학습본이 외부 피처 6개(`re_*`/`sf_*`)를 요구한다. 값이 아니라 **컬럼**이 필요해
  `prepare_feature_table.py` 가 NaN 으로 채운다 (0/평균 대치 금지)
- `data/raw/sales.csv` ≈101MB → GitHub 100MB 제한. `Commercial-AI-/.gitignore` 에서 `data/` 무시

---

## 1. ✅ 안전점수 실데이터 전환 완료 (2026-07-28)

`/api/safety` 가 `sourceMode: "file"` 로 응답한다 — **범죄 2024 · CCTV 2025 실측**,
25개 자치구 전부. '치안 반영' 토글이 실제 통계로 순위를 바꾼다
(예: 강남구 상권 297위→317위 ▼20, 성북구 상권 904위→850위 ▲54).

산출물: `model-exports/meta/safety-scores.json` (3.9KB) — 스크립트가 사용한 **가중치·출처를
파일에 함께 기록**하고 웹이 그 문구를 그대로 노출한다(산식이 세 곳에서 갈라지는 것을 막는 장치).

```bash
# 원본은 data/raw/ (모델 저장소, gitignore). 재생성 커맨드
Commercial-AI-/.venv/Scripts/python.exe sanggwon-web/tools/build_safety_scores.py \
  --crime ../seoul-startup-opportunity-recommender/data/raw/crime.csv \
  --pop   ../seoul-startup-opportunity-recommender/data/raw/gu_population.csv \
  --cctv  "../seoul-startup-opportunity-recommender/data/raw/서울시 자치구 (범죄예방 수사용) CCTV 설치현황('25.12.31 기준).xlsx" \
  --out   model-exports/meta/safety-scores.json
```

| 사용 데이터 | 출처 | 기준 |
|---|---|---|
| 5대 범죄 발생·검거 (자치구별) | 서울 열린데이터광장 / 경찰청 | 2024 |
| 주민등록인구 | 서울 열린데이터광장 | 자치구 (10만명당 환산) |
| 범죄예방 CCTV 설치현황 (xlsx) | 서울시 | 2025 |
| 자치구 면적 | `build_safety_scores.py` 내장 상수 (`--area` 로 대체 가능) | 2024 |

**주의**
- 검거 수치는 발생을 초과할 수 있다 (종로구 1.17). 다른 기간 사건 검거·검거 인원 집계 때문이며
  원본 그대로 백분위에만 쓴다 — **'검거율'로 화면에 직접 표시하지 말 것**
- 자동 수집은 미구현 (`Commercial-AI-/scripts/collect_data.py:10`) — CSV 수동 다운로드
- 남은 것: **서빙 파이프라인 쪽 `detail.safety` 는 여전히 `null`** 이다. 정본 설계
  (`attach_safety()`)로 서빙 테이블에 조인하려면 `crime_gu.csv`/`cctv_gu.csv` 스키마로
  변환이 필요하다. 현재 웹은 `/api/safety` → 화면 계층 매칭으로 동작하며 이것으로 충분하다

**관련 파일**: `tools/build_safety_scores.py`, `lib/normalize.ts` 의 `safetyScores()`,
`app/api/safety/route.ts`, `app/page.tsx` 의 `safetyFromScores`/`extraSources`

---

## 2. 🔴 예상 매출이 과대 추정된다 (재학습 필요)

**현상**: 프랜차이즈 비중이 큰 업종에서 점포당 매출이 크게 과대.
업종 평균 부풀림 배수 — 편의점 3.10배 · 치킨전문점 2.23배 · 패스트푸드점 1.90배 (2025Q2 실측).
개별 상권은 더 크다: 동대문역사문화공원역 편의점 = 전체 22개(일반 1 + 프랜차이즈 21) → **22배**.

**원인**: 학습 타깃 `target_next_q_sales_per_store = 매출 ÷ 점포_수` 인데,
`점포_수`(`STOR_CO`)는 전체가 아니라 **일반(비프랜차이즈) 점포 수**다.
같은 이유로 `프랜차이즈_비율 = 프랜차이즈_점포_수 / 점포_수` 가 1.0 을 넘는다
(2025Q2 에서 1,554건, 최대 2,100%).

**현재 대응**: 점포 수·프랜차이즈 비율은 웹에서 역산 보정하고
(`lib/normalize.ts` 의 `correctStoreCounts()`) 보정 사실을 UI 3곳에 노출한다.
정적 산출물은 `유사_업종_점포_수` 를 직접 써서 애초에 올바르다.
**매출은 학습 타깃이라 웹에서 고칠 수 없다** — `scaleNote` 로 한계만 밝힌다.

**근본 해결** (팀원 합의 + 재학습):

1. `Commercial-AI-/src/features/build.py:99` — 프랜차이즈 비율 분모를 `유사_업종_점포_수` 로
2. `Commercial-AI-/src/features/schema.py` — 타깃 분모도 `유사_업종_점포_수` 로
3. `scripts/train_model.py` 재학습 → `models/sales_model.pkl` 갱신 (**기존 학습본 백업 먼저**)
4. `scripts/build_serving_table.py` + `tools/export_web_static.py` 재생성
5. `lib/normalize.ts` 의 `correctStoreCounts()` 제거 (이중 보정 방지) + `contracts.ts` 의
   `competition.correction` 정리

원본 데이터가 확보돼 있으므로 재학습이 가능하다. 아래 §3 과 함께 진행하면 좋다.

---

## 3. 🟡 ML 이 나이브 베이스라인에 열세

`Commercial-AI-/models/model_metadata.json` → `"ml_beats_baseline_on_test": false`.
test MAE 13,776,289(LightGBM) vs **13,572,510**("지난 분기와 같다"). SMAPE·R² 도 베이스라인 우세.

정직하게 기록되어 있다는 점은 강점이지만, 모델 성능이 평가 항목이면 최대 리스크다.
`scripts/tune_model.py` 가 존재하나 **실행된 적 없다** (metadata 에 `tuning` 키 없음).

**유력한 원인 두 가지** (§6 과 함께 보라):

1. **수요 측 핵심 피처가 아예 없다** — 상주(주거)인구·직장인구·소득이 미수집이라 학습에
   들어가지 않는다. 상권 매출 예측에서 이건 표준 피처다
2. **있는 외부 피처마저 값이 NaN** — `sf_*`/`re_*` 6개가 비어 있어(§0 '자주 하는 오해')
   ablation 에서 채택된 피처들이 실제로는 정보를 주지 못한다

즉 §6 의 데이터 확보가 §3 개선의 전제 조건이다. §2 의 타깃 분모 수정과 함께 재학습할 것.

---

## 4. 🟡 `meta.sources` 가 쓰이지 않은 출처까지 나열한다

외부(부동산·치안) 데이터 없이 파이프라인을 돌려도 모델 서버가 R-ONE·경찰청·CCTV 를
계속 출처로 나열한다. 값은 `null` 로 정직하지만 **출처 목록은 사실과 다르다.**

**원인**: `Commercial-AI-/api/dependencies.py` 가 `exports/meta/external_columns.json` 을
기동 시 그대로 읽고, `build_features.py` 는 외부 컬럼이 없으면 이 파일을 갱신하지 않아
과거 값이 남는다.

**해결**: 서버에서 실제 값 유무로 필터링하거나, 외부 컬럼이 없을 때 이 파일을 비우도록
`build_features.py` 를 수정. 모델 저장소 수정이라 합의 필요.

---

## 5. 🟡 라이브 경로가 정적보다 열등하다 (엔드포인트 부재)

`MODEL_SERVER_URL` 을 켜면 아래가 안 된다. **데이터 문제가 아니라 API 부재**다.

| 기능 | 라이브에서 안 되는 이유 | 모델 쪽 필요 작업 |
|---|---|---|
| 히트맵 생존율 | `/heatmap/{code}` 응답에 `closureRate` 가 없다 | `HeatmapItem` 에 필드 1개 추가 (~2줄) |
| 지역 우선 플로우 | 상권→업종 랭킹 엔드포인트가 없다 (`/recommendations` 는 반대 방향) | 신규 엔드포인트 |
| 추이·요일/시간대 차트 | 서빙 테이블이 최신 분기 스냅샷이라 시계열이 없다 | 별도 export 또는 엔드포인트 |

또 라이브 생존율은 **단일 분기 관측**만 쓸 수 있어 정적(10분기 누적 축소추정)보다 거칠다.
같은 상권×업종이 라이브 84.2% / 정적 97.0% 처럼 갈릴 수 있다.
**그래서 로컬 기본값을 정적으로 맞춰 뒀다** (배포와 동일 동작).

---

## 6. 🟡 배후지 — **웹 ⑦ 실데이터 전환 완료(2026-07-29) · 파이프라인 편입은 미완**

CSV 5종을 받아 `tools/build_hinterland.py` → `model-exports/meta/hinterland.json.gz`
(1,649 상권, 167KB) → `/api/hinterland` 로 연결했다. **`mockHinterland()` 는 삭제됐고, 데모에
남은 목업은 치안 폴백(`mockSafety`, 실데이터 있으면 미호출) 하나뿐이다.**

| 파일 (열린데이터광장) | 2025Q2 커버리지 | 값 있는 최신 분기 |
|---|---|---|
| `resident.csv` 상주인구-상권 (OA-15584) | 1,633 | 2026Q1 |
| `worker.csv` 직장인구-상권 (OA-15569) | 1,641 | 2026Q1 |
| `apartment.csv` 아파트-상권 (OA-15566) | 1,463 | 2026Q1 |
| `facility.csv` 집객시설-상권 (OA-15580) | 1,578 | 2026Q1 |
| `income.csv` 소득소비-상권배후지 (OA-15571) | 1,089 | **2023Q4** |

### 확정된 데이터 한계 (되돌리지 말 것)

- **소득 분위는 이 데이터셋에 없다** — `income.csv` 에는 소득이 아니라 **지출 금액만** 있다
  (`지출_총금액` + 카테고리 9종). golmok 의 "소득수준 N분위" 는 다른 소스이며, 지출로 소득을
  역산하면 근거 없는 수치가 된다. **후속**: 소득 컬럼이 있는지 `소득소비-상권`(OA-21278) 확인
- **총 가구 수는 없다** — `apartment.csv` 는 아파트 세대수만. UI 라벨에 '가구 수' 를 쓰지 말 것
  (현재 "N단지 / 세대" 로 표기)
- **임대시세는 R-ONE 별도** — 정본 `re_*` 파이프라인은 있으나 값 미보유
- **소비지출은 2024Q1 부터 원본이 비어 있다** (행은 있고 금액이 NaN). 그래서 **항목별 as-of** 를
  쓰고 각 블록에 기준 분기 칩을 표기한다 — 한 분기로 강제하면 최신 4종을 2023Q4 로 끌어내려야 한다
- **소비지출의 ML 편입은 보류** — `sales.csv`(2025Q1~2026Q1)와 income 값 구간(2021Q1~2023Q4)이
  **겹치는 분기가 0개**라 타깃 누출을 검증할 방법이 없다. 표시용으로만 쓴다
- 없는 항목은 ⑦ 하단 "제공하지 않는 항목" 에 이유와 함께 노출한다 (`hinterland.json.gz` 의
  `unavailable` 필드). **빈칸을 목업으로 채우지 않는다**

### 남은 것 — 파이프라인/모델 편입 (팀원 합의 필요)

`Commercial-AI-/config/data_sources.yaml:62,71` 의 서비스명이 여전히 `verified: false` 라
자동 수집에서 빠져 있다 (`VwsmTrdarRepopQq` / `VwsmTrdarWrcPopltnQq`). 그래서 두 가지가 남는다:

1. **ML 수요 측 피처 공백** → §3 의 베이스라인 열세. 상주·직장인구는 시점이 맞고 누출 위험도
   없어 1순위다 (웹 ⑦ 은 이미 실측이지만 모델 입력에는 안 들어간다)
2. **상권 유형 분류 축소** — `총_상주인구_수`·`총_직장인구_수` 결측으로 주거형·직장형이 배정되지
   않고 혼합형/유동형/주말·여가형 3종만 나온다

### 어떤 항목을 ML 피처로 넣을지 (판단 기준 = 상권×분기 키와 맞는가)

| 항목 | ML 피처 | 근거 |
|---|---|---|
| 상주(주거)인구 · 직장인구 | ⭐ 최우선 | 상권×분기 단위 — 기존 표와 병합 키가 같다. 수요 기반 표준 피처 |
| 소득분위 | 넣는다 | 상권 단위. 구매력 → 매출 직결 |
| 가구수 · 아파트 비율 | 넣는다 | 상권 단위. 주거 수요 대리변수 |
| 집객시설 | 넣는다 | 상권 단위. 유입 요인 |
| 소비트렌드 | ⚠️ **누출 검증 먼저** | 카드 지출 기반이면 타깃(매출)과 같은 원천이다. 확인 없이 넣지 말 것 |
| 임대시세 (`re_*`) | 이미 피처 | 조사상권 최근접 매핑(추정값). 값만 채우면 된다 |
| 치안 · CCTV (`sf_*`) | 이미 피처 (재검토 여지) | 자치구 25개 값이 상권 1,570개에 복사된다 → 이미 범주형 피처인 `자치구_코드_명` 과 정보가 겹칠 수 있다. ablation 으로 재확인 |

### 순서

1. 실제 API 응답으로 서비스명 검증 → `data_sources.yaml` 의 `verified: true` + 수집 추가
2. `collect_data.py` → `build_features.py` (외부 데이터가 있으면 `prepare_feature_table.py` 는
   불필요해진다) → `build_serving_table.py` → `export_web_static.py`
3. 소비트렌드는 타깃 누출 확인 후 포함 여부 결정. ablation 으로 성능 기여 확인
4. 웹: `lib/mockExtras.ts` 의 `mockHinterland()` 제거, ⑦ 섹션을 서빙 `detail` 로 교체,
   ⚠ 예시 배너와 유의사항 문구 삭제 (§1 의 치안 전환과 같은 패턴)

⚠️ 2·3 은 모델 저장소 수정 + 재학습이라 **팀원 합의 필요**. §2(타깃 분모)와 함께 진행하면
재학습 한 번으로 끝난다.

---

## 7. 🟢 자잘한 것들

- **ESLint 오류 6건 + 경고 2건** — 전부 `react-hooks/refs`(렌더 중 ref 읽기/쓰기)와
  `set-state-in-effect`. `app/page.tsx:470`(×3), `components/MapView.tsx:79,191,193`.
  Next 16 은 빌드에서 lint 를 돌리지 않아 배포는 통과한다. 고치려면 ref → state 전환이나
  `useSyncExternalStore` 로 구조 변경이 필요해 동작 영향을 검토해야 한다
- **업종 랭킹이 없는 상권 5개** — 모든 업종이 표본 부족인 상권(`종로5가역 4번`,
  `배꽃어린이공원`, `연희지하차도`, `문래역 3번`, `마천공원`). 빈 목록 + 사유 안내로
  처리되며 업종 직접 선택 경로가 열린다. 데이터가 없어 구조적으로 해결 불가
- **리포트 블록을 추가하면 `lib/provenance.ts` 의 계보 표에도 행을 추가할 것.** 인스펙터의
  `ML`/`데이터 계보` 두 줄이 "이 서비스는 CSV 조회 아니냐"에 대한 답이라, 새 블록이 계보에
  빠지면 그 답이 부정확해진다. 분류는 응답 필드에서 파생하고 하드코딩하지 말 것
  (CLAUDE.md 에도 규칙으로 적어 뒀다)
- **`lib/mockExtras.ts`** — `mockHinterland()` 는 §6 전환으로 삭제됐다. 남은 `mockSafety()` 는
  §1 전환 후 호출되지 않지만 폴백으로 유지한다. 파일 상단 주석에 **소득분위·가구수·임대시세를
  왜 뺐는지** 히스토리를 남겼다 (같은 항목을 다시 목업으로 채우지 않도록)
- **`Commercial-AI-` 미커밋 25건** — `.gitignore`(신규, `data/` 무시로 101MB 푸시 차단 해결) +
  이미 추적 중인 `__pycache__` 24건. 후자는 `git rm -r --cached "**/__pycache__"` 로
  정리 가능하나 팀원 레포 인덱스를 바꾸는 일이라 보류 중
- **`tools/` 가 이 레포에 있는 이유** — 루트 저장소에 원격이 없어서, 배포 데이터를 만드는
  스크립트가 어디에도 푸시되지 않는 상태였다. 재현성을 위해 이 레포로 옮겼다.
  `prepare_feature_table.py` 는 개념상 모델 저장소 소속이지만 같은 이유로 여기 있다

---

## 8. 배포 체크리스트 (Vercel)

- [ ] **`NEXT_PUBLIC_KAKAO_MAP_KEY`** 를 Vercel 프로젝트 환경변수에 등록.
      `NEXT_PUBLIC_*` 는 **빌드 시점 인라인**이라 `.env.local` 은 올라가지 않는다.
      없으면 지도 대신 상권 검색 리스트 폴백으로 뜬다. **변수 추가 후 재배포 필요**
- [ ] 카카오 개발자 콘솔 → Web 플랫폼에 **배포 도메인 등록** (없으면 `ERR_BLOCKED_BY_ORB`).
      curl 은 Referer 가 없어 성공하므로 브라우저로 진단할 것
- [ ] `MODEL_SERVER_URL` 은 **비워 둘 것** (Vercel 에 모델 서버가 없다. 설정하면 매 요청마다
      실패할 fetch 를 낭비한다)
- [ ] `model-exports/` 가 커밋되어 있고 `next.config.ts` 의 `outputFileTracingIncludes` 에
      **6개 라우트**(`analyze`/`heatmap`/`meta`/`top-industries`/`safety`/`hinterland`)가
      모두 있는지 확인 — 누락하면 로컬은 되고 **배포에서만 502**
- [x] **GitHub 자동배포 연결됨 (2026-07-28)** — `main` 푸시 후 ~1분이면 새 배포가 뜨고
      프로덕션 alias 가 자동 전환된다. `npx vercel --prod` 수동 배포는 이제 불필요.
      확인: `npx vercel inspect web-demo-kappa-two.vercel.app` 의 `created` 가 방금인지 본다

---

## 9. 🔴 모델 쪽 데이터 편입 — **2트랙** (다음 작업)

받아둔 데이터가 **웹 표시에는 다 들어갔지만 모델에는 아직 안 들어갔다.** 성질이 다른 두 갈래다.

### ⚠️ 먼저: 이 개발 PC 에서는 파이프라인을 돌릴 수 없다

| 필요한 것 | 이 PC 상태 |
|---|---|
| `Commercial-AI-/.venv` | **없음** |
| `Commercial-AI-/data/raw/*` (sales 등 원본) | **없음** (`data/` 폴더 자체가 없다) |
| `data/processed/serving_table.parquet` | 없음 |

즉 README 의 재생성 커맨드(`Commercial-AI-/.venv/Scripts/python.exe scripts/...`)는 **여기서
실패한다.** 현재 `model-exports/` 는 다른 머신에서 만들어 커밋된 것을 그대로 쓰는 상태다.
`seoul-startup-opportunity-recommender/.venv` (Python 3.14) 는 있고 배후지·안전점수 산출
스크립트는 그걸로 돌렸다 — 그 둘은 원본 CSV 만 있으면 되기 때문이다.

**선행 작업**: 모델 파이프라인을 돌릴 머신에서 `uv` 로 `Commercial-AI-/.venv` 생성 +
`scripts/collect_data.py` 로 원본 수집 (`SEOUL_API_KEY` 필요). 또는 다른 세션/머신에 위임.

### 트랙 1 — **재학습 없이** 되는 것 (치안·부동산 값 채우기)

`sf_*`/`re_*` 6개는 **이미 학습된 피처**인데 서빙 값이 NaN 이다(§0 '자주 하는 오해').
값만 채우면 학습된 모델이 그 피처를 실제로 쓴다. 재학습·팀원 코드 수정 없이 가능하다.

1. 우리가 받은 원본을 정본이 기대하는 스키마로 변환해 `Commercial-AI-/data/raw/external/` 에 둔다
   - `crime_gu.csv` ← `자치구, 연도, 범죄_발생_건수, 범죄_검거_건수, 인구`
     (재료: `crime.csv` 2024 + `gu_population.csv`. `src/features/external.py:52` 가 이 컬럼을 요구)
   - `cctv_gu.csv` ← `자치구, 연도, cctv_대수, 자치구_면적_km2`
     (재료: CCTV xlsx 2025 + `tools/build_safety_scores.py` 의 `GU_AREA_KM2`)
   - `rone_rent.csv` (임대시세) 는 R-ONE 미보유 → 생략하면 `re_*` 는 계속 NaN
2. `build_features.py` → (외부 데이터가 있으면 `prepare_feature_table.py` 불필요) →
   `build_serving_table.py` → `tools/export_web_static.py` 재실행
3. 효과: 예측값이 약 1.9% 변동(스크립트 주석의 측정치), `overall_score` 의 safety 5% 가 실제로
   반영되고 `detail.safety` 가 채워진다 → 웹의 `/api/safety` 경로와 **이중 계산이 되므로**
   그때 `page.tsx` 의 `safetyFromScores` 우선순위를 다시 볼 것(현재는 서빙 우선이라 자동 정리됨)

### 트랙 2 — **재학습이 필요한 것**

- **새 피처 편입**: 상주인구·직장인구(+선택: 아파트·집객시설)는 학습본에 없던 컬럼이라 재학습
  해야 한다. `config/data_sources.yaml:62,71` 의 `verified: false` → 검증 후 `true` + 수집 추가.
  판단표는 §6 참조. **소비지출은 제외** (누출 검증 불가 · 시점 불일치)
- **타깃 분모 수정**: §2 의 5단계. 프랜차이즈 제외 점포수 → `유사_업종_점포_수`
- 두 개를 **한 번의 재학습으로 묶는 것**이 효율적이며, §3(베이스라인 열세) 개선 기대치도 여기 있다
- `models/sales_model.pkl` **백업 먼저**. `scripts/train_model.py` 는 실데이터 189,411행
  학습본을 덮어쓴다

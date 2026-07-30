# Commercial-AI- 코드 투어 — 신입 인수인계 가이드

> 모델 저장소(`Commercial-AI-`)가 무엇을 어떻게 하는지, 코드를 처음 보는 사람 기준으로
> 설명한다. 비유로 큰 그림을 잡고 → 폴더 지도 → 데이터가 흐르는 5단계 → 우리가 발견한
> 문제 3개가 어디에 있는지 순서로 간다.
>
> 이 문서의 사실관계는 2026-07-29 기준 저장소에서 직접 확인한 것이다.
> 직접 재현: `web-demo/tools/verify_model_issues.py` (읽기 전용) · [VERIFY-GUIDE.md](VERIFY-GUIDE.md)

---

## 0. 이 저장소는 뭐 하는 물건인가 — 한 문장

**서울시 공공데이터를 받아서 → "다음 분기, 이 상권에서 이 업종 가게 한 곳이 얼마나 팔릴까"를
예측하는 AI를 만들고 → 웹이 쓸 수 있는 형태로 포장해 내보내는 공장.**

공장 비유로 전체를 잡으면:

| 공장 단계 | 이 저장소에서 |
|---|---|
| ① 재료 입고 | 서울 열린데이터광장 API 에서 CSV 4종 수집 |
| ② 재료 손질 | 4종을 한 표로 합치고, 파생 재료(성장률·비율 등) 만들기 |
| ③ 요리사 훈련 | LightGBM 모델 학습 + 성적표 기록 |
| ④ 진열대 채우기 | 최신 분기에 예측·점수를 붙인 "서빙 테이블" 생성 |
| ⑤ 판매 | FastAPI 서버(라이브) 또는 정적 JSON(웹 데모가 쓰는 것) |

웹 데모(`web-demo`)는 ⑤에서 나온 **정적 JSON 묶음(`model-exports/`)** 을 가져다 쓴다.
즉 웹은 이 공장의 "매장"이고, 이 저장소가 "공장"이다.

---

## 1. 폴더 지도

```
Commercial-AI-/
├── scripts/      ← 공장 라인의 "버튼"들. 사람이 실행하는 진입점
├── src/          ← 실제 일하는 코드 (버튼을 누르면 여기가 돌아감)
│   ├── api_loader.py        ← 서울 API 호출기 (페이지네이션·재시도)
│   ├── legacy_api_config.py ← 수집 대상 목록 SERVICE_NAMES (★중요)
│   ├── preprocessing/       ← 영문 컬럼명→한글 이름표(aliases), 값 정리(clean)
│   ├── features/            ← 병합(merge)·파생재료(build)·외부데이터(external)·상권유형(classify)
│   ├── training/            ← 분할(splits)·모델정의(models)·학습·평가(train)·튜닝(tune)
│   ├── scoring/             ← 점수 계산 (안전점수·임대부담 등)
│   ├── serving/             ← 서빙 테이블 생성(build)·종합진단(diagnosis)
│   └── validation/          ← 병합이 터지지 않았는지 검증(quality)
├── config/       ← 정책·명세 (코드 아님)
│   ├── data_sources.yaml    ← 데이터 명세서 (어디서 오고 단위가 뭔지)
│   ├── scoring_weights.yaml ← 점수 레시피 (가중치)
│   └── settings.yaml        ← 파이프라인 설정 (경로·윈도우·분할 정책)
├── models/       ← 학습 결과물: sales_model.pkl + model_metadata.json(성적표)
├── api/          ← FastAPI 서버 (라이브 서빙)
├── exports/      ← 이 저장소 자체의 정적 산출물 (웹 것과 다름 — FAQ 참조)
├── legacy/       ← 옛 버전 코드 보관소 (지금은 안 씀)
└── data/         ← 원본·중간 산출물 (gitignore — 저장소에 없고 각자 로컬에만)
```

외우지 말고 이것만: **scripts = 버튼, src = 일꾼, config = 정책, models = 결과물.**

---

## 2. 공장 라인 5단계 — 데이터가 흐르는 순서

### 1단계. 재료 입고 — `scripts/collect_data.py`

- **하는 일**: 서울 열린데이터광장 API를 호출해 CSV 4종을 `data/raw/` 에 저장
- **무엇을 가져오나**: `src/legacy_api_config.py:68` 의 `SERVICE_NAMES` 딕셔너리가 목록이다

```python
SERVICE_NAMES = {
    "sales":      "VwsmTrdarSelngQq",   # 추정매출-상권
    "population": "VwsmTrdarFlpopQq",   # 길단위(유동)인구-상권
    "store":      "VwsmTrdarStorQq",    # 점포-상권
    "area":       "TbgisTrdarRelm",     # 상권 영역(좌표)
}
```

- **여기에 없는 건 수집 안 된다.** 상주인구·직장인구가 없는 이유가 이것이다 (→ 문제 ②)
- 외부데이터(치안·부동산)는 자동 수집이 아예 미구현 — 사람이 CSV를 만들어
  `data/raw/external/` 에 두면 2단계가 알아서 붙인다 (→ 문제 ③)
- 준비물: 환경변수 `SEOUL_API_KEY`

### 2단계. 재료 손질 — `scripts/build_features.py`

가장 일이 많은 단계. 순서대로:

1. **이름표 붙이기** — `src/preprocessing/aliases.py`
   API 응답의 영문 컬럼(`THSMON_SELNG_AMT`)을 한글(`당월_매출_금액`)로 바꾼다.
   ※ 상주/직장인구용 이름표는 **이미 준비돼 있다** (`TOT_REPOP_CO → 총_상주인구_수` 등, 81줄~)
2. **합치기** — `src/features/merge.py`
   4종을 `분기 × 상권 × 업종` 한 표로. `src/validation/quality.py` 가 병합마다
   "행이 늘거나 사라지지 않았는지" 검증 리포트를 남긴다
3. **파생 재료 만들기** — `src/features/build.py`
   과거 매출 이동평균(ma2/ma4), 성장률(qoq/yoy), 점포당 매출, 프랜차이즈 비율,
   그리고 **정답지(타깃)**: `다음 분기 매출 ÷ 다음 분기 점포 수` (127줄) ← 문제 ①의 현장
4. **외부 데이터 붙이기** — `src/features/external.py`
   `data/raw/external/` 에 `crime_gu.csv`·`cctv_gu.csv`·`rone_rent.csv` 가 있으면
   치안(`sf_*`)·부동산(`re_*`) 컬럼을 만든다. **없으면 조용히 건너뛴다**
   (`build_features.py:91,101` 에 "[안내] ... 없음 → 미생성" 출력만 하고 계속)
5. **상권 유형 분류** — `src/features/classify.py`
   주거형/직장형/유동형/주말·여가형/혼합형. 단, 상주·직장인구가 없으면
   주거형·직장형은 배정 불가 → 지금은 3종만 나온다

- **출력**: `data/processed/feature_table.parquet` (학습용 큰 표. 189,411행)

### 3단계. 요리사 훈련 — `scripts/train_model.py`

- **하는 일**: feature_table 로 LightGBM 회귀 모델 학습
- **어떻게 나누나** — `src/training/splits.py`: 시간순으로 자른다
  (마지막 분기 = test, 그 앞 = valid — 미래를 미리 보지 못하게)
- **비교 상대** — 단순규칙 베이스라인 2종과 항상 비교한다
  ("지난 분기와 같다", "최근 4분기 평균"). 현재 **"지난 분기와 같다"에게 1.5% 지고 있다**
- **ablation** — 피처 묶음을 단계별로 더하며 성능 변화를 기록 (A→B→C→C2→D→E).
  치안(E)이 채택된 근거가 이 기록이다
- **출력 2개**:
  - `models/sales_model.pkl` — 학습된 모델 (덮어쓰면 복구 불가 → **실행 전 백업**)
  - `models/model_metadata.json` — **성적표**. 무슨 피처를 썼고, 성능이 얼마고,
    베이스라인과 비교가 어떤지 전부 기록. 뭔가 궁금하면 여길 먼저 본다
- `scripts/tune_model.py` (하이퍼파라미터 튜닝)는 존재하지만 **아직 실행된 적 없음**

### 4단계. 진열대 채우기 — `scripts/build_serving_table.py`

- **하는 일**: 최신 분기 스냅샷(상권×업종 21,452행)에 대해
  1. 학습된 모델로 **예측 매출** 계산
  2. `src/scoring/scores.py` — 안전점수·임대부담점수 등 (자치구 단위는 broadcast)
  3. `src/serving/diagnosis.py` — **종합점수(overall_score)** = 성분들의 가중합
     (가중치는 `config/scoring_weights.yaml`), 등급(A+~C), 강점/리스크 문장
- **출력**: `data/processed/serving_table.parquet` — 웹에 보여줄 모든 숫자가 든 완성표
- 알아둘 것: 성분이 비어 있으면(NaN) **그 성분을 빼고 가중치를 재정규화**한다.
  치안이 비어 있는 지금, 종합점수는 치안 없이 계산되고 있다 (에러가 아니라 조용히)

### 5단계. 판매 — 두 가지 통로

| 통로 | 파일 | 쓰임 |
|---|---|---|
| 라이브 API | `api/server.py` — `/health` `/meta/*` `/reports/summary` `/recommendations/{업종}` `/heatmap/{업종}` | 모델 서버를 띄울 때 (현재 데모는 미사용) |
| **정적 export** | `web-demo/tools/export_web_static.py` — 서빙 테이블 → JSON 묶음 | **웹 데모가 쓰는 기본 경로.** 결과가 `web-demo/model-exports/` 에 커밋됨 |

웹 데모는 Vercel(서버리스)이라 파이썬 모델 서버를 못 띄운다. 그래서 서빙 테이블을
미리 JSON으로 "구워서" 웹 저장소에 커밋해 두고, 웹은 그 파일만 읽는다.

---

## 3. 성적표 읽는 법 — `models/model_metadata.json`

궁금한 것 대부분이 이 파일에 있다. 핵심 키:

| 키 | 뜻 | 현재 값 |
|---|---|---|
| `target_definition` | 정답지 정의 | 다음 분기 매출 ÷ 다음 분기 점포 수 |
| `features` | 모델이 보는 정보 | `{numeric: 24개, categorical: 5개}` — **dict 라서 얕게 읽으면 "2개"로 오독 주의** |
| `chosen_config_test_metrics` | 최종 성능 | MAE 13,776,289 |
| `model_comparison` | 단순규칙과 비교 | 지난분기규칙 MAE 13,572,510 (모델보다 좋음) |
| `ml_beats_baseline_on_test` | 베이스라인을 이겼나 | **false** |
| `ablation_valid` | 피처 묶음별 기여 | 계절성 −9.2% · 치안 −0.5% · 부동산 +0.06%(악화) |
| `known_limitations` | 알려진 한계 | 개발자가 스스로 적어둔 것 — 읽어볼 가치 있음 |

---

## 4. 설정 3파일 — 코드 아닌 "정책"

| 파일 | 역할 | 대표 항목 |
|---|---|---|
| `data_sources.yaml` | **데이터 명세서** — 각 데이터가 어디서 오고, 공간/시간 단위가 뭔지 | `verified: false` = "실제 API로 확인 안 됨" 이라는 **메모** (스위치 아님 — FAQ) |
| `scoring_weights.yaml` | **점수 레시피** — 안전점수 성분 비율, 종합점수 가중치, 등급 경계 | 안전점수 = 범죄율50+검거25+CCTV25 / 종합에서 safety 5% |
| `settings.yaml` | **파이프라인 설정** — 경로, 최소 관측 분기(4), 이동평균 윈도우, 분할 정책 | `test_quarters: 1` |

세 파일 모두 첫 줄에 "이 값들은 서비스 정책이며 객관적 사실이 아님"이라고 적혀 있다 —
가중치를 사실처럼 발표하지 말라는 뜻이다.

---

## 5. 우리가 발견한 문제 3개 — 지도 위에 표시

이제 전체 그림 위에서 보면 위치가 명확하다.

### 문제 ① 매출 부풀림 — 2단계 손질실의 저울이 잘못됨

- **위치**: `src/features/build.py` 72 · 99 · 127줄 (+ `schema.py:8` 주석)
- **내용**: 세 나눗셈의 분모 `점포_수` 가 전체가 아니라 **프랜차이즈 제외** 수다.
  전체는 `유사_업종_점포_수`. 원천 데이터 380,747행 전부에서
  `점포_수 + 프랜차이즈_점포_수 == 유사_업종_점포_수` 가 성립(예외 0건)한다
- **증상**: 편의점 평균 3.1배, 최악 상권 22배 부풀림. 프랜차이즈 적은 업종은 멀쩡 →
  업종마다 달라서 눈에 안 띄었음
- **수리**: 분모 교체 → **3단계 재학습** → 4·5단계 재생성. 웹의 임시 보정 코드
  (`correctStoreCounts()`)는 그 후 제거

### 문제 ② 상주·직장인구 부재 — 1단계 재료 목록에 없음

- **위치**: `src/legacy_api_config.py:68` 의 `SERVICE_NAMES` (여기에 없음)
- **정확한 사정**: `data_sources.yaml` 의 `verified: false` 는 코드가 읽는 스위치가 **아니라**
  "실제 API 호출로 확인 전" 이라는 개발자 메모다. 진짜 이유는 수집 목록에 두 서비스가
  아예 없어서 호출 자체가 안 되는 것
- **좋은 소식**: 전처리 이름표(`aliases.py:81~`)는 이미 준비돼 있다. 저희가 CSV로 받아
  데이터셋 자체도 확인했다(각 3.4만행, 21분기). **`SERVICE_NAMES` 에 두 줄 추가 + API 호출
  확인이면 수집이 뚫린다** — 다만 새 피처로 쓰려면 **3단계 재학습** 필요
- **효과**: 수요 측 피처 확보(성능 개선 여지 가장 큼) + 상권 유형 5종 복원

### 문제 ③ 치안 값 공백 — 2단계 외부재료 칸이 비어 있음

- **위치**: `data/raw/external/` 에 `crime_gu.csv`·`cctv_gu.csv` 가 없음
  (파일이 없으면 `build_features.py:91` 이 안내만 출력하고 건너뜀)
- **모순**: 학습 때는 있었다 — 성적표에 ablation E단계가 기록돼 있고
  `exports/meta/external_columns.json` 에 기준연도(2024/2025)까지 남아 있다.
  즉 **모델은 치안을 보도록 훈련됐는데, 지금 진열대에는 치안 값이 빈칸**
- **수리**: 파일 복원(팀원 로컬에 있을 가능성 높음) 또는 저희 원본으로 변환 →
  2·4·5단계 재실행. **재학습 불필요.** 효과는 작지만(ablation −0.5%) 비용도 가장 작다

---

## 6. FAQ — 헷갈리기 쉬운 것

**Q. `verified: false` 를 `true` 로 바꾸면 수집되나?**
아니다. 그 값을 읽는 코드가 없다. 수집되게 하려면 `SERVICE_NAMES` 에 항목을 추가해야 한다.
`true` 로 바꾸는 건 "실제 API 호출로 확인했음"을 기록하는 문서 행위다 (확인 후에 바꿀 것).

**Q. 모델 저장소의 `exports/` 와 웹의 `model-exports/` 는 같은 건가?**
다르다. 스키마가 서로 다르고(`items`↔`cells`, `districtCode`↔`sangwonCode`),
웹이 쓰는 건 **웹 저장소의 `model-exports/`** 뿐이다. 모델 쪽 `exports/` 를 웹에 연결하면
조용히 빈 화면이 된다 (웹 README 경고 참조).

**Q. `legacy/` 폴더는?**
1차 버전(구 모델) 코드 보관소. 지금 파이프라인은 안 쓴다. 참고용.

**Q. 이 저장소 스크립트를 우리 PC에서 돌릴 수 있나?**
못 돌린다. `.venv` 와 `data/` 가 없다 (원본이 gitignore 라 clone 에 안 딸려옴).
파이프라인 실행은 그 환경이 있는 머신(팀원)에서만 가능하다. 우리가 돌릴 수 있는 건
원본 CSV만 필요한 읽기 전용 검증·산출 스크립트들(`web-demo/tools/*`)이다.

**Q. 왜 웹은 라이브 API 대신 정적 JSON을 쓰나?**
Vercel 서버리스에는 파이썬 모델 서버를 띄울 수 없고, 정적 쪽이 오히려 데이터가 더 풍부하다
(10분기 누적 생존율·추이·요일별 차트). 라이브는 옵트인(`MODEL_SERVER_URL`)으로 남겨뒀다.

---

## 7. 직접 눌러보기 (전부 읽기 전용)

```bash
# 문제 3개의 근거를 한 번에 재현
seoul-startup-opportunity-recommender/.venv/Scripts/python.exe web-demo/tools/verify_model_issues.py

# 성적표 열어보기
type Commercial-AI-\models\model_metadata.json     # (PowerShell 은 cat)

# 점수 레시피 / 데이터 명세서 / 파이프라인 설정
type Commercial-AI-\config\scoring_weights.yaml
type Commercial-AI-\config\data_sources.yaml
type Commercial-AI-\config\settings.yaml

# 수집 목록 (문제 ②의 현장)
type Commercial-AI-\src\legacy_api_config.py

# 타깃 나눗셈 (문제 ①의 현장) — 72·99·127줄
type Commercial-AI-\src\features\build.py
```

관련 문서: [MODEL-REQUESTS.md](MODEL-REQUESTS.md)(팀원 요청서) ·
[VERIFY-GUIDE.md](VERIFY-GUIDE.md)(검증 해설) · [OPEN-ITEMS.md](OPEN-ITEMS.md)(전체 인계)

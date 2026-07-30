# 직접 확인해보기 — 모델 문제 3개를 눈으로 보는 가이드

> [MODEL-REQUESTS.md](MODEL-REQUESTS.md) 의 주장을 **문서만 믿지 말고 직접 확인**하기 위한 가이드.
> 읽기 전용입니다 — 데이터를 바꾸거나 학습을 돌리지 않습니다.

## 0. 한 번에 다 보기

`academy` 루트(= `web-demo` 의 부모 폴더)에서:

```bash
seoul-startup-opportunity-recommender/.venv/Scripts/python.exe web-demo/tools/verify_model_issues.py
```

문제 3개의 근거가 한 번에 출력됩니다. 아래는 **각 출력이 무슨 뜻인지** 와,
**코드에서 어디를 열어보면 되는지** 설명입니다.

> 한글이 깨져 보이면 콘솔 인코딩 문제입니다(값 자체는 정상). 이 스크립트는 UTF-8 로 출력하도록
> 처리해 뒀고, 그래도 깨지면 PowerShell 에서 `$env:PYTHONIOENCODING="utf-8"` 을 먼저 실행하세요.

---

## 1. 문제 ① — 예상 매출이 부풀려져 있다

### 무슨 일인가

AI 는 "가게 한 곳당 매출" 을 예측합니다. 그걸 만들 때 **총 매출 ÷ 가게 수** 를 계산하는데,
나누는 `가게 수` 가 **전체가 아니라 '프랜차이즈를 뺀 개수'** 입니다.
분모가 작으니 결과가 커집니다.

### 데이터로 확인 — 왜 그렇게 단정할 수 있나

원천 데이터에 점포 관련 컬럼이 3개 있습니다.

| 우리가 받은 CSV | 모델이 쓰는 API 필드 | 의미 |
|---|---|---|
| `전체_점포_수` | `유사_업종_점포_수` (`SIMILR_INDUTY_STOR_CO`) | **진짜 전체** |
| `일반_점포_수` | `점포_수` (`STOR_CO`) | 프랜차이즈 제외 ← 모델이 '전체'로 씀 |
| `프랜차이즈_점포_수` | `프랜차이즈_점포_수` (`FRC_STOR_CO`) | 프랜차이즈만 |

스크립트 출력:

```
항등식 '일반 + 프랜차이즈 == 전체' : 성립 380,747행 / 불일치 0행 (전체 380,747행)
```

**38만행 전부 성립하고 예외가 0건**입니다. 즉 `일반_점포_수` 는 정의상 전체가 아닙니다.
우연이 아니라 데이터 구조가 그렇다는 증거입니다.

### 얼마나 벌어지나

```
업종별 평균 부풀림 배수 (상위 8)
  편의점        3.10배
  치킨전문점     2.23배
  패스트푸드점    1.90배
  ...

편의점에서 가장 심한 상권 5곳
  동대문역사문화공원역   전체 22개 = 일반 1 + 프랜차이즈 21 → 22배
  양천향교역 7번       전체 15개 = 일반 1 + 프랜차이즈 14 → 15배
```

편의점 22곳 중 1곳만 개인 가게이고 21곳이 프랜차이즈인 상권에서는,
**총 매출을 22로 나눠야 하는데 1로 나눕니다.** 예측 매출이 22배가 됩니다.

프랜차이즈가 적은 업종(한식음식점 등)은 거의 영향이 없습니다 — 그래서 **업종에 따라
틀리는 정도가 다른** 것이고, 이게 발견하기 어려웠던 이유입니다.

### 코드에서 볼 곳 (`Commercial-AI-` 저장소)

```
src/features/build.py:127   grid[TARGET_COL] = _nan_divide(grid["next_당월_매출_금액"], grid["next_점포_수"])
src/features/build.py:99    df["프랜차이즈_비율"] = _nan_divide(df.get("프랜차이즈_점포_수"), df.get("점포_수"))
src/features/build.py:72    df["점포당_매출_t"]  = _nan_divide(df["당월_매출_금액"], df["점포_수"])
src/features/schema.py:8    target_next_q_sales_per_store = 매출(t+1) ÷ 점포수(t+1)
```

세 줄 모두 `점포_수` 로 나눕니다. 이걸 `유사_업종_점포_수` 로 바꾸면 됩니다.

**곁가지 증거**: 같은 이유로 프랜차이즈 비율이 100% 를 넘습니다
(스크립트 출력에 `100% 초과 1,554건, 최대 2,100%`). 비율이 21배라는 건 분모가 틀렸다는 뜻입니다.

---

## 2. 문제 ② — AI 가 중요한 정보를 안 보고 있다

### 확인 방법

AI 가 실제로 무엇을 보고 예측하는지는 `Commercial-AI-/models/model_metadata.json` 에
기록돼 있습니다. 스크립트가 그 목록을 그대로 출력합니다.

```
'상주'/'직장' 포함 피처: 없음  ← 이것이 문제
인구 관련으로 있는 것  : ['총_유동인구_수', '여성_유동인구_비율', '주말_유동인구_비율', '야간_유동인구_비율']
```

지나가는 사람(유동인구)은 보는데, **그 동네에 사는 사람(상주인구)과 일하는 사람(직장인구)은
안 봅니다.** 상권 분석에서 가장 기본이 되는 수요 정보입니다.

전체 피처 24개가 출력되니 직접 훑어보세요. 대부분 **과거 매출**(`점포당_매출_t`, `ma2`, `ma4`,
성장률)과 **점포 수·개폐업**입니다.

### 성능이 어떻게 나오는가

```
모델      MAE     13,776,289
단순규칙  MAE     13,572,510  ('지난 분기와 같다')
차이                 203,778  (+1.5%)
ml_beats_baseline_on_test = False
```

- **MAE** = 평균적으로 얼마나 틀리는지 (낮을수록 좋음)
- **단순규칙** = AI 없이 "이번 분기도 지난 분기와 같을 것"이라고 찍는 것
- 지금은 그 단순규칙이 AI 보다 **1.5% 더 정확**합니다

과거 매출만 보고 예측하니 "지난 분기와 비슷하다" 를 학습한 셈입니다. 그래서 단순규칙을
못 넘습니다. 새로운 정보(누가 사는지·일하는지)가 들어가야 넘어설 여지가 생깁니다.

### 왜 안 들어갔나 — 설정에서 확인

`Commercial-AI-/config/data_sources.yaml` 61~78줄:

```yaml
resident_population:
  service_name: VwsmTrdarRepopQq   # TODO: 실제 API 호출로 재검증
  verified: false                  # ← false 라서 수집 대상에서 빠짐
worker_population:
  service_name: VwsmTrdarWrcPopltnQq
  verified: false
```

같은 파일 11~12줄에 이유가 적혀 있습니다 — "실제 API 응답으로 재검증 후 true 로 갱신할 것".
**저희가 그 데이터셋을 실제로 받아서 서비스명이 맞는 걸 확인했으니, 이제 `true` 로 올릴 수
있습니다.** (상주인구 34,275행 / 직장인구 34,386행, 2021Q1~2026Q1)

직접 열어보실 수 있습니다:

```bash
seoul-startup-opportunity-recommender/.venv/Scripts/python.exe -c "import pandas as pd; d=pd.read_csv(r'seoul-startup-opportunity-recommender/data/raw/resident.csv', encoding='cp949', nrows=3); print(list(d.columns)[:8]); print(d[['상권_코드_명','총_상주인구_수']].head())"
```

---

## 3. 문제 ③ — 치안 정보가 등록만 되고 비어 있다

### 확인 방법

같은 `model_metadata.json` 을 보면 **치안 피처가 이미 목록에 있습니다.**

```
치안 피처   : ['sf_crime_rate_per_100k', 'sf_arrest_rate', 'sf_cctv_per_km2']
부동산 피처 : ['re_rent_per_m2', 're_vacancy_rate', 're_rent_index']
선택 단계   : E_plus_safety / 외부 포함 = True
```

`sf_` = safety(치안), `re_` = real estate(부동산). **AI 는 이 정보를 쓰도록 학습됐습니다.**
그런데 지금 서빙 데이터에는 그 값이 비어 있어서(NaN) 못 쓰고 있습니다.

### 학습할 때는 있었다는 증거

```
학습 때 외부 데이터가 있었다는 흔적 (external_columns.json)
  sf_crime_rate_per_100k  기준 2024
  sf_cctv_per_km2         기준 2025
  re_rent_per_m2          기준 2026Q1
학습 시각: 2026-07-24T19:45:00
```

기준 연도가 실제로 기록돼 있습니다. **데이터가 없었으면 이 값이 생길 수 없습니다.**
그래서 팀원분 컴퓨터에 그 원본 파일(`crime_gu.csv` 등)이 남아 있을 가능성이 큽니다.

### 파일이 없으면 어떻게 되는가

```
scripts/build_features.py:91  print("[안내] 안전 데이터(crime_gu/cctv_gu.csv) 없음 → sf_* 미생성 ...")
scripts/build_features.py:101 print("[안내] 임대동향 데이터(rone_rent.csv) 없음 → re_* 미생성 ...")
```

파일이 없으면 **조용히 건너뜁니다** (에러가 아니라 안내만 출력). 그래서 눈치채기 어렵습니다.
그 다음 `prepare_feature_table.py` 가 컬럼만 빈 값으로 만들어 주기 때문에 파이프라인은 돌아가고,
결과적으로 **"AI 가 치안을 본다고 등록돼 있는데 실제로는 못 보는"** 상태가 됩니다.

### 얼마나 중요한가 — 솔직한 답

```
ablation (valid MAE) — 피처를 단계별로 더했을 때
  A_key_past_sales           14,485,799
  B_plus_population          14,440,798  (-45,001)      ← 유동인구 추가
  C_plus_store_competition   14,293,328  (-147,470)     ← 점포·경쟁 추가
  C2_plus_seasonality        12,960,719  (-1,332,609)   ← 계절성 추가 (가장 큰 개선)
  D_plus_real_estate         12,968,965  (+8,246)       ← 부동산 추가 (오히려 악화)
  E_plus_safety              12,903,030  (-65,936)      ← 치안 추가
```

**ablation** = 피처를 하나씩 더해가며 성능을 측정한 실험 기록입니다.

- 치안은 오차를 **6.6만원(0.5%) 줄였습니다** — 도움은 되지만 크지 않습니다
- 부동산은 오히려 **8천원 늘렸습니다** — 임대시세(R-ONE) 확보를 서두를 필요는 없다는 뜻입니다
- 가장 큰 개선은 **계절성(분기)** 이었습니다

그래서 문제 ③ 은 "성능을 크게 올려서" 가 아니라 **"학습에 쓴 정보가 실제로 동작하게 만드는
정합성"** 때문에 고쳐야 합니다. 그리고 재학습이 필요 없어서 비용이 가장 적습니다.

---

## 4. 그래서 우선순위가 왜 그렇게 되나

| 순서 | 문제 | 왜 이 순서인가 |
|---|---|---|
| 1 | ① 매출 분모 | **성능과 무관하게 계산이 틀렸다.** 22배 부풀려진 숫자를 심사에서 보여줄 수 없다 |
| 2 | ② 상주·직장인구 | ① 과 **같이 재학습**하면 한 번으로 끝난다. 성능 개선 여지가 가장 큰 곳 |
| 3 | ③ 치안 값 채우기 | 재학습이 필요 없어 언제든 가능. 효과는 작지만 비용도 작다 |

---

## 5. 스스로 더 파보고 싶으면

```bash
# 학습 메타데이터 전체 훑어보기
seoul-startup-opportunity-recommender/.venv/Scripts/python.exe -c "import json;d=json.load(open(r'Commercial-AI-/models/model_metadata.json',encoding='utf-8'));print(list(d.keys()))"

# 점수 가중치 정책 (치안 5% 등)
cat Commercial-AI-/config/scoring_weights.yaml

# 외부 데이터를 어떻게 붙이는지
cat Commercial-AI-/src/features/external.py     # 42~113줄이 치안 부분

# 종합점수에서 빈 값을 어떻게 처리하는지 (치안이 비면 가중치가 재정규화된다)
sed -n '47,68p' Commercial-AI-/src/serving/diagnosis.py
```

⚠️ `Commercial-AI-/scripts/*.py` 는 **이 PC 에서 실행되지 않습니다** — `.venv` 와 `data/` 가
없습니다. 위 명령들은 모두 파일을 **읽기만** 합니다.

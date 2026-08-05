# 문서 안내 — 뭘 읽어야 하나

> 문서가 12개라 처음 오면 길을 잃는다. **목적별로 읽을 것만** 골라 뒀다.
> 최종 갱신: 2026-08-05

## 🚦 무조건 먼저 (2분)

| 문서 | 왜 |
|---|---|
| [OPEN-ITEMS.md](OPEN-ITEMS.md) **헤더 요약표만** | 지금 남은 일이 뭔지. 572줄이지만 **맨 위 표 하나면 충분하다** |
| `../CLAUDE.md` | 세션 시작 시 자동 로드되는 규칙. 읽지 않아도 적용되지만 알고 있으면 좋다 |

나머지는 **하려는 일이 정해진 뒤에** 필요한 것만 편다.

---

## 📌 목적별 — 이 일을 하려면 이걸 읽어라

### 웹 UI/UX 를 고친다 (지금 1순위 작업)

1. [DATA-CATALOG.md](DATA-CATALOG.md) — **화면 기능 22개 ↔ 데이터 매핑표.**
   "이 카드 빼면 뭐가 사라지나"를 여기서 확인한다. UI 정리 작업의 정본
2. [../README.md](../README.md) — 리포트 9개 섹션이 각각 뭘 보여주는지
3. `../CLAUDE.md` 구조 원칙 — 계약(zod)·계보(provenance)·`sourceMode` 규칙.
   **새 블록을 추가하면 `lib/provenance.ts` 에 행 추가**가 강제 규칙이다

### 발표·심사 자료를 만든다

1. [MODEL-EXPERIMENT-EXPLAINED.md](MODEL-EXPERIMENT-EXPLAINED.md) — **쉬운 해설판.**
   ML 배경지식 없이 읽힌다. 팀 공유·발표 원고의 기본 재료
2. [MODEL-EXPERIMENT-REPORT.md](MODEL-EXPERIMENT-REPORT.md) — 같은 내용의 상세판.
   숫자 근거가 필요할 때
3. [BENCHMARK-golmok.md](BENCHMARK-golmok.md) — 서울시 공식 서비스(골목상권) 실탐색 기록.
   "기존 서비스와 뭐가 다른가"에 답할 때

### 모델 저장소를 처음 본다

1. [MODEL-CODE-TOUR.md](MODEL-CODE-TOUR.md) — 신입 인수인계용 코드 투어
2. `../../Commercial-AI-/README.md` — 모델 정본 README (§5 에 v2 한계 기록)

### 문서 주장을 직접 확인하고 싶다

- [VERIFY-GUIDE.md](VERIFY-GUIDE.md) + `../tools/verify_model_issues.py` (읽기 전용).
  "정말 그런가"를 손으로 재현하는 절차

### 데이터를 재생성한다 (파이프라인 머신에서만)

- [V2-REFRESH-HANDOFF.md](V2-REFRESH-HANDOFF.md) **부록만** — 머신 분업 규칙.
  ⚠️ **개발 PC 에서 `export_web_static.py` 를 돌리면 안 되는 이유**가 여기 있다.
  본문(§0~§5)은 완료된 작업 기록이라 읽을 필요 없다

---

## 🗄 역사 기록 — 읽지 마라 (낡았거나 이행 완료)

지워도 되지만 "왜 이렇게 됐나"의 근거라 남겨 뒀다. **현재 상태로 착각하면 안 된다.**

| 문서 | 상태 |
|---|---|
| [MODEL-REQUESTS.md](MODEL-REQUESTS.md) | 요청 3건 **전부 이행됨**(v2.0.0). 요청서로서는 수명 끝 |
| `../../files/ANSWERS.md` | **무효.** 삭제된 구 레포 기준 스펙. 문서 상단에 명시돼 있다 |
| `../../files/OPEN_QUESTIONS.md` | 답변 완료된 질문지 |
| `../../Commercial-AI-/docs_legacy_README.md` | 구 프로젝트 README |

현재 계약 정본은 문서가 아니라 **코드**다 — `lib/contracts.ts`(내부) ·
`lib/normalize.ts` 상단 주석(외부 2종).

---

## ⚠️ 루트 저장소 문서는 다른 머신에서 안 보인다

`academy/CLAUDE.md` · `academy/README.md` · `academy/files/*` 는 **원격이 없는
로컬 전용 저장소**에 있다. 이 레포를 clone 해도 따라오지 않고, 두 머신의 사본이
서로 다를 수 있다.

그래서 루트 문서의 핵심은 [OPEN-ITEMS.md §0](OPEN-ITEMS.md#0-옮겨온-핵심-컨텍스트-루트-문서가-없어도-작업-가능하게)
에 옮겨 뒀다. **다른 머신에서는 §0 을 루트 CLAUDE.md 대신 읽으면 된다.**

단 `academy/CLAUDE.md` 는 그 머신에 파일이 있으면 세션 시작 시 자동 로드되므로,
**두 머신의 루트 CLAUDE.md 내용이 다르면 세션마다 다른 규칙이 적용된다.**
불일치가 의심되면 §0 을 기준으로 삼을 것.

@AGENTS.md

# sanggwon-web — 웹 데모 (플랫폼 컴포넌트)

상권 인사이트 데모의 Next.js 16 프론트+서버. 전체 프로젝트 맥락은 [../CLAUDE.md](../CLAUDE.md),
아키텍처·환경변수·시나리오는 [README.md](README.md) 참조.

## 구조 원칙 (지킬 것)

- **프론트는 `lib/contracts.ts`(zod, 내부 계약 정본)에만 의존** — 모델 응답 형태를 프론트에서 다루지 말 것
- 모델 서버 스펙 변경은 `lib/normalize.ts` 한 곳에서 흡수 (외부 계약: `../files/ANSWERS.md`)
- grade 판정(safe≥0.60/caution≥0.45)·disclaimer·scaleNote는 route handler가 강제 주입 —
  UI에서 이 값들을 재계산하거나 생략하지 말 것
- 브라우저에서 모델 서버(:8000) 직접 호출 금지 — 반드시 `/api/*` 경유
- 모든 응답에 `sourceMode`(live/file/mock) 유지 — 목업이면 UI 배지로 정직하게 표시
- AI 인스펙터 콘솔(`lib/inspector.ts` + `components/InspectorConsole.tsx`):
  새 데이터 흐름을 추가하면 `inspect()` 이벤트도 같이 심을 것 (데모 투명성이 셀링 포인트)

## 스타일

- 테마 토큰은 `app/globals.css`의 `@theme` — 하드코딩 hex 대신 `--color-*` 사용
  (gold 액센트, 신호등: safe/caution/risk, 잉크 네이비 계열)
- 폰트: Hahmlet(디스플레이) / IBM Plex Sans KR(본문) / IBM Plex Mono(숫자·콘솔)

## 검증

- `pnpm exec tsc --noEmit` → `pnpm build` 통과 확인
- 지도 검증은 Chrome DevTools MCP 사용 (Claude Preview 브라우저는 외부 도메인 차단이라
  카카오 SDK가 안 뜸 — 폴백 UI 테스트에는 오히려 유용)
- 카카오맵이 안 뜨면: 콘솔 네트워크에서 dapi.kakao.com 응답 확인
  (`ERR_BLOCKED_BY_ORB` = 도메인 미등록/서비스 비활성. curl은 Referer가 없어 통과하므로 속지 말 것)

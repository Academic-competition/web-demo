/**
 * history.ts — 최근 분석 이력 (localStorage, 로그인 없음)
 *
 * PRD 는 로그인/이력을 Won't 로 뒀지만, "아까 본 상권 다시 보기" UX 는 계정 없이도
 * localStorage 로 충분하다 (2026-07-30 사용자 결정 — OAuth+DB 는 대회 이후 확장).
 *
 * 구조: useSyncExternalStore 용 외부 스토어 (lib/inspector.ts 와 같은 패턴).
 *  - effect 안에서 setState 를 부르지 않아 cascading render 린트에 안 걸리고,
 *  - 서버 스냅샷은 빈 배열이라 SSR/hydration 불일치가 없다
 *    (클라이언트 첫 스냅샷에서 lazy 하게 localStorage 를 읽는다).
 *
 * 원칙:
 *  - 브라우저에만 저장. 서버 전송·수집 없음 (개인정보 이슈 원천 차단)
 *  - 같은 상권×업종 재분석은 최신 1건으로 갱신 (중복 없음)
 */

export type HistoryEntry = {
  sangwonCode: number;
  industryCode: string;
  sangwonName: string | null;
  industryName: string | null;
  /** 분석 당시 신호등 — 이력 리스트의 색 점 (재분석하면 최신 값으로 갱신됨) */
  grade: "safe" | "caution" | "risk" | null;
  /** epoch ms */
  ts: number;
};

const KEY = "sanggwon.history.v1";
const MAX_ENTRIES = 12;
const EMPTY: HistoryEntry[] = [];

let cache: HistoryEntry[] | null = null;
const listeners = new Set<() => void>();

function readStorage(): HistoryEntry[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(arr)) return EMPTY;
    return arr.filter(
      (e): e is HistoryEntry =>
        !!e && typeof e === "object" &&
        Number.isInteger((e as HistoryEntry).sangwonCode) &&
        typeof (e as HistoryEntry).industryCode === "string"
    );
  } catch {
    return EMPTY; // 파싱 실패·접근 불가(시크릿 모드 등) → 이력 기능만 조용히 비활성
  }
}

function write(next: HistoryEntry[]): void {
  cache = next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* 저장 실패해도 분석 흐름은 계속 — 메모리 캐시로는 동작 */
  }
  listeners.forEach((l) => l());
}

// ---- useSyncExternalStore 계약 ----
export function subscribeHistory(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** 클라이언트 스냅샷 — 첫 호출에서 lazy 로드. 변경은 액션에서만 일어나 참조가 안정적이다 */
export function getHistorySnapshot(): HistoryEntry[] {
  if (cache === null) cache = readStorage();
  return cache;
}

/** SSR 스냅샷 — 서버에는 이력이 없다 */
export function getHistoryServerSnapshot(): HistoryEntry[] {
  return EMPTY;
}

// ---- 액션 ----
export function pushHistory(entry: HistoryEntry): void {
  const rest = getHistorySnapshot().filter(
    (e) => !(e.sangwonCode === entry.sangwonCode && e.industryCode === entry.industryCode)
  );
  write([entry, ...rest].slice(0, MAX_ENTRIES));
}

export function clearHistory(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* noop */
  }
  cache = EMPTY;
  listeners.forEach((l) => l());
}

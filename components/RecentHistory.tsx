"use client";
/**
 * RecentHistory — 최근 분석 이력 리스트 (대기 화면 하단)
 *
 * localStorage 기반(lib/history.ts) — 로그인 없음, 서버 전송 없음.
 * 클릭하면 해당 상권×업종을 다시 분석한다 (저장된 리포트 재생이 아니라 **재조회**다:
 * 데이터가 갱신됐으면 최신 값이 나오는 게 맞고, 과거 스냅샷 보존은 이 기능의 목적이 아니다).
 */
import type { HistoryEntry } from "@/lib/history";

const GRADE_DOT: Record<string, string> = {
  safe: "bg-safe",
  caution: "bg-caution",
  risk: "bg-risk",
};

function relativeTime(ts: number): string {
  const d = Date.now() - ts;
  if (d < 60_000) return "방금";
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}분 전`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}시간 전`;
  return `${Math.floor(d / 86_400_000)}일 전`;
}

export default function RecentHistory({
  entries,
  onPick,
  onClear,
}: {
  entries: HistoryEntry[];
  onPick: (e: HistoryEntry) => void;
  onClear: () => void;
}) {
  if (!entries.length) return null;

  return (
    <div className="mt-3 rounded-xl border border-line/50 bg-ink-800/30 px-4 py-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-[0.16em] text-faint">
          최근 분석 <span className="normal-case tracking-normal">— 이 브라우저에만 저장</span>
        </span>
        <button
          onClick={onClear}
          className="text-[10px] text-faint transition hover:text-fg"
          aria-label="최근 분석 이력 지우기"
        >
          지우기
        </button>
      </div>
      <ul className="space-y-1">
        {entries.slice(0, 6).map((e) => (
          <li key={`${e.sangwonCode}-${e.industryCode}`}>
            <button
              onClick={() => onPick(e)}
              className="group flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition hover:bg-ink-700/60"
            >
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${e.grade ? GRADE_DOT[e.grade] : ""}`}
                style={e.grade ? undefined : { background: "#5b6683" }}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] text-fg transition group-hover:text-gold-soft">
                  {e.sangwonName ?? `상권 #${e.sangwonCode}`}
                  <span className="text-muted"> · {e.industryName ?? e.industryCode}</span>
                </span>
              </span>
              <span className="shrink-0 text-[10px] text-faint">{relativeTime(e.ts)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

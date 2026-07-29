"use client";
/**
 * InspectorConsole — 지도 위 우하단의 AI 통신 인스펙터 (터미널 스타일)
 *
 * 지도 클릭 → 상권 매핑 → 내부 API → 모델 서버 외부 호출(원문) → 정규화 응답의
 * 전 과정을 시간순으로 보여준다. 각 항목을 클릭하면 JSON 페이로드가 펼쳐진다.
 */
import { useEffect, useRef, useState } from "react";

import {
  clearInspector,
  useInspector,
  type InspectorEntry,
  type InspectorKind,
} from "@/lib/inspector";

const KIND_STYLE: Record<InspectorKind, { label: string; color: string; hint?: string }> = {
  map: { label: "MAP", color: "#6ea8fe", hint: "지도 상호작용" },
  geo: { label: "GEO", color: "#57cfc0", hint: "좌표→상권 매핑" },
  req: { label: "REQ", color: "#e3b65a", hint: "내부 API 요청" },
  model: { label: "MODEL", color: "#b78cf7", hint: "모델 서버 외부 호출" },
  ml: { label: "ML", color: "#ff9f45", hint: "학습된 모델의 예측이 쓰인 지점" },
  res: { label: "RES", color: "#3ddc97", hint: "정규화 응답" },
  file: { label: "FILE", color: "#8a95b0", hint: "사전계산 실데이터" },
  err: { label: "ERR", color: "#f0655d", hint: "오류·폴백" },
};

function Row({ entry }: { entry: InspectorEntry }) {
  const [open, setOpen] = useState(false);
  const style = KIND_STYLE[entry.kind];
  const expandable = entry.detail !== undefined;

  return (
    <div className="border-b border-line/30 last:border-0">
      <button
        onClick={() => expandable && setOpen((v) => !v)}
        className={`flex w-full items-baseline gap-2 px-3 py-1.5 text-left text-[11px] leading-snug ${
          expandable ? "cursor-pointer hover:bg-ink-700/40" : "cursor-default"
        }`}
        style={{ fontFamily: "var(--font-numeric)" }}
      >
        <span className="shrink-0 text-faint">{entry.at}</span>
        <span
          className="w-[46px] shrink-0 text-center text-[9px] font-semibold tracking-wider"
          style={{ color: style.color }}
        >
          {style.label}
        </span>
        <span className="min-w-0 flex-1 truncate text-fg/90">{entry.title}</span>
        {entry.durationMs !== undefined && (
          <span className="shrink-0 text-faint">{entry.durationMs}ms</span>
        )}
        {expandable && (
          <span className="shrink-0 text-faint">{open ? "▾" : "▸"}</span>
        )}
      </button>
      {open && expandable && (
        <pre
          className="max-h-64 overflow-auto whitespace-pre-wrap break-all border-t border-line/30 bg-ink-950/80 px-3 py-2 text-[10px] leading-relaxed text-muted"
          style={{ fontFamily: "var(--font-numeric)" }}
        >
          {JSON.stringify(entry.detail, null, 2)}
        </pre>
      )}
    </div>
  );
}

export default function InspectorConsole() {
  const entries = useInspector();
  const [open, setOpen] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 새 항목 도착 시 자동 스크롤 (맨 아래 근처에 있을 때만)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [entries]);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="absolute bottom-4 right-4 z-20 flex items-center gap-2 rounded-full border border-line/70 bg-ink-900/95 px-4 py-2 text-[11px] text-muted shadow-lg backdrop-blur transition hover:border-gold/50 hover:text-fg"
        style={{ fontFamily: "var(--font-numeric)" }}
      >
        <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-safe" />
        AI 인스펙터
        <span className="text-faint">{entries.length}</span>
      </button>
    );
  }

  return (
    <div className="absolute bottom-4 right-4 z-20 flex max-h-[46vh] w-[560px] max-w-[calc(100%-2rem)] flex-col overflow-hidden rounded-xl border border-line/70 bg-ink-900/95 shadow-2xl backdrop-blur">
      {/* 헤더 */}
      <div className="flex items-center gap-2 border-b border-line/60 px-3 py-2">
        <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-safe" />
        <span
          className="text-[11px] font-semibold tracking-wider text-fg"
          style={{ fontFamily: "var(--font-numeric)" }}
        >
          AI 인스펙터
        </span>
        <span className="text-[10px] text-faint">
          지도 → 상권 매핑 → 요청/응답 → <b className="text-[#ff9f45]">숫자별 출처 계보</b>
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={clearInspector}
            className="rounded px-2 py-0.5 text-[10px] text-faint transition hover:bg-ink-700 hover:text-fg"
          >
            지우기
          </button>
          <button
            onClick={() => setOpen(false)}
            className="rounded px-2 py-0.5 text-[10px] text-faint transition hover:bg-ink-700 hover:text-fg"
            aria-label="콘솔 접기"
          >
            ─
          </button>
        </div>
      </div>

      {/* 로그 */}
      <div ref={scrollRef} className="panel-scroll min-h-[80px] flex-1 overflow-y-auto">
        {entries.length === 0 ? (
          <div className="px-3 py-6 text-center text-[11px] text-faint">
            아직 기록이 없습니다 — 지도를 클릭하거나 업종을 선택해보세요.
          </div>
        ) : (
          entries.map((e) => <Row key={e.id} entry={e} />)
        )}
      </div>

      {/* 범례 — 마우스를 올리면 각 종류가 무엇인지 표시 */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line/60 px-3 py-1.5">
        {Object.entries(KIND_STYLE).map(([k, s]) => (
          <span
            key={k}
            className="flex items-center gap-1 text-[9px] text-faint"
            title={s.hint}
          >
            <i className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
        <span className="ml-auto text-[9px] text-faint">
          <b className="text-[#ff9f45]">ML</b>·계보 항목을 클릭하면 블록별 산출 방식이 펼쳐집니다
        </span>
      </div>
    </div>
  );
}

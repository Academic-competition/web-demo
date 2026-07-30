"use client";
/**
 * TopSangwonsPanel — 업종 먼저(히트맵) 모드의 추천 상권 TOP 10
 *
 * golmok 벤치마크의 "Top-10 리스트 ↔ 지도 양방향 연동" 패턴:
 *  - 히트맵은 색으로만 말해서 "그래서 어디가 좋은데?"에 답하지 못했다 — 여기서 순위로 답한다
 *  - 행 hover → 지도의 해당 상권 원이 골드 테두리로 강조 (MapView.highlightCode)
 *  - 행 클릭 → 그 상권 분석 (기존 handleSelectSangwon 재사용)
 *
 * 순위 기준은 **현재 히트맵 지표 그대로** (매출 백분위 / 생존율 / 종합점수±치안).
 * 별도 산식을 만들지 않는다 — 지도 색과 리스트 순위가 항상 같은 근거를 가져야
 * "지도랑 리스트가 왜 달라요"가 안 나온다.
 */
import { useMemo } from "react";

import type { HeatmapResult } from "@/lib/contracts";
import type { HeatmapMetric } from "./MapView";

const TOP_N = 10;

const METRIC_LABEL: Record<HeatmapMetric, string> = {
  sales: "예상매출 백분위",
  survival: "3년 생존율",
  composite: "종합점수",
};

const GRADE_DOT: Record<string, string> = {
  safe: "bg-safe",
  caution: "bg-caution",
  risk: "bg-risk",
};

function formatKRWCompactLocal(v: number): string {
  if (v >= 1e8) return `${(v / 1e8).toFixed(1)}억`;
  if (v >= 1e4) return `${Math.round(v / 1e4).toLocaleString()}만`;
  return `${v.toLocaleString()}원`;
}

export default function TopSangwonsPanel({
  heatmap,
  metric,
  compositeByCode,
  safetyOn,
  industryName,
  onHover,
  onPick,
}: {
  heatmap: HeatmapResult;
  metric: HeatmapMetric;
  /** metric === "composite" 일 때의 상권코드→점수 맵 (치안 토글 반영본) */
  compositeByCode: Record<number, number> | null;
  safetyOn: boolean;
  industryName: string | null;
  onHover: (code: number | null) => void;
  onPick: (code: number) => void;
}) {
  const rows = useMemo(() => {
    const value = (c: HeatmapResult["cells"][number]): number | null => {
      if (metric === "survival") return c.survivalProbability;
      if (metric === "composite") return compositeByCode?.[c.sangwonCode] ?? null;
      return c.salesPercentile;
    };
    return heatmap.cells
      .map((c) => ({ cell: c, v: value(c) }))
      .filter((r): r is { cell: HeatmapResult["cells"][number]; v: number } => r.v != null)
      .sort(
        // 매출 백분위는 상위권이 100 으로 동점이라 예상매출로 타이브레이크
        // (동점 구간에서 순서가 렌더마다 흔들리는 것을 막는다)
        (a, b) =>
          b.v - a.v ||
          (b.cell.monthlyEstimateKRW ?? 0) - (a.cell.monthlyEstimateKRW ?? 0)
      )
      .slice(0, TOP_N);
  }, [heatmap, metric, compositeByCode]);

  if (!rows.length) return null;

  return (
    <div className="rise-in space-y-2" onMouseLeave={() => onHover(null)}>
      <div>
        <h2 className="font-[family-name:var(--font-display)] text-[17px] leading-tight text-fg">
          {industryName ?? "선택 업종"} — 추천 상권 TOP {rows.length}
        </h2>
        <p className="mt-0.5 text-[11px] text-muted">
          기준: {METRIC_LABEL[metric]}
          {metric === "composite" && (safetyOn ? " (치안 반영)" : " (치안 미반영)")}
          {" · "}행에 마우스를 올리면 지도에서 위치가 강조됩니다
        </p>
      </div>

      <ol className="space-y-1">
        {rows.map(({ cell, v }, i) => (
          <li key={cell.sangwonCode}>
            <button
              onClick={() => onPick(cell.sangwonCode)}
              onMouseEnter={() => onHover(cell.sangwonCode)}
              onFocus={() => onHover(cell.sangwonCode)}
              className="group flex w-full items-center gap-3 rounded-lg border border-line/50 bg-ink-800/40 px-3 py-2 text-left transition hover:border-gold/60 hover:bg-ink-700/60"
            >
              <span
                className="w-5 shrink-0 text-right text-[12px] text-faint"
                style={{ fontFamily: "var(--font-numeric)" }}
              >
                {i + 1}
              </span>
              {metric === "survival" && (
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${cell.grade ? GRADE_DOT[cell.grade] : ""}`}
                  style={cell.grade ? undefined : { background: "#5b6683" }}
                />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] text-fg transition group-hover:text-gold-soft">
                  {cell.sangwonName ?? cell.sangwonCode}
                </span>
                <span className="text-[10px] text-faint">
                  {cell.gu}
                  {/* 매출 지표일 땐 우측 값이 이미 금액이라 중복 표기를 피한다 */}
                  {metric !== "sales" && cell.monthlyEstimateKRW != null && (
                    <> · 예상매출 {formatKRWCompactLocal(cell.monthlyEstimateKRW)}</>
                  )}
                </span>
              </span>
              <span
                className="shrink-0 text-[13px] font-semibold text-gold"
                style={{ fontFamily: "var(--font-numeric)" }}
              >
                {metric === "survival"
                  ? `${(v * 100).toFixed(0)}%`
                  : metric === "sales" && cell.monthlyEstimateKRW != null
                    ? // 백분위는 상위권이 100 동점이라 변별력이 없다 — 매출 금액으로 표시
                      formatKRWCompactLocal(cell.monthlyEstimateKRW)
                    : v.toFixed(0)}
              </span>
            </button>
          </li>
        ))}
      </ol>

      <p className="border-t border-line/50 pt-1.5 text-[10px] leading-relaxed text-faint">
        순위는 지도 색과 동일한 지표의 상위 {rows.length}개입니다. 상권을 클릭하면 상세
        리포트가 열립니다. 기준 {heatmap.dataAsOf}.
      </p>
    </div>
  );
}

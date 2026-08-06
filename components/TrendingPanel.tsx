"use client";
/**
 * TrendingPanel — 초기 화면의 '뜨는 상권' (golmok 벤치마크 대응)
 *
 * golmok 뜨는 상권 = 지표 토글(점포수/매출/유동인구/주거인구) × 기준(순위/증가율)
 * → Top10. 우리는 직장인구를 더해 5종이고, 행 클릭이 곧 분석 진입이다
 * (golmok 은 랭킹 행에 클릭 핸들러가 없어 리포트로 이어지지 않는다 — 실측 확인).
 *
 * 설계 제약 (ComparePanel 과 동일): **웹은 수치를 만들지 않는다.**
 *  - 값·증감률·소표본(lowBase) 판정 전부 export_web_static.py 산출
 *  - 여기서 하는 것은 정렬·TopN 슬라이스·포맷팅뿐 (표시 계층)
 *  - 증가율 정렬에서 lowBase 상권을 기본 제외하고 그 사실을 문구로 밝힌다 —
 *    golmok 은 "돈암1동 커피 5만원 +326%" 같은 소표본 노이즈가 상위를 점령했다
 */
import { useMemo, useState } from "react";

import type { RankingsResult } from "@/lib/contracts";

const TOP_N = 10;
/** 지표 표시 순서 — 계약의 RankingMetricKey 와 같은 키 */
const METRIC_ORDER = ["sales", "stores", "footTraffic", "resident", "worker"] as const;

type SortBasis = "value" | "changePct";

function fmtValue(v: number, unit: string): string {
  if (unit === "KRW") {
    if (v >= 1e12) return `${(v / 1e12).toFixed(1)}조`;
    if (v >= 1e8) return `${(v / 1e8).toFixed(0)}억`;
    return `${Math.round(v / 1e4).toLocaleString()}만`;
  }
  if (v >= 1e4) return `${(v / 1e4).toFixed(1)}만${unit === "명" ? "명" : ""}`;
  return `${v.toLocaleString()}${unit === "개" ? "개" : unit === "명" ? "명" : ""}`;
}

export default function TrendingPanel({
  data,
  onPick,
}: {
  data: RankingsResult;
  onPick: (code: number) => void;
}) {
  const [metricKey, setMetricKey] = useState<string>("sales");
  const [basis, setBasis] = useState<SortBasis>("value");

  const meta = data.metrics[metricKey];

  const rows = useMemo(() => {
    const picked = data.rows
      .map((r) => ({ row: r, m: r.metrics[metricKey] }))
      .filter((x): x is { row: (typeof data.rows)[number]; m: NonNullable<typeof x.m> } => x.m != null);
    if (basis === "changePct") {
      // 소표본 노이즈 제외 — 판정(lowBase)은 파이프라인이 했고 여기선 필터만
      return picked
        .filter((x) => x.m.changePct != null && !x.m.lowBase)
        // 증가율 동률(예: 직장인구는 분기 간 변화가 드묾)은 규모로 타이브레이크 —
        // 동점 구간에서 순서가 렌더마다 흔들리는 것을 막는다 (TopSangwonsPanel 과 동일)
        .sort((a, b) => b.m.changePct! - a.m.changePct! || b.m.value - a.m.value)
        .slice(0, TOP_N);
    }
    return picked.sort((a, b) => b.m.value - a.m.value).slice(0, TOP_N);
  }, [data, metricKey, basis]);

  if (!meta) return null;

  return (
    <div className="rise-in space-y-2">
      <div>
        <h2 className="font-[family-name:var(--font-display)] text-[17px] leading-tight text-fg">
          뜨는 상권 TOP {rows.length}
        </h2>
        <p className="mt-0.5 text-[11px] text-muted">
          {meta.label} {basis === "value" ? "상위" : "증가율 상위"} · 기준 {meta.asOf} ·
          클릭하면 그 상권 분석으로 이동합니다
        </p>
      </div>

      {/* 지표 토글 */}
      <div className="flex flex-wrap gap-1">
        {METRIC_ORDER.filter((k) => data.metrics[k]).map((k) => (
          <button
            key={k}
            onClick={() => setMetricKey(k)}
            className={`rounded-full border px-2.5 py-1 text-[11px] transition ${
              metricKey === k
                ? "border-gold/70 bg-gold/15 text-gold-soft"
                : "border-line/60 text-muted hover:border-gold/40 hover:text-fg"
            }`}
          >
            {data.metrics[k].label}
          </button>
        ))}
      </div>

      {/* 정렬 기준 (golmok 상세조건의 최고순위/비교증가율 대응) */}
      <div className="flex gap-1">
        {(
          [
            ["value", "수준 (최고순위)"],
            ["changePct", "전분기 증가율"],
          ] as [SortBasis, string][]
        ).map(([b, label]) => (
          <button
            key={b}
            onClick={() => setBasis(b)}
            className={`rounded-md border px-2 py-0.5 text-[10px] transition ${
              basis === b
                ? "border-gold/60 bg-ink-700/70 text-gold-soft"
                : "border-line/50 text-faint hover:text-muted"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <ol className="space-y-1">
        {rows.map(({ row, m }, i) => (
          <li key={row.code}>
            <button
              onClick={() => onPick(row.code)}
              className="group flex w-full items-center gap-3 rounded-lg border border-line/50 bg-ink-800/40 px-3 py-2 text-left transition hover:border-gold/60 hover:bg-ink-700/60"
            >
              <span
                className="w-5 shrink-0 text-right text-[12px] text-faint"
                style={{ fontFamily: "var(--font-numeric)" }}
              >
                {i + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] text-fg transition group-hover:text-gold-soft">
                  {row.name ?? row.code}
                </span>
                <span className="text-[10px] text-faint">
                  {row.gu}
                  {row.category && <> · {row.category}</>}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span
                  className="block text-[13px] font-semibold text-gold"
                  style={{ fontFamily: "var(--font-numeric)" }}
                >
                  {basis === "changePct" && m.changePct != null
                    ? `+${m.changePct.toFixed(1)}%`
                    : fmtValue(m.value, meta.unit)}
                </span>
                {/* 보조 값 — 증가율 정렬이면 규모를, 수준 정렬이면 증감을 함께 */}
                <span className="block text-[10px] text-faint" style={{ fontFamily: "var(--font-numeric)" }}>
                  {basis === "changePct"
                    ? fmtValue(m.value, meta.unit)
                    : m.changePct != null && (
                        <span className={m.changePct >= 0 ? "text-safe" : "text-risk"}>
                          {m.changePct >= 0 ? "▲" : "▼"} {Math.abs(m.changePct).toFixed(1)}%
                        </span>
                      )}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ol>

      <p className="border-t border-line/50 pt-1.5 text-[10px] leading-relaxed text-faint">
        {meta.scope} 기준. 값·증감률은 모델 파이프라인 산출이며 화면은 정렬만 합니다.
        {basis === "changePct" && (
          <> 직전 분기 규모가 전 상권 중앙값 미만인 소규모 상권은 증가율 순위에서
          제외했습니다 (소표본 노이즈 방지).</>
        )}
      </p>
    </div>
  );
}

"use client";
/**
 * DetailCharts — 상세 분석 섹션용 미니 차트 모음 (golmok 벤치마크 확장)
 *
 * DemographicsChart와 동일한 recharts 스타일(다크·골드 하이라이트)을 따른다.
 * 모든 차트는 '보조 지표' 크기(h-24~28)로, 리포트 스크롤 안에서 가볍게 읽히도록.
 */
import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
} from "recharts";

import type { RatioSlice, TrendPoint } from "@/lib/contracts";
import { formatKRWCompact, pctChange } from "@/lib/format";

const TICK = { fill: "#8a95b0", fontSize: 10.5 };
const TOOLTIP_STYLE = {
  background: "#141d33",
  border: "1px solid #263354",
  borderRadius: 8,
  fontSize: 12,
  color: "#e9edf6",
};

// ------------------------------------------------------------------
// 비중 바 차트 (요일/시간대/연령 — 최댓값 골드 하이라이트)
// ------------------------------------------------------------------
const AGE_LABEL: Record<string, string> = {
  "10s": "10대", "20s": "20대", "30s": "30대", "40s": "40대", "50s": "50대", "60s+": "60+",
};

export function SliceBarChart({ data }: { data: RatioSlice[] }) {
  const rows = data.map((s) => ({
    label: AGE_LABEL[s.label] ?? s.label,
    pct: Math.round(s.ratio * 1000) / 10,
  }));
  const maxPct = Math.max(...rows.map((r) => r.pct), 0);
  return (
    <div className="h-24 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 6, right: 4, left: 4, bottom: 0 }}>
          <XAxis dataKey="label" tickLine={false} axisLine={false} tick={TICK} interval={0} />
          <Tooltip
            cursor={{ fill: "rgba(255,255,255,0.04)" }}
            contentStyle={TOOLTIP_STYLE}
            formatter={(v) => [`${v}%`, "비중"]}
          />
          <Bar dataKey="pct" radius={[3, 3, 0, 0]} isAnimationActive={false}>
            {rows.map((r) => (
              <Cell key={r.label} fill={r.pct === maxPct ? "var(--color-gold)" : "#3a486e"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ------------------------------------------------------------------
// 분기 추이 차트 (매출/점포수/유동인구 — 최신 분기 골드)
// ------------------------------------------------------------------
export function TrendChart({
  data,
  format = (v: number) => v.toLocaleString(),
}: {
  data: TrendPoint[];
  format?: (v: number) => string;
}) {
  const rows = data.map((p) => ({ quarter: p.quarter.replace("20", "'"), value: p.value }));
  const last = rows.length - 1;
  return (
    <div className="h-24 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 6, right: 4, left: 4, bottom: 0 }}>
          <XAxis dataKey="quarter" tickLine={false} axisLine={false} tick={TICK} interval={0} />
          <Tooltip
            cursor={{ fill: "rgba(255,255,255,0.04)" }}
            contentStyle={TOOLTIP_STYLE}
            formatter={(v) => [format(Number(v)), ""]}
          />
          <Bar dataKey="value" radius={[3, 3, 0, 0]} isAnimationActive={false}>
            {rows.map((r, i) => (
              <Cell key={r.quarter} fill={i === last ? "var(--color-gold)" : "#3a486e"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ------------------------------------------------------------------
// 증감 배지 — 전분기/전년동분기 대비 (golmok 패턴)
// ------------------------------------------------------------------
export function DeltaBadge({
  current,
  base,
  label,
  goodWhenUp = true,
}: {
  current: number | null;
  base: number | null;
  label: string;
  /** 증가가 긍정인 지표인지 (폐업 수 등은 false) */
  goodWhenUp?: boolean;
}) {
  const pct = pctChange(current, base);
  if (pct == null) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-line/50 bg-ink-700/40 px-1.5 py-0.5 text-[10px] text-faint">
        {label} <span>비교 불가</span>
      </span>
    );
  }
  const up = pct > 0.05;
  const down = pct < -0.05;
  const positive = up ? goodWhenUp : down ? !goodWhenUp : null;
  const tone =
    positive == null ? "text-muted" : positive ? "text-safe" : "text-risk";
  const arrow = up ? "▲" : down ? "▼" : "―";
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-line/50 bg-ink-700/40 px-1.5 py-0.5 text-[10px]">
      <span className="text-faint">{label}</span>
      <b className={tone}>
        {arrow} {Math.abs(pct).toFixed(1)}%
      </b>
    </span>
  );
}

// ------------------------------------------------------------------
// 성별 분할 바 (매출/유동인구)
// ------------------------------------------------------------------
export function GenderSplit({ data }: { data: RatioSlice[] }) {
  const male = data.find((d) => d.label === "남성")?.ratio ?? 0;
  const female = data.find((d) => d.label === "여성")?.ratio ?? 0;
  const total = male + female;
  if (total <= 0) return null;
  const mp = Math.round((male / total) * 1000) / 10;
  const fp = Math.round((female / total) * 1000) / 10;
  return (
    <div>
      <div className="flex h-4 w-full overflow-hidden rounded-full">
        <div className="bg-[#4a6fa5]" style={{ width: `${mp}%` }} />
        <div className="bg-[#a5637c]" style={{ width: `${fp}%` }} />
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-muted">
        <span>
          남성 <b className="text-fg" style={{ fontFamily: "var(--font-numeric)" }}>{mp}%</b>
        </span>
        <span>
          여성 <b className="text-fg" style={{ fontFamily: "var(--font-numeric)" }}>{fp}%</b>
        </span>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
// 3단 비교 가로 바 (이 상권 / 자치구 / 서울 — 상권 행 골드)
// ------------------------------------------------------------------
export function CompareBars({
  rows,
  format = formatKRWCompact,
}: {
  rows: { label: string; value: number | null; highlight?: boolean }[];
  format?: (v: number) => string;
}) {
  const valid = rows.filter((r) => r.value != null) as {
    label: string; value: number; highlight?: boolean;
  }[];
  if (!valid.length) return null;
  const max = Math.max(...valid.map((r) => r.value));
  return (
    <ul className="space-y-1.5">
      {rows.map((r) => (
        <li key={r.label} className="flex items-center gap-2">
          <span className="w-14 shrink-0 text-[10.5px] text-muted">{r.label}</span>
          <div className="h-3 min-w-0 flex-1 overflow-hidden rounded-sm bg-ink-700/50">
            {r.value != null && max > 0 && (
              <div
                className={`h-full rounded-sm ${r.highlight ? "bg-gold" : "bg-[#3a486e]"}`}
                style={{ width: `${Math.max((r.value / max) * 100, 2)}%` }}
              />
            )}
          </div>
          <span
            className={`w-16 shrink-0 text-right text-[10.5px] ${r.highlight ? "text-gold" : "text-fg/80"}`}
            style={{ fontFamily: "var(--font-numeric)" }}
          >
            {r.value != null ? format(r.value) : "―"}
          </span>
        </li>
      ))}
    </ul>
  );
}

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
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
} from "recharts";

import type { RatioSlice, TrendPoint } from "@/lib/contracts";
import { formatKRWCompact, pctChange } from "@/lib/format";

// fill 에 var() — 리포트 라이트 모드가 토큰 재정의로 뒤집을 수 있게 (Cell 의
// var(--color-gold) 와 같은 기존 패턴). 툴팁만 고정 다크 — 밝은 차트 위에서도 읽힌다.
export const TICK = { fill: "var(--color-chart-tick)", fontSize: 10.5 };
export const TOOLTIP_STYLE = {
  background: "#141d33",
  border: "1px solid #263354",
  borderRadius: 8,
  fontSize: 12,
  color: "#e9edf6",
};
// ⚠️ contentStyle 은 박스에만 적용된다 — 항목 텍스트는 itemStyle 이 없으면
// 시리즈 색(--color-chart-bar, 어두운 네이비)을 그대로 써서 다크 배경에 묻힌다 (8/7 피드백).
// 라벨(첫 줄)도 기본 회색이라 함께 지정한다. 세 Tooltip 모두 이 쌍을 쓸 것.
export const TOOLTIP_ITEM_STYLE = { color: "#e9edf6" };
export const TOOLTIP_LABEL_STYLE = { color: "#8b93ab", marginBottom: 2 };

/**
 * 막대 위 값 라벨 — **툴팁이 값을 읽는 유일한 수단이면 안 된다.**
 * 이 리포트는 발표·캡처로 소비되는데 호버는 그때 존재하지 않는다.
 * (비중 차트는 막대가 6~8개뿐이라 전량 표기, 추이 차트는 양 끝만 — 아래 각 차트 주석)
 */
const LABEL_FILL = "var(--color-chart-label)";
const LABEL_SIZE = 10;

/**
 * 라벨을 전량 표기할지, 최댓값 하나만 표기할지 — **칸 수로** 정한다.
 *
 * 가장 좁은 경우가 모바일 패널(차트 275px)인데, 거기서 7칸까지는 "10.7%" 를 전부
 * 적어도 최소 간격 8px 로 안 겹치고(실측), 9칸은 겹친다(실측 2건).
 * 폭을 재서 정하는 방법(ResizeObserver)도 되지만 화면이 그려지지 않는 환경에서는
 * 콜백이 오지 않아 검증이 불가능했다 — 칸 수는 렌더 시점에 이미 아는 값이라
 * 측정 없이 결정적이고, 좁은 화면에서도 같은 결과가 나온다.
 * 8칸 이상에서 최댓값만 남기는 것은 "직접 라벨은 선택적으로"라는 원칙과도 맞는다.
 */
const LABEL_ALL_MAX_SLOTS = 7;

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
  // 칸이 많으면 최댓값 하나만 남긴다 (LABEL_ALL_MAX_SLOTS 주석 참조)
  const labelAll = rows.length <= LABEL_ALL_MAX_SLOTS;
  const labeled = rows.map((r) => ({
    ...r,
    tag: labelAll || r.pct === maxPct ? `${r.pct.toFixed(1)}%` : "",
  }));
  return (
    // 막대 위 라벨이 들어갈 여유(top margin)까지 포함한 높이 — 라벨이 잘리면
    // 컨테이너 안에 미세 스크롤이 생기거나 첫 글자가 깎인다
    <div className="h-32 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={labeled} margin={{ top: 18, right: 4, left: 4, bottom: 0 }}>
          <XAxis dataKey="label" tickLine={false} axisLine={false} tick={TICK} interval={0} />
          <Tooltip
            cursor={{ fill: "var(--color-chart-cursor)" }}
            contentStyle={TOOLTIP_STYLE}
            itemStyle={TOOLTIP_ITEM_STYLE}
            labelStyle={TOOLTIP_LABEL_STYLE}
            formatter={(v) => [`${v}%`, "비중"]}
          />
          <Bar dataKey="pct" radius={[3, 3, 0, 0]} isAnimationActive={false}>
            {/* 소수 1자리를 쓰는 이유: 정수로 줄이면 칸마다 따로 반올림해
                합이 102% 처럼 보인다 (요일 7칸에서 실측) */}
            <LabelList dataKey="tag" position="top" fill={LABEL_FILL} fontSize={LABEL_SIZE} />
            {rows.map((r) => (
              <Cell
                key={r.label}
                fill={r.pct === maxPct ? "var(--color-gold)" : "var(--color-chart-bar)"}
              />
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
  const last = data.length - 1;
  // 추이는 '어디서 어디로' 가 요점이라 **양 끝만** 직접 표기한다 (중간까지 전부
  // 적으면 8분기에서 라벨이 겹친다). 중간 값은 툴팁 + 옆의 DeltaBadge 가 답한다.
  const rows = data.map((p, i) => ({
    quarter: p.quarter.replace("20", "'"),
    value: p.value,
    tag: i === 0 || i === last ? format(p.value) : "",
  }));
  return (
    <div className="h-32 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 18, right: 4, left: 4, bottom: 0 }}>
          <XAxis dataKey="quarter" tickLine={false} axisLine={false} tick={TICK} interval={0} />
          <Tooltip
            cursor={{ fill: "var(--color-chart-cursor)" }}
            contentStyle={TOOLTIP_STYLE}
            itemStyle={TOOLTIP_ITEM_STYLE}
            labelStyle={TOOLTIP_LABEL_STYLE}
            formatter={(v) => [format(Number(v)), "값"]}
          />
          <Bar dataKey="value" radius={[3, 3, 0, 0]} isAnimationActive={false}>
            <LabelList dataKey="tag" position="top" fill={LABEL_FILL} fontSize={LABEL_SIZE} />
            {rows.map((r, i) => (
              <Cell
                key={r.quarter}
                fill={i === last ? "var(--color-gold)" : "var(--color-chart-bar)"}
              />
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
      {/* 두 칸 사이 2px 배경 틈 — 맞닿은 채색면은 경계선을 그리지 말고 띄워서 나눈다 */}
      <div className="flex h-4 w-full gap-[2px] overflow-hidden rounded-full">
        <div className="rounded-l-full bg-chart-male" style={{ width: `${mp}%` }} />
        <div className="rounded-r-full bg-chart-female" style={{ width: `${fp}%` }} />
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
          <span className="w-16 shrink-0 text-[11px] text-muted">{r.label}</span>
          <div className="h-3.5 min-w-0 flex-1 overflow-hidden rounded-sm bg-chart-bar-soft/60">
            {r.value != null && max > 0 && (
              <div
                className={`h-full rounded-sm ${r.highlight ? "bg-gold" : "bg-chart-bar"}`}
                style={{ width: `${Math.max((r.value / max) * 100, 2)}%` }}
              />
            )}
          </div>
          {/* 값 칸이 좁으면 "8,269억" 같은 축약값이 잘린다 — 3단 비교의 핵심이 이 숫자다 */}
          <span
            className={`w-[76px] shrink-0 text-right text-[11px] ${r.highlight ? "text-gold" : "text-fg/85"}`}
            style={{ fontFamily: "var(--font-numeric)" }}
          >
            {r.value != null ? format(r.value) : "―"}
          </span>
        </li>
      ))}
    </ul>
  );
}

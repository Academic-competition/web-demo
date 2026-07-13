"use client";
/**
 * DemographicsChart — 유동인구 연령대 구성 미니 차트 (보조 지표)
 */
import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
} from "recharts";

const BAND_LABEL: Record<string, string> = {
  "10s": "10대",
  "20s": "20대",
  "30s": "30대",
  "40s": "40대",
  "50s": "50대",
  "60s+": "60+",
};

export default function DemographicsChart({
  data,
}: {
  data: { ageBand: string; ratio: number }[];
}) {
  const rows = data.map((d) => ({
    band: BAND_LABEL[d.ageBand] ?? d.ageBand,
    pct: Math.round(d.ratio * 1000) / 10,
  }));
  const maxPct = Math.max(...rows.map((r) => r.pct), 0);

  return (
    <div className="h-28 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 6, right: 4, left: 4, bottom: 0 }}>
          <XAxis
            dataKey="band"
            tickLine={false}
            axisLine={false}
            tick={{ fill: "#8a95b0", fontSize: 11 }}
            interval={0}
          />
          <Tooltip
            cursor={{ fill: "rgba(255,255,255,0.04)" }}
            contentStyle={{
              background: "#141d33",
              border: "1px solid #263354",
              borderRadius: 8,
              fontSize: 12,
              color: "#e9edf6",
            }}
            formatter={(v) => [`${v}%`, "비율"]}
          />
          <Bar dataKey="pct" radius={[3, 3, 0, 0]} isAnimationActive={false}>
            {rows.map((r) => (
              <Cell
                key={r.band}
                fill={r.pct === maxPct ? "var(--color-gold)" : "#3a486e"}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

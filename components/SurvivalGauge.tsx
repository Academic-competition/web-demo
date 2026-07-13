"use client";
/**
 * SurvivalGauge — 3년 생존율 반원 게이지 (결과 카드의 메인 시각 요소)
 * 신호등 등급 색으로 호를 채우고, 문턱값(45%/60%) 눈금을 표시한다.
 */
import type { Grade } from "@/lib/contracts";
import { GRADE_THRESHOLDS } from "@/lib/contracts";

const GRADE_COLOR: Record<Grade, string> = {
  safe: "var(--color-safe)",
  caution: "var(--color-caution)",
  risk: "var(--color-risk)",
};

const GRADE_LABEL: Record<Grade, string> = {
  safe: "양호",
  caution: "주의",
  risk: "위험",
};

export default function SurvivalGauge({
  probability,
  grade,
  horizonYears,
}: {
  probability: number;
  grade: Grade;
  horizonYears: number;
}) {
  const W = 260;
  const H = 150;
  const cx = W / 2;
  const cy = H - 10;
  const r = 100;
  const circumference = Math.PI * r; // 반원 길이
  const filled = circumference * Math.min(Math.max(probability, 0), 1);
  const color = GRADE_COLOR[grade];

  // 문턱값 눈금 좌표 (반원: 180° → 0°)
  const tick = (p: number) => {
    const angle = Math.PI * (1 - p);
    const x1 = cx + Math.cos(angle) * (r - 14);
    const y1 = cy - Math.sin(angle) * (r - 14);
    const x2 = cx + Math.cos(angle) * (r + 8);
    const y2 = cy - Math.sin(angle) * (r + 8);
    return { x1, y1, x2, y2 };
  };
  const t1 = tick(GRADE_THRESHOLDS.caution);
  const t2 = tick(GRADE_THRESHOLDS.safe);

  return (
    <div className="relative flex flex-col items-center">
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden>
        {/* 트랙 */}
        <path
          d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
          fill="none"
          stroke="var(--color-ink-600)"
          strokeWidth={13}
          strokeLinecap="round"
          opacity={0.55}
        />
        {/* 채워진 호 */}
        <path
          className="gauge-arc"
          d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
          fill="none"
          stroke={color}
          strokeWidth={13}
          strokeLinecap="round"
          strokeDasharray={`${filled} ${circumference}`}
          style={{ "--dash-total": `${circumference}` } as React.CSSProperties}
        />
        {/* 문턱값 눈금 */}
        {[t1, t2].map((t, i) => (
          <line
            key={i}
            x1={t.x1}
            y1={t.y1}
            x2={t.x2}
            y2={t.y2}
            stroke="var(--color-faint)"
            strokeWidth={1.5}
          />
        ))}
      </svg>

      <div className="absolute bottom-1 flex flex-col items-center">
        <div
          className="text-[42px] leading-none font-semibold tracking-tight"
          style={{ fontFamily: "var(--font-numeric)", color }}
        >
          {(probability * 100).toFixed(1)}
          <span className="text-xl text-muted">%</span>
        </div>
        <div className="mt-1.5 flex items-center gap-1.5">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ background: color }}
          />
          <span className="text-xs font-medium" style={{ color }}>
            {GRADE_LABEL[grade]}
          </span>
          <span className="text-xs text-faint">· {horizonYears}년 생존율</span>
        </div>
      </div>
    </div>
  );
}

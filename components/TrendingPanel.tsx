"use client";
/**
 * TrendingPanel — 초기 화면의 '뜨는 상권 / 뜨는 동네' (golmok 벤치마크 대응)
 *
 * golmok 뜨는 상권 = [뜨는 동네(행정동)|뜨는 상권] 토글 × 지표(점포수/매출/유동인구/
 * 주거인구) × 기준(순위/증가율) → Top10. 우리는 직장인구를 더해 5종이고,
 * 행 클릭이 곧 분석 진입이다 (golmok 은 랭킹 행에 클릭 핸들러가 없다 — 실측 확인).
 * 동네 행은 리포트가 없으므로(분석은 상권 단위) 클릭하면 **그 동의 상권 목록으로
 * 드릴다운**한다 — golmok 에 없는 경로다.
 *
 * 설계 제약 (ComparePanel 과 동일): **웹은 수치를 만들지 않는다.**
 *  - 값·증감률·소표본(lowBase) 판정·행정동 합산 전부 export_web_static.py 산출
 *  - 여기서 하는 것은 정렬·TopN 슬라이스·필터·포맷팅뿐 (표시 계층)
 *  - 증가율 정렬에서 lowBase 를 기본 제외하고 그 사실을 문구로 밝힌다 —
 *    golmok 은 "돈암1동 커피 5만원 +326%" 같은 소표본 노이즈가 상위를 점령했다
 */
import { useMemo, useState } from "react";

import type { RankingEntry, RankingsResult } from "@/lib/contracts";

const TOP_N = 10;
/** 지표 표시 순서 — 계약의 RankingMetricKey 와 같은 키 */
const METRIC_ORDER = ["sales", "stores", "footTraffic", "resident", "worker"] as const;

type SortBasis = "value" | "changePct";
type Unit = "sangwon" | "dong";

function fmtValue(v: number, unit: string): string {
  if (unit === "KRW") {
    if (v >= 1e12) return `${(v / 1e12).toFixed(1)}조`;
    if (v >= 1e8) return `${(v / 1e8).toFixed(0)}억`;
    return `${Math.round(v / 1e4).toLocaleString()}만`;
  }
  if (v >= 1e4) return `${(v / 1e4).toFixed(1)}만${unit === "명" ? "명" : ""}`;
  return `${v.toLocaleString()}${unit === "개" ? "개" : unit === "명" ? "명" : ""}`;
}

/** 정렬·슬라이스 — 상권/동네 공용 (표시 계층: 제공된 값을 줄 세우기만 한다) */
function rankRows<T extends { metrics: Record<string, RankingEntry> }>(
  items: T[],
  metricKey: string,
  basis: SortBasis,
  topN = TOP_N
): { row: T; m: RankingEntry }[] {
  const picked = items
    .map((r) => ({ row: r, m: r.metrics[metricKey] }))
    .filter((x): x is { row: T; m: RankingEntry } => x.m != null);
  if (basis === "changePct") {
    // 소표본 노이즈 제외 — 판정(lowBase)은 파이프라인이 했고 여기선 필터만.
    // 증가율 동률(직장인구는 분기 간 변화가 드묾)은 규모로 타이브레이크.
    return picked
      .filter((x) => x.m.changePct != null && !x.m.lowBase)
      .sort((a, b) => b.m.changePct! - a.m.changePct! || b.m.value - a.m.value)
      .slice(0, topN);
  }
  return picked.sort((a, b) => b.m.value - a.m.value).slice(0, topN);
}

export default function TrendingPanel({
  data,
  onPick,
}: {
  data: RankingsResult;
  onPick: (code: number) => void;
}) {
  const [unit, setUnit] = useState<Unit>("sangwon");
  const [metricKey, setMetricKey] = useState<string>("sales");
  const [basis, setBasis] = useState<SortBasis>("value");
  /** 뜨는 동네에서 펼친 동 (드릴다운) — 동 코드 */
  const [openDong, setOpenDong] = useState<number | null>(null);

  const meta = data.metrics[metricKey];

  const sangwonRows = useMemo(
    () => (unit === "sangwon" ? rankRows(data.rows, metricKey, basis) : []),
    [data, unit, metricKey, basis]
  );
  const dongRows = useMemo(
    () => (unit === "dong" ? rankRows(data.dongs, metricKey, basis) : []),
    [data, unit, metricKey, basis]
  );
  /** 펼친 동의 상권들 — 같은 지표로 정렬 (동네 값이 이 상권들의 합임을 그대로 보여준다) */
  const drilldown = useMemo(() => {
    if (openDong == null) return [];
    return rankRows(
      data.rows.filter((r) => r.dongCode === openDong),
      metricKey,
      "value",
      99
    );
  }, [data, openDong, metricKey]);

  if (!meta) return null;

  const unitLabel = unit === "sangwon" ? "상권" : "동네";

  return (
    <div className="rise-in space-y-2">
      <div>
        <h2 className="font-[family-name:var(--font-display)] text-[17px] leading-tight text-fg">
          뜨는 {unitLabel} TOP {unit === "sangwon" ? sangwonRows.length : dongRows.length}
        </h2>
        <p className="mt-0.5 text-[11px] text-muted">
          {meta.label} {basis === "value" ? "상위" : "증가율 상위"} · 기준 {meta.asOf} ·{" "}
          {unit === "sangwon"
            ? "클릭하면 그 상권 분석으로 이동합니다"
            : "동을 클릭하면 소속 상권이 펼쳐집니다"}
        </p>
      </div>

      {/* 단위 토글 — golmok [뜨는 동네|뜨는 상권] 대응 */}
      <div className="flex gap-1">
        {(
          [
            ["sangwon", "뜨는 상권"],
            ["dong", "뜨는 동네 (행정동)"],
          ] as [Unit, string][]
        ).map(([u, label]) => (
          <button
            key={u}
            onClick={() => {
              setUnit(u);
              setOpenDong(null);
            }}
            className={`rounded-md border px-2.5 py-1 text-[11px] font-semibold transition ${
              unit === u
                ? "border-gold/70 bg-gold/15 text-gold-soft"
                : "border-line/60 text-muted hover:border-gold/40 hover:text-fg"
            }`}
          >
            {label}
          </button>
        ))}
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

      {unit === "sangwon" ? (
        <ol className="space-y-1">
          {sangwonRows.map(({ row, m }, i) => (
            <li key={row.code}>
              <RankRowButton
                rank={i + 1}
                title={row.name ?? String(row.code)}
                subtitle={`${row.gu ?? ""}${row.category ? ` · ${row.category}` : ""}`}
                entry={m}
                unit={meta.unit}
                basis={basis}
                onClick={() => onPick(row.code)}
              />
            </li>
          ))}
        </ol>
      ) : (
        <ol className="space-y-1">
          {dongRows.map(({ row, m }, i) => (
            <li key={row.code}>
              <RankRowButton
                rank={i + 1}
                title={row.name ?? String(row.code)}
                subtitle={row.gu ?? ""}
                entry={m}
                unit={meta.unit}
                basis={basis}
                active={openDong === row.code}
                onClick={() => setOpenDong(openDong === row.code ? null : row.code)}
              />
              {/* 드릴다운: 이 동의 상권들 (동 값 = 이 상권들의 합) */}
              {openDong === row.code && (
                <ul className="mt-1 space-y-1 border-l border-gold/30 pl-3">
                  {drilldown.map(({ row: sw, m: sm }) => (
                    <li key={sw.code}>
                      <button
                        onClick={() => onPick(sw.code)}
                        className="group flex w-full items-center gap-2 rounded-md border border-line/40 bg-ink-800/30 px-2.5 py-1.5 text-left transition hover:border-gold/60 hover:bg-ink-700/60"
                      >
                        <span className="min-w-0 flex-1 truncate text-[12px] text-fg transition group-hover:text-gold-soft">
                          {sw.name ?? sw.code}
                        </span>
                        <span
                          className="shrink-0 text-[11px] text-gold"
                          style={{ fontFamily: "var(--font-numeric)" }}
                        >
                          {fmtValue(sm.value, meta.unit)}
                        </span>
                      </button>
                    </li>
                  ))}
                  {!drilldown.length && (
                    <li className="px-2.5 py-1.5 text-[11px] text-faint">
                      이 지표 데이터가 있는 소속 상권이 없습니다
                    </li>
                  )}
                </ul>
              )}
            </li>
          ))}
        </ol>
      )}

      <p className="border-t border-line/50 pt-1.5 text-[10px] leading-relaxed text-faint">
        {meta.scope} 기준.
        {unit === "dong" && " 동네 값은 소속 상권 값의 합산입니다 (상권분석서비스 영역 밖 지역 미포함)."}
        {" "}값·증감률은 모델 파이프라인 산출이며 화면은 정렬만 합니다.
        {basis === "changePct" && (
          <>
            {" "}직전 분기 규모가 전체 중앙값 미만인 소규모 {unitLabel}은 증가율 순위에서
            제외했습니다 (소표본 노이즈 방지).
          </>
        )}
      </p>
    </div>
  );
}

/** 랭킹 행 버튼 — 상권/동네 공용 렌더 */
function RankRowButton({
  rank,
  title,
  subtitle,
  entry,
  unit,
  basis,
  active,
  onClick,
}: {
  rank: number;
  title: string;
  subtitle: string;
  entry: RankingEntry;
  unit: string;
  basis: SortBasis;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`group flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition hover:border-gold/60 hover:bg-ink-700/60 ${
        active ? "border-gold/60 bg-ink-700/60" : "border-line/50 bg-ink-800/40"
      }`}
    >
      <span
        className="w-5 shrink-0 text-right text-[12px] text-faint"
        style={{ fontFamily: "var(--font-numeric)" }}
      >
        {rank}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] text-fg transition group-hover:text-gold-soft">
          {title}
        </span>
        <span className="text-[10px] text-faint">{subtitle}</span>
      </span>
      <span className="shrink-0 text-right">
        <span
          className="block text-[13px] font-semibold text-gold"
          style={{ fontFamily: "var(--font-numeric)" }}
        >
          {basis === "changePct" && entry.changePct != null
            ? `+${entry.changePct.toFixed(1)}%`
            : fmtValue(entry.value, unit)}
        </span>
        {/* 보조 값 — 증가율 정렬이면 규모를, 수준 정렬이면 증감을 함께 */}
        <span
          className="block text-[10px] text-faint"
          style={{ fontFamily: "var(--font-numeric)" }}
        >
          {basis === "changePct"
            ? fmtValue(entry.value, unit)
            : entry.changePct != null && (
                <span className={entry.changePct >= 0 ? "text-safe" : "text-risk"}>
                  {entry.changePct >= 0 ? "▲" : "▼"} {Math.abs(entry.changePct).toFixed(1)}%
                </span>
              )}
        </span>
      </span>
    </button>
  );
}

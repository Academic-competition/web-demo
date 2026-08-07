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
const METRIC_ORDER = [
  "sales",
  "stores",
  "footTraffic",
  "resident",
  "worker",
  // 밀도 3종은 절대 인구 뒤에. 앞 5종은 전부 절대값이라 "면적 대비 밀집"에 답하지 못한다
  "footTrafficDensity",
  "residentDensity",
  "workerDensity",
] as const;

type SortBasis = "value" | "changePct";
type Unit = "sangwon" | "dong";

function fmtValue(v: number, unit: string): string {
  if (unit === "KRW") {
    if (v >= 1e12) return `${(v / 1e12).toFixed(1)}조`;
    if (v >= 1e8) return `${(v / 1e8).toFixed(0)}억`;
    return `${Math.round(v / 1e4).toLocaleString()}만`;
  }
  if (unit === "명/km²") {
    // 지표마다 자릿수가 3배 넘게 벌어진다 — 유동은 분기 연인원이라 억대(서울 중앙값
    // 824만/km²), 상주는 2.5만, 직장은 0.76만. 만 단위로 일괄 접으면 상주 50,730 이
    // "5만" 이 돼 순위가 다 같아 보인다. 천만 이상만 접고 나머지는 원 자릿수를 남긴다.
    if (v >= 1e8) return `${(v / 1e8).toFixed(1)}억/km²`;
    if (v >= 1e7) return `${Math.round(v / 1e4).toLocaleString()}만/km²`;
    return `${Math.round(v).toLocaleString()}/km²`;
  }
  if (v >= 1e4) return `${(v / 1e4).toFixed(1)}만${unit === "명" ? "명" : ""}`;
  return `${v.toLocaleString()}${unit === "개" ? "개" : unit === "명" ? "명" : ""}`;
}

/** 정렬·슬라이스 — 상권/동네 공용 (표시 계층: 제공된 값을 줄 세우기만 한다) */
function rankRows<T extends { metrics: Record<string, RankingEntry> }>(
  items: T[],
  metricKey: string,
  basis: SortBasis,
  topN = TOP_N,
  /** 수준 정렬에서도 lowBase 를 빼야 하는 지표 (밀도 — 분모가 작은 상권이 상위를 점령) */
  excludeLowBase = false
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
  return picked
    .filter((x) => !excludeLowBase || !x.m.lowBase)
    .sort((a, b) => b.m.value - a.m.value)
    .slice(0, topN);
}

export default function TrendingPanel({
  data,
  onPick,
}: {
  data: RankingsResult;
  onPick: (code: number) => void;
}) {
  const [unit, setUnit] = useState<Unit>("sangwon");
  const [topKey, setTopKey] = useState<string>("sales");
  /** 유동인구 연령대 서브 필터 (golmok 상세조건 대응) — null = 전체 */
  const [ageKey, setAgeKey] = useState<string | null>(null);
  const [basis, setBasis] = useState<SortBasis>("value");
  /** 뜨는 동네에서 펼친 동 (드릴다운) — 동 코드 */
  const [openDong, setOpenDong] = useState<number | null>(null);

  /** 실제 조회 지표 — 유동인구 + 연령 선택 시 서브 지표 키로 전환 */
  const metricKey =
    topKey === "footTraffic" && ageKey ? `footTraffic_${ageKey}` : topKey;
  const meta = data.metrics[metricKey];
  /** 연령 서브 토글 목록 — subOf 로 파이프라인이 선언한 것만 (하드코딩 금지) */
  const ageSubs = Object.entries(data.metrics)
    .filter(([, m]) => m.subOf === "footTraffic")
    .map(([k, m]) => ({ key: k.replace("footTraffic_", ""), label: m.label.replace("유동인구 ", "") }));

  /**
   * 증가율이 없는 지표(밀도) — 파이프라인이 levelOnly 로 선언한다.
   * 정렬 상태를 되돌리는 대신 유효값으로 덮어쓴다 (지표를 오가도 상태가 꼬이지 않는다).
   */
  const levelOnly = !!meta?.levelOnly;
  const effBasis: SortBasis = levelOnly ? "value" : basis;
  /**
   * 수준 정렬에서 lowBase 를 빼는 조건 — 아래 `lowBaseApplied`(고지 문구) 와 **같은 식**이어야
   * 한다. 밝히지 않고 행을 빼지 않는다는 원칙이라, 조건이 갈라지면 조용한 누락이 된다.
   * 동네는 파이프라인이 lowBase 를 안 매긴다(여러 상권의 면적 합이라 분모 과소가 없다 —
   * 397개 중 하한 미달 2개, 상위권은 여의동·삼성1동 같은 실제 오피스 밀집).
   */
  const excludeLow = levelOnly && unit === "sangwon";

  const sangwonRows = useMemo(
    () => (unit === "sangwon" ? rankRows(data.rows, metricKey, effBasis, TOP_N, excludeLow) : []),
    [data, unit, metricKey, effBasis, excludeLow]
  );
  const dongRows = useMemo(
    () => (unit === "dong" ? rankRows(data.dongs, metricKey, effBasis, TOP_N, excludeLow) : []),
    [data, unit, metricKey, effBasis, excludeLow]
  );
  /**
   * 펼친 동의 상권들 — 같은 지표로 정렬 (동네 값이 이 상권들의 합임을 그대로 보여준다).
   * 밀도는 합이 아니라 면적 가중 평균이라 이 목록의 값을 더해도 동 값이 안 나온다 —
   * 소속 상권 목록으로만 읽을 것. lowBase 도 여기선 거르지 않는다 (랭킹이 아니라 구성원).
   */
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
  /** lowBase 제외를 **실제로 적용한 경우에만** 밝힌다 (조건은 위 excludeLow 와 한 쌍) */
  const lowBaseApplied = effBasis === "changePct" || excludeLow;
  const lowBaseText =
    meta.lowBaseNote ??
    `직전 분기 규모가 전체 중앙값 미만인 소규모 ${unitLabel}은 증가율 순위에서 제외했습니다 (소표본 노이즈 방지).`;

  return (
    <div className="rise-in space-y-2">
      <div>
        <h2 className="font-[family-name:var(--font-display)] text-[17px] leading-tight text-fg">
          뜨는 {unitLabel} TOP {unit === "sangwon" ? sangwonRows.length : dongRows.length}
        </h2>
        <p className="mt-0.5 text-[11px] text-muted">
          {meta.label} {effBasis === "value" ? "상위" : "증가율 상위"} · 기준 {meta.asOf} ·{" "}
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

      {/* 지표 토글 (서브 지표는 안 뜬다 — subOf 참조) */}
      <div className="flex flex-wrap gap-1">
        {METRIC_ORDER.filter((k) => data.metrics[k]).map((k) => (
          <button
            key={k}
            onClick={() => {
              setTopKey(k);
              if (k !== "footTraffic") setAgeKey(null);
            }}
            className={`rounded-full border px-2.5 py-1 text-[11px] transition ${
              topKey === k
                ? "border-gold/70 bg-gold/15 text-gold-soft"
                : "border-line/60 text-muted hover:border-gold/40 hover:text-fg"
            }`}
          >
            {data.metrics[k].label}
          </button>
        ))}
      </div>

      {/* 연령대 서브 필터 — 유동인구 지표에서만 (golmok 상세조건 대응) */}
      {topKey === "footTraffic" && ageSubs.length > 0 && (
        <div className="flex flex-wrap gap-1">
          <button
            onClick={() => setAgeKey(null)}
            className={`rounded-full border px-2 py-0.5 text-[10px] transition ${
              ageKey == null
                ? "border-gold/60 bg-ink-700/70 text-gold-soft"
                : "border-line/50 text-faint hover:text-muted"
            }`}
          >
            전체 연령
          </button>
          {ageSubs.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setAgeKey(key)}
              className={`rounded-full border px-2 py-0.5 text-[10px] transition ${
                ageKey === key
                  ? "border-gold/60 bg-ink-700/70 text-gold-soft"
                  : "border-line/50 text-faint hover:text-muted"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* 정렬 기준 (golmok 상세조건의 최고순위/비교증가율 대응).
          밀도(levelOnly)는 증가율이 인구 증가율과 같은 중복 지표라 토글 자체를 감춘다 */}
      <div className={`flex gap-1 ${levelOnly ? "hidden" : ""}`}>
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
                basis={effBasis}
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
                basis={effBasis}
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
        {/* 밀도는 위 scope 가 이미 "Σ인구/Σ면적" 을 밝히므로 합산 문장을 반복하지 않는다 */}
        {unit === "dong" &&
          (levelOnly
            ? " 동네 값에 상권분석서비스 영역 밖 지역은 포함되지 않습니다."
            : " 동네 값은 소속 상권 값의 합산입니다 (상권분석서비스 영역 밖 지역 미포함).")}
        {" "}값·증감률은 모델 파이프라인 산출이며 화면은 정렬만 합니다.
        {lowBaseApplied && <> {lowBaseText}</>}
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

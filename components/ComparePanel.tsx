"use client";
/**
 * ComparePanel — 상권 비교 (최대 3개, golmok `compare_analysis` 벤치마크)
 *
 * ⚠️ **이 화면은 새 수치를 만들지 않는다.**
 *   모든 셀은 `/api/analyze` 응답의 **한 필드를 그대로** 읽어 표기만 바꾼 것이다
 *   (아래 ROWS 의 `from` 이 그 필드 경로 — 계보 감사를 위해 화면에도 노출한다).
 *   합계·차이·순위·승패 같은 파생 계산을 여기서 하지 않는다:
 *     - 좋고 나쁨은 모델이 이미 준 값(백분위·등급·서울 대비)으로만 말한다
 *     - 비교 전용 집계가 필요하면 모델/서빙에 요청한다. 산식이 웹에 생기면
 *       리포트와 비교 화면의 숫자가 갈라진다 (치안 산식에서 실제로 겪은 문제)
 */
import { Fragment, useState } from "react";
import type { AnalyzeResult } from "@/lib/contracts";
import { formatKRW, formatPeople } from "@/lib/format";

type Cell = { text: string; tone?: "good" | "warn" | "bad"; sub?: string };

/** 값이 없을 때는 지어내지 않고 '―' (golmok 도 "해당하는 데이터가 없습니다"로 비운다) */
const EMPTY: Cell = { text: "―" };

const compact = (v: number) =>
  v >= 1e8 ? `${(v / 1e8).toFixed(1)}억` : v >= 1e4 ? `${Math.round(v / 1e4).toLocaleString()}만` : Math.round(v).toLocaleString();

type Row = {
  group: string;
  label: string;
  /** 감사용 — 이 셀이 어느 응답 필드에서 왔는지 (하드코딩 금지 원칙의 증거) */
  from: string;
  cell: (r: AnalyzeResult) => Cell;
};

const ROWS: Row[] = [
  // ── 판정 ─────────────────────────────────────────────
  {
    group: "판정",
    label: "상권 유형",
    from: "sangwon.type",
    cell: (r) => (r.sangwon.type ? { text: r.sangwon.type } : EMPTY),
  },
  {
    group: "판정",
    label: "3년 생존율",
    from: "survival.probability · grade",
    cell: (r) =>
      r.survival
        ? {
            text: `${(r.survival.probability * 100).toFixed(0)}%`,
            tone: r.survival.grade === "safe" ? "good" : r.survival.grade === "risk" ? "bad" : "warn",
            sub: r.survival.grade === "safe" ? "양호" : r.survival.grade === "risk" ? "위험" : "주의",
          }
        : EMPTY,
  },
  {
    group: "판정",
    label: "모델 종합진단",
    from: "diagnosis.overallScore · grade",
    cell: (r) =>
      r.diagnosis
        ? { text: `${r.diagnosis.overallScore.toFixed(0)}/100`, sub: r.diagnosis.grade ?? undefined }
        : EMPTY,
  },
  {
    group: "판정",
    label: "시장 단계",
    from: "context.competition.marketStage",
    cell: (r) => {
      const s = r.context?.competition?.marketStage;
      if (!s) return EMPTY;
      return { text: s, tone: s === "성장기" ? "good" : s === "쇠퇴기" ? "bad" : s === "안정기" ? undefined : "warn" };
    },
  },

  // ── 매출 ─────────────────────────────────────────────
  {
    group: "매출",
    label: "예상 분기 매출 (점포당)",
    from: "revenue.monthlyEstimateKRW",
    cell: (r) =>
      r.revenue
        ? {
            text: formatKRW(r.revenue.monthlyEstimateKRW),
            sub: `월평균 약 ${formatKRW(r.revenue.monthlyEstimateKRW / 3)}`,
          }
        : EMPTY,
  },
  {
    group: "매출",
    label: "동일업종 내 순위",
    from: "revenue.percentileInSangwon",
    cell: (r) =>
      r.revenue?.percentileInSangwon != null
        ? { text: `상위 ${Math.max(1, Math.round(100 - r.revenue.percentileInSangwon))}%` }
        : EMPTY,
  },
  {
    group: "매출",
    label: "예측 오차 (이 업종)",
    from: "revenue.accuracy.smapePct",
    cell: (r) =>
      r.revenue?.accuracy
        ? {
            text: `±${r.revenue.accuracy.smapePct.toFixed(1)}%`,
            sub: r.revenue.accuracy.lowSample ? "표본 적음" : undefined,
            tone: r.revenue.accuracy.lowSample ? "warn" : undefined,
          }
        : EMPTY,
  },
  {
    group: "매출",
    label: "실측 점포당 매출",
    from: "detail.sales.perStoreKRW",
    cell: (r) =>
      r.detail?.sales?.perStoreKRW != null ? { text: formatKRW(r.detail.sales.perStoreKRW) } : EMPTY,
  },
  {
    group: "매출",
    label: "독립점포 추정",
    from: "detail.independent.estimatedSalesKRW",
    cell: (r) => {
      const i = r.detail?.independent;
      if (!i) return EMPTY;
      if (i.estimatedSalesKRW == null) return { text: "―", sub: "추정 불가 업종" };
      return { text: formatKRW(i.estimatedSalesKRW), sub: i.kUsed ? `k=${i.kUsed.toFixed(1)}` : undefined };
    },
  },

  // ── 경쟁 ─────────────────────────────────────────────
  {
    group: "경쟁",
    label: "동일업종 점포",
    from: "context.competition.storeCount",
    cell: (r) =>
      r.context?.competition?.storeCount != null
        ? { text: `${r.context.competition.storeCount.toLocaleString()}개` }
        : EMPTY,
  },
  {
    group: "경쟁",
    label: "프랜차이즈 비율",
    from: "context.competition.franchiseRatio",
    cell: (r) =>
      r.context?.competition?.franchiseRatio != null
        ? { text: `${(r.context.competition.franchiseRatio * 100).toFixed(0)}%` }
        : EMPTY,
  },
  {
    group: "경쟁",
    label: "개업 / 폐업",
    from: "detail.store.openCount · closeCount",
    cell: (r) => {
      const s = r.detail?.store;
      if (!s || (s.openCount == null && s.closeCount == null)) return EMPTY;
      return { text: `+${s.openCount ?? 0} / -${s.closeCount ?? 0}` };
    },
  },

  // ── 인구 ─────────────────────────────────────────────
  {
    group: "인구",
    label: "분기 유동인구",
    from: "context.footTraffic.total",
    cell: (r) => (r.context?.footTraffic ? { text: formatPeople(r.context.footTraffic.total) } : EMPTY),
  },
  {
    group: "인구",
    label: "유동 밀도",
    from: "context.density.footTrafficPerKm2 (+ seoulMedian)",
    cell: (r) => densityCell(r, "footTrafficPerKm2"),
  },
  {
    group: "인구",
    label: "상주 밀도",
    from: "context.density.residentPerKm2 (+ seoulMedian)",
    cell: (r) => densityCell(r, "residentPerKm2"),
  },
  {
    group: "인구",
    label: "직장 밀도",
    from: "context.density.workerPerKm2 (+ seoulMedian)",
    cell: (r) => densityCell(r, "workerPerKm2"),
  },

  // ── 비용·환경 ─────────────────────────────────────────
  {
    group: "비용·환경",
    label: "임대료 (m²당)",
    from: "detail.realEstate.rentPerM2KRW (+ seoulMedian)",
    cell: (r) => {
      const re = r.detail?.realEstate;
      if (!re) return EMPTY;
      const med = re.seoulMedianRentPerM2KRW;
      return {
        text: `${Math.round(re.rentPerM2KRW).toLocaleString()}원`,
        // '서울 대비'는 export 가 실어 보낸 중앙값과의 비교 — 웹이 만든 기준이 아니다
        sub: med ? `서울 중앙 대비 ${re.rentPerM2KRW >= med ? "+" : "−"}${Math.abs(Math.round(re.rentPerM2KRW - med)).toLocaleString()}` : undefined,
        tone: med ? (re.rentPerM2KRW > med ? "warn" : "good") : undefined,
      };
    },
  },
  {
    group: "비용·환경",
    label: "자치구 5대 범죄",
    from: "detail.safety.totalIncidents · rankAmongGus",
    cell: (r) => {
      const s = r.detail?.safety;
      if (!s || s.totalIncidents == null) return EMPTY;
      return {
        text: `${s.totalIncidents.toLocaleString()}건`,
        sub: s.rankAmongGus != null ? `적은 순 ${s.rankAmongGus}/${s.guCount ?? 25}위` : (s.guName ?? undefined),
      };
    },
  },
];

function densityCell(r: AnalyzeResult, key: "footTrafficPerKm2" | "residentPerKm2" | "workerPerKm2"): Cell {
  const d = r.context?.density;
  const v = d?.[key];
  if (v == null) return EMPTY;
  const med = d?.seoulMedian?.[key] ?? null;
  const ratio = med ? v / med : null;
  return {
    text: compact(v),
    sub:
      ratio == null
        ? undefined
        : ratio >= 1
          ? `서울 중앙의 ${ratio >= 10 ? Math.round(ratio) : ratio.toFixed(1)}배`
          : `서울 중앙의 ${(ratio * 100).toFixed(ratio >= 0.1 ? 0 : 1)}%`,
  };
}

const TONE: Record<NonNullable<Cell["tone"]>, string> = {
  good: "text-safe",
  warn: "text-caution",
  bad: "text-risk",
};

export default function ComparePanel({
  results,
  loadingCount,
  onRemove,
  onClear,
  alwaysOpen = false,
}: {
  results: AnalyzeResult[];
  loadingCount: number;
  onRemove: (sangwonCode: number, industryCode: string) => void;
  onClear: () => void;
  /** 비교함 전용 메뉴에서는 접을 이유가 없다 — 항상 펼침 */
  alwaysOpen?: boolean;
}) {
  // 기본 접힘 (8/7 피드백) — 리포트 위에 17행 표가 통째로 서 있으면 정작
  // 보고서가 눈에 안 들어온다. 담긴 조합 요약만 한 줄로 보여주고 펼쳐야 표가 나온다.
  const [openState, setOpen] = useState(false);
  const open = alwaysOpen || openState;

  if (results.length === 0 && loadingCount === 0) return null;

  const groups = [...new Set(ROWS.map((r) => r.group))];

  return (
    <section className="rise-in rounded-xl border border-gold/30 bg-ink-800/60 px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <button onClick={() => setOpen(!open)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <h3 className="shrink-0 text-[13px] font-semibold text-fg">상권 비교 {results.length}건</h3>
          <span className="min-w-0 truncate text-[10.5px] text-muted">
            {results.map((r) => r.sangwon.name ?? r.sangwon.code).join(" · ")}
            {loadingCount > 0 && ` (+${loadingCount} 로딩)`}
          </span>
          {!alwaysOpen && (
            <span className="shrink-0 text-[10px] text-gold-soft">{open ? "접기 ▴" : "비교표 펼치기 ▾"}</span>
          )}
        </button>
        <button
          onClick={onClear}
          className="shrink-0 rounded border border-line px-2 py-0.5 text-[10px] text-muted transition hover:border-risk/50 hover:text-risk"
        >
          비우기
        </button>
      </div>

      {open && (
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[520px] border-collapse text-left">
          <thead>
            <tr>
              <th className="w-[104px] pb-2 pr-2 text-[10px] font-normal text-faint">항목</th>
              {results.map((r) => (
                <th key={`${r.sangwon.code}-${r.industry.code}`} className="pb-2 pl-2 align-top">
                  <div className="flex items-start justify-between gap-1">
                    <div className="min-w-0">
                      <div className="truncate text-[11.5px] font-semibold text-fg">
                        {r.sangwon.name ?? `#${r.sangwon.code}`}
                      </div>
                      <div className="truncate text-[9.5px] font-normal text-gold-soft">
                        {r.industry.name ?? r.industry.code}
                      </div>
                      <div className="truncate text-[9px] font-normal text-faint">{r.sangwon.gu}</div>
                    </div>
                    <button
                      onClick={() => onRemove(r.sangwon.code, r.industry.code)}
                      aria-label="비교에서 제거"
                      className="shrink-0 rounded px-1 text-[11px] text-faint transition hover:text-risk"
                    >
                      ×
                    </button>
                  </div>
                </th>
              ))}
              {loadingCount > 0 && (
                <th className="pb-2 pl-2 text-[10px] font-normal text-faint">불러오는 중…</th>
              )}
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <Fragment key={g}>
                <tr>
                  <td
                    colSpan={results.length + 1 + (loadingCount > 0 ? 1 : 0)}
                    className="pt-2.5 pb-1 text-[9.5px] uppercase tracking-[0.1em] text-faint"
                  >
                    {g}
                  </td>
                </tr>
                {ROWS.filter((r) => r.group === g).map((row) => (
                  <tr key={row.label} className="border-t border-line/30">
                    <td className="py-1.5 pr-2 align-top text-[10.5px] text-muted" title={`출처: ${row.from}`}>
                      {row.label}
                    </td>
                    {results.map((res) => {
                      const c = row.cell(res);
                      return (
                        <td key={`${res.sangwon.code}-${res.industry.code}`} className="py-1.5 pl-2 align-top">
                          <div
                            className={`text-[11.5px] font-semibold ${c.tone ? TONE[c.tone] : "text-fg"}`}
                            style={{ fontFamily: "var(--font-numeric)" }}
                          >
                            {c.text}
                          </div>
                          {c.sub && <div className="text-[9px] leading-tight text-faint">{c.sub}</div>}
                        </td>
                      );
                    })}
                    {loadingCount > 0 && <td className="py-1.5 pl-2 text-[10px] text-faint">·</td>}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      )}

      {open && (
        <p className="mt-2.5 text-[9.5px] leading-relaxed text-faint">
          각 칸은 해당 상권의 분석 리포트에 있는 값을 그대로 옮긴 것입니다 (항목명에 마우스를 올리면
          출처 필드가 보입니다). 비교를 위한 별도 계산·가중치는 쓰지 않았습니다.
        </p>
      )}
    </section>
  );
}

"use client";
/**
 * TopIndustriesPanel — 지역 우선(위치 먼저) 플로우의 중간 단계
 *
 * 지도에서 상권을 고르면, 업종을 먼저 정하지 않아도 그 상권의 업종별 요약 통계를
 * 랭킹으로 보여준다. 사용자는 이 표를 보고 업종을 선택 → 상세 보고서로 진입한다.
 *  - 정렬 토글: 창업기회점수순 / 예상매출순
 *  - 기회점수는 '이 상권 안에서' 업종 간 상대 지표 (서버 계산), 생존율은 업종 단위 통계
 */
import { useMemo, useState } from "react";

import type { TopIndustriesResult } from "@/lib/contracts";

type SortKey = "opportunity" | "sales";

function formatKRW(v: number): string {
  if (v >= 1e8) return `${(v / 1e8).toFixed(1)}억`;
  if (v >= 1e4) return `${Math.round(v / 1e4).toLocaleString()}만`;
  return `${v.toLocaleString()}원`;
}

/** 유동인구: 만 단위 이상은 "N만", 미만은 실제 수치로 (0만으로 뭉개지 않게) */
function formatPeople(v: number): string {
  if (v >= 1e4) return `${(v / 1e4).toFixed(0)}만`;
  return `${Math.round(v).toLocaleString()}명`;
}

const GRADE_DOT: Record<string, string> = {
  safe: "bg-safe",
  caution: "bg-caution",
  risk: "bg-risk",
};

export default function TopIndustriesPanel({
  state,
  onPick,
}: {
  state: { data?: TopIndustriesResult; isLoading: boolean; isError: boolean };
  onPick: (industryCode: string) => void;
}) {
  const [sort, setSort] = useState<SortKey>("opportunity");
  const data = state.data;

  const rows = useMemo(() => {
    if (!data) return [];
    return [...data.industries].sort((a, b) =>
      sort === "opportunity"
        ? b.opportunityScore - a.opportunityScore
        : b.monthlyEstimateKRW - a.monthlyEstimateKRW
    );
  }, [data, sort]);

  if (state.isLoading || (!data && !state.isError)) {
    return (
      <div className="rounded-xl border border-line/60 bg-ink-800/40 px-5 py-8">
        <div className="mb-4 font-[family-name:var(--font-display)] text-base text-fg">
          이 지역의 업종을 살펴보는 중…
        </div>
        <div className="space-y-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="h-11 animate-pulse rounded-lg bg-ink-700/50"
              style={{ animationDelay: `${i * 0.1}s` }}
            />
          ))}
        </div>
      </div>
    );
  }

  if (state.isError || !data) {
    return (
      <div className="rounded-xl border border-line/60 bg-ink-800/40 px-6 py-10 text-center text-sm text-muted">
        이 상권의 업종 데이터를 불러오지 못했습니다.
      </div>
    );
  }

  const { sangwon } = data;

  return (
    <div className="space-y-3">
      {/* 헤더 */}
      <div className="rise-in">
        <div className="flex items-center gap-2">
          <h2 className="font-[family-name:var(--font-display)] text-[19px] leading-tight text-fg">
            {sangwon.name ?? `상권 #${sangwon.code}`}
          </h2>
          {sangwon.category && (
            <span className="rounded-full border border-line/70 bg-ink-700/60 px-2 py-0.5 text-[10px] text-muted">
              {sangwon.category}
            </span>
          )}
          {data.sourceMode === "mock" && (
            <span className="rounded-full border border-caution/40 bg-caution/10 px-2 py-0.5 text-[10px] text-caution">
              목업
            </span>
          )}
        </div>
        <p className="mt-0.5 text-xs text-muted">
          {[sangwon.gu, sangwon.dong].filter(Boolean).join(" ")}
          {sangwon.footTraffic != null && (
            <>
              {" · "}분기 유동인구{" "}
              <span className="text-fg" style={{ fontFamily: "var(--font-numeric)" }}>
                {formatPeople(sangwon.footTraffic)}
              </span>
            </>
          )}
          {" · "}업종 {data.industries.length}개
        </p>
        <p className="mt-1.5 text-[12px] leading-relaxed text-gold-soft">
          이 자리에 어떤 업종이 유망한지 먼저 확인하세요. 업종을 누르면 상세 보고서가 열립니다.
        </p>
      </div>

      {/* 정렬 토글 */}
      <div className="flex items-center gap-2 text-[11px]">
        <span className="text-faint">정렬</span>
        {(
          [
            ["opportunity", "창업기회점수순"],
            ["sales", "예상매출순"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setSort(k)}
            className={`rounded-full border px-2.5 py-1 transition ${
              sort === k
                ? "border-gold/60 bg-gold/10 text-gold-soft"
                : "border-line text-muted hover:border-gold/30"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* 랭킹 리스트 */}
      <div className="space-y-1">
        {rows.map((r, i) => (
          <button
            key={r.code}
            onClick={() => onPick(r.code)}
            className="group flex w-full items-center gap-3 rounded-lg border border-line/50 bg-ink-800/40 px-3 py-2.5 text-left transition hover:border-gold/50 hover:bg-ink-700/60"
          >
            <span
              className="w-5 shrink-0 text-right text-[12px] text-faint"
              style={{ fontFamily: "var(--font-numeric)" }}
            >
              {i + 1}
            </span>
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${r.grade ? GRADE_DOT[r.grade] : ""}`}
              style={r.grade ? undefined : { background: "#5b6683" }}
              title={
                r.survivalProbability != null
                  ? `3년 생존율 ${(r.survivalProbability * 100).toFixed(0)}%`
                  : "생존율 정보 없음"
              }
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-fg transition group-hover:text-gold-soft">
                {r.name ?? r.code}
              </span>
              <span className="text-[10.5px] text-faint">
                예상매출 {formatKRW(r.monthlyEstimateKRW)}
                {r.storeCount != null && <> · 점포 {r.storeCount}개</>}
                {r.survivalProbability != null && (
                  <> · 생존 {(r.survivalProbability * 100).toFixed(0)}%</>
                )}
              </span>
            </span>
            <span className="shrink-0 text-right">
              {sort === "opportunity" ? (
                <>
                  <span
                    className="block text-[14px] font-semibold text-gold"
                    style={{ fontFamily: "var(--font-numeric)" }}
                  >
                    {r.opportunityScore.toFixed(0)}
                  </span>
                  <span className="text-[9px] text-faint">기회점수</span>
                </>
              ) : (
                <>
                  <span
                    className="block text-[13px] font-semibold text-fg"
                    style={{ fontFamily: "var(--font-numeric)" }}
                  >
                    {formatKRW(r.monthlyEstimateKRW)}
                  </span>
                  <span className="text-[9px] text-faint">예상 월매출</span>
                </>
              )}
            </span>
          </button>
        ))}
      </div>

      {/* 각주 */}
      <p className="border-t border-line/50 pt-2 text-[10px] leading-relaxed text-faint">
        창업기회점수는 <b className="text-muted">이 상권 안에서</b> 업종 간 예상매출·경쟁여건·폐업위험을
        종합한 상대 지표입니다. 생존율은 업종 단위 실측 폐업률 통계(상권별 동일)입니다. 기준 {data.dataAsOf}.
      </p>
    </div>
  );
}

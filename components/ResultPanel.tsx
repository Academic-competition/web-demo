"use client";
/**
 * ResultPanel — 3층 결과 카드 (UC-001 수렴점)
 *
 *  1층(메인) : 생존율 게이지 + 신호등 — 의사결정 축
 *  2층(사이드): 예상 매출 — 참고 소구 축 (면책·집계수준 강제 표기)
 *  3층      : AI 해석 서술 + 보조 지표 미니 차트
 *
 * 상태: idle / loading(단계형) / insufficient_data(UC-004) / error(UC-006) / ok
 */
import type { AnalyzeResult } from "@/lib/contracts";
import SurvivalGauge from "./SurvivalGauge";
import DemographicsChart from "./DemographicsChart";

// ------------------------------------------------------------------
// 포맷터
// ------------------------------------------------------------------
function formatKRW(v: number): string {
  if (v >= 1e8) return `${(v / 1e8).toFixed(1)}억 원`;
  if (v >= 1e4) return `${Math.round(v / 1e4).toLocaleString()}만 원`;
  return `${v.toLocaleString()}원`;
}

const CONFIDENCE_LABEL = { high: "높음", medium: "보통", low: "낮음" } as const;

// ------------------------------------------------------------------
// 상태 화면들
// ------------------------------------------------------------------
export function IdleState({ mode }: { mode: "location" | "industry" }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-line/60 bg-ink-800/40 px-6 py-12 text-center">
      <div className="font-[family-name:var(--font-display)] text-lg text-gold-soft">
        분석 대기 중
      </div>
      <p className="text-sm leading-relaxed text-muted">
        {mode === "location" ? (
          <>지도를 클릭해 위치를 정하고 업종을 선택한 뒤{" "}
            <span className="text-fg">분석하기</span>를 눌러주세요.</>
        ) : (
          <>업종을 선택하면 상권별 적합도가 지도에 표시됩니다.
            <br />상권을 클릭하면 상세 분석이 열립니다.</>
        )}
      </p>
    </div>
  );
}

const LOADING_STEPS = ["상권 데이터 조회", "예측 모델 질의", "해석 생성"];

export function LoadingState() {
  return (
    <div className="rounded-xl border border-line/60 bg-ink-800/40 px-6 py-8">
      <div className="mb-5 font-[family-name:var(--font-display)] text-base text-fg">
        분석 중입니다…
      </div>
      <ol className="space-y-3">
        {LOADING_STEPS.map((step, i) => (
          <li
            key={step}
            className="pulse-soft flex items-center gap-3 text-sm text-muted"
            style={{ animationDelay: `${i * 0.35}s` }}
          >
            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-line text-[10px] text-faint">
              {i + 1}
            </span>
            {step}
          </li>
        ))}
      </ol>
      <div className="mt-6 space-y-2">
        <div className="h-24 animate-pulse rounded-lg bg-ink-700/60" />
        <div className="h-14 animate-pulse rounded-lg bg-ink-700/40" />
        <div className="h-14 animate-pulse rounded-lg bg-ink-700/30" />
      </div>
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="rounded-xl border border-risk/30 bg-risk/5 px-6 py-8 text-center">
      <div className="mb-2 text-sm font-medium text-risk">
        일시적으로 불러오지 못했습니다
      </div>
      <p className="mb-4 text-xs text-muted">{message}</p>
      <button
        onClick={onRetry}
        className="rounded-lg border border-line bg-ink-700 px-4 py-2 text-sm text-fg transition hover:border-gold/50"
      >
        다시 시도
      </button>
    </div>
  );
}

// ------------------------------------------------------------------
// 공용 조각
// ------------------------------------------------------------------
function MockBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-caution/40 bg-caution/10 px-2 py-0.5 text-[10px] font-medium text-caution">
      ● 목업 데이터 — 모델 서버 미연결
    </span>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gold">
        {children}
      </span>
      <span className="h-px flex-1 bg-line/70" />
    </div>
  );
}

// ------------------------------------------------------------------
// 메인 결과
// ------------------------------------------------------------------
export default function ResultPanel({
  result,
  onChangeIndustry,
  onChangeLocation,
}: {
  result: AnalyzeResult;
  onChangeIndustry: () => void;
  onChangeLocation: () => void;
}) {
  const { sangwon, industry } = result;
  const title = `${sangwon.name ?? `상권 #${sangwon.code}`}`;
  const subtitle = [sangwon.gu, sangwon.dong].filter(Boolean).join(" ");

  // ---- UC-004: 데이터 부족 — 숫자를 렌더링하지 않는다 ----
  if (result.status === "insufficient_data") {
    return (
      <div className="rise-in rounded-xl border border-line/60 bg-ink-800/40 px-6 py-8">
        <header className="mb-4">
          <h2 className="font-[family-name:var(--font-display)] text-xl text-fg">{title}</h2>
          <p className="text-xs text-muted">{subtitle} · {industry.name ?? industry.code}</p>
        </header>
        <div className="rounded-lg border border-caution/30 bg-caution/5 p-4">
          <p className="text-sm leading-relaxed text-fg">
            표본이 적어 신뢰할 만한 예측을 제공하기 어렵습니다.
          </p>
          <p className="mt-2 text-xs text-muted">
            해당 상권×업종 조합의 분기 표본 수: <b className="text-caution">{result.meta.sampleSize}건</b>
            {" "}(기준 {result.meta.dataAsOf}) — 무리한 수치 제시 대신 데이터 한계를 안내합니다.
          </p>
        </div>
        <RetryRow onChangeIndustry={onChangeIndustry} onChangeLocation={onChangeLocation} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 헤더 */}
      <header className="rise-in flex items-start justify-between gap-3" style={{ animationDelay: "0s" }}>
        <div>
          <h2 className="font-[family-name:var(--font-display)] text-[22px] leading-tight text-fg">
            {title}
          </h2>
          <p className="mt-0.5 text-xs text-muted">
            {subtitle && <span>{subtitle} · </span>}
            <span className="text-gold-soft">{industry.name ?? industry.code}</span>
          </p>
        </div>
        {result.sourceMode === "mock" && <MockBadge />}
      </header>

      {/* 1층 — 생존율 (메인/의사결정) */}
      {result.survival && (
        <section
          className="rise-in rounded-xl border border-line/60 bg-ink-800/60 px-5 pb-4 pt-4"
          style={{ animationDelay: "0.05s" }}
        >
          <SectionLabel>생존 전망 — 판단 기준</SectionLabel>
          <div className="flex justify-center">
            <SurvivalGauge
              probability={result.survival.probability}
              grade={result.survival.grade}
              horizonYears={result.survival.horizonYears}
            />
          </div>
          <p className="mt-2 text-center text-[11px] leading-relaxed text-faint">
            {result.survival.basis === "empirical_closure_rate"
              ? "예측치가 아닌 실측 폐업률 통계의 환산값입니다."
              : "모델 산출값입니다."}
            {result.survival.granularity === "seoul_industry" &&
              " 업종 단위 통계로, 상권별 차이는 아직 반영되지 않았습니다."}
          </p>
        </section>
      )}

      {/* 2층 — 매출 (사이드/참고) */}
      {result.revenue && (
        <section
          className="rise-in rounded-xl border border-line/60 bg-ink-800/40 px-5 py-4"
          style={{ animationDelay: "0.12s" }}
        >
          <SectionLabel>예상 매출 — 참고 지표</SectionLabel>
          <div className="flex items-end justify-between gap-3">
            <div>
              <div
                className="text-[30px] font-semibold leading-none text-fg"
                style={{ fontFamily: "var(--font-numeric)" }}
              >
                {formatKRW(result.revenue.monthlyEstimateKRW)}
              </div>
              <div className="mt-1 text-[11px] text-muted">
                월 기준(분기 평균) · {result.revenue.scaleNote}
              </div>
            </div>
            {result.revenue.percentileInSangwon != null && (
              <div className="shrink-0 text-right">
                <div
                  className="text-lg font-semibold text-gold"
                  style={{ fontFamily: "var(--font-numeric)" }}
                >
                  상위 {(100 - result.revenue.percentileInSangwon).toFixed(0)}%
                </div>
                <div className="text-[10px] text-faint">동일 업종 상권 중</div>
              </div>
            )}
          </div>
          {result.revenue.percentileInSangwon != null && (
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-ink-600/70">
              <div
                className="h-full rounded-full bg-gradient-to-r from-gold/60 to-gold"
                style={{ width: `${result.revenue.percentileInSangwon}%` }}
              />
            </div>
          )}
          <p className="mt-3 border-l-2 border-caution/50 pl-2 text-[11px] leading-relaxed text-muted">
            {result.revenue.disclaimer}
          </p>
        </section>
      )}

      {/* 3층 — AI 해석 */}
      {result.narrative && (
        <section
          className="rise-in rounded-xl border border-gold/20 bg-gradient-to-br from-ink-800/70 to-ink-800/30 px-5 py-4"
          style={{ animationDelay: "0.19s" }}
        >
          <SectionLabel>AI 해석</SectionLabel>
          <p className="font-[family-name:var(--font-display)] text-[15px] leading-[1.75] text-fg/95">
            {result.narrative.summary}
          </p>
          <div className="mt-2 text-[10px] text-faint">
            생성 방식: {result.narrative.generator === "rule_based" ? "규칙 기반 (지표 비교)" : result.narrative.generator}
          </div>
        </section>
      )}

      {/* 보조 지표 */}
      {result.context && (
        <section
          className="rise-in rounded-xl border border-line/60 bg-ink-800/40 px-5 py-4"
          style={{ animationDelay: "0.26s" }}
        >
          <SectionLabel>보조 지표</SectionLabel>
          <div className="mb-3 grid grid-cols-2 gap-3">
            {result.context.footTraffic && (
              <div className="rounded-lg bg-ink-700/50 px-3 py-2.5">
                <div className="text-[10px] text-faint">분기 유동인구 (상권)</div>
                <div
                  className="mt-0.5 text-base font-semibold text-fg"
                  style={{ fontFamily: "var(--font-numeric)" }}
                >
                  {(result.context.footTraffic.total / 10000).toFixed(0)}
                  <span className="text-xs text-muted">만 명</span>
                </div>
              </div>
            )}
            {result.context.competition?.storeCount != null && (
              <div className="rounded-lg bg-ink-700/50 px-3 py-2.5">
                <div className="text-[10px] text-faint">
                  동일 업종 점포
                  {result.context.competition.granularity === "seoul_industry" && " (서울 전체)"}
                </div>
                <div
                  className="mt-0.5 text-base font-semibold text-fg"
                  style={{ fontFamily: "var(--font-numeric)" }}
                >
                  {result.context.competition.storeCount.toLocaleString()}
                  <span className="text-xs text-muted">개</span>
                  {result.context.competition.franchiseRatio != null && (
                    <span className="ml-1.5 text-[10px] text-muted">
                      프랜차이즈 {(result.context.competition.franchiseRatio * 100).toFixed(0)}%
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
          {result.context.demographics.length > 0 && (
            <>
              <div className="mb-1 text-[10px] text-faint">유동인구 연령 구성</div>
              <DemographicsChart data={result.context.demographics} />
            </>
          )}
        </section>
      )}

      {/* 재탐색 (UC-003) */}
      <RetryRow onChangeIndustry={onChangeIndustry} onChangeLocation={onChangeLocation} />

      {/* 신뢰성 메타 + 출처 */}
      <footer
        className="rise-in rounded-xl border border-line/40 bg-ink-900/60 px-5 py-3.5"
        style={{ animationDelay: "0.33s" }}
      >
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted">
          <span>
            신뢰도{" "}
            <b className={result.meta.confidence === "high" ? "text-safe" : result.meta.confidence === "medium" ? "text-caution" : "text-risk"}>
              {CONFIDENCE_LABEL[result.meta.confidence]}
            </b>
          </span>
          <span>표본 {result.meta.sampleSize}건</span>
          <span>기준 {result.meta.dataAsOf}</span>
        </div>
        <ul className="mt-1.5 space-y-0.5">
          {result.meta.sources.map((s) => (
            <li key={s} className="text-[10px] leading-relaxed text-faint">
              출처 · {s}
            </li>
          ))}
        </ul>
      </footer>
    </div>
  );
}

function RetryRow({
  onChangeIndustry,
  onChangeLocation,
}: {
  onChangeIndustry: () => void;
  onChangeLocation: () => void;
}) {
  return (
    <div className="rise-in flex gap-2" style={{ animationDelay: "0.3s" }}>
      <button
        onClick={onChangeIndustry}
        className="flex-1 rounded-lg border border-line bg-ink-700/60 px-3 py-2.5 text-sm text-fg transition hover:border-gold/60 hover:bg-ink-700"
      >
        다른 업종으로 <span className="text-faint">(위치 고정)</span>
      </button>
      <button
        onClick={onChangeLocation}
        className="flex-1 rounded-lg border border-line bg-ink-700/60 px-3 py-2.5 text-sm text-fg transition hover:border-gold/60 hover:bg-ink-700"
      >
        다른 위치로 <span className="text-faint">(업종 고정)</span>
      </button>
    </div>
  );
}

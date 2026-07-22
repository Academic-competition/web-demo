"use client";
/**
 * ResultPanel — 상권 분석 리포트 (UC-001 수렴점)
 *
 * 다른 AI 상권분석 서비스처럼 '보고서' 형식으로 제공한다(템플릿 기반, 결정적):
 *   리포트 헤더(종합 판정) → KPI 요약 → ①생존 전망 ②예상 매출 ③상권 지표
 *   ④종합 해석 ⑤유의사항·한계 ⑥데이터 출처
 * grade 판정·면책·집계수준은 서버가 주입한 값을 그대로 노출(정직성 원칙).
 *
 * 상태: idle / loading(단계형) / insufficient_data(UC-004) / error(UC-006) / ok
 */
import type { AnalyzeResult, Grade } from "@/lib/contracts";
import SurvivalGauge from "./SurvivalGauge";
import DemographicsChart from "./DemographicsChart";

// ------------------------------------------------------------------
// 포맷터 / 상수
// ------------------------------------------------------------------
function formatKRW(v: number): string {
  if (v >= 1e8) return `${(v / 1e8).toFixed(1)}억 원`;
  if (v >= 1e4) return `${Math.round(v / 1e4).toLocaleString()}만 원`;
  return `${v.toLocaleString()}원`;
}

/** 유동인구: 만 단위 이상은 "N만 명", 미만은 실제 수치로 (0만으로 뭉개지 않게 — 정직성) */
function formatPeople(v: number): string {
  if (v >= 1e4) return `${(v / 1e4).toFixed(0)}만 명`;
  return `${Math.round(v).toLocaleString()}명`;
}

const CONFIDENCE_LABEL = { high: "높음", medium: "보통", low: "낮음" } as const;

const SOURCE_LABEL = {
  live: "모델 실시간",
  file: "실측 사전계산",
  mock: "목업",
} as const;

/** 신호등 등급 → 종합 판정 문구/색 (Tailwind 정적 클래스로 명시) */
const VERDICT: Record<Grade, { label: string; text: string; chip: string; ring: string; sentence: string }> = {
  safe: {
    label: "양호",
    text: "text-safe",
    chip: "border-safe/40 bg-safe/10 text-safe",
    ring: "border-safe/25",
    sentence: "진입 여건이 상대적으로 안정적입니다.",
  },
  caution: {
    label: "주의",
    text: "text-caution",
    chip: "border-caution/40 bg-caution/10 text-caution",
    ring: "border-caution/25",
    sentence: "기회와 위험이 함께 있어 신중한 검토가 필요합니다.",
  },
  risk: {
    label: "위험",
    text: "text-risk",
    chip: "border-risk/40 bg-risk/10 text-risk",
    ring: "border-risk/25",
    sentence: "진입 부담이 커 보수적인 접근이 필요합니다.",
  },
};

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
          <>지도를 클릭해 위치를 정하면, 그 상권의{" "}
            <span className="text-fg">업종별 기회</span>를 먼저 보여드립니다.</>
        ) : (
          <>업종을 선택하면 상권별 적합도가 지도에 표시됩니다.
            <br />상권을 클릭하면 상세 리포트가 열립니다.</>
        )}
      </p>
    </div>
  );
}

const LOADING_STEPS = ["상권 데이터 조회", "예측 모델 질의", "리포트 생성"];

export function LoadingState() {
  return (
    <div className="rounded-xl border border-line/60 bg-ink-800/40 px-6 py-8">
      <div className="mb-5 font-[family-name:var(--font-display)] text-base text-fg">
        리포트를 작성하는 중입니다…
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
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-caution/40 bg-caution/10 px-2 py-0.5 text-[10px] font-medium text-caution">
      ● 목업 — 모델 미연결
    </span>
  );
}

function Section({
  n,
  title,
  aside,
  children,
  className = "",
}: {
  n: number;
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`rise-in rounded-xl border border-line/60 bg-ink-800/40 px-5 py-4 ${className}`}>
      <div className="mb-3 flex items-center gap-2">
        <span
          className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-gold/15 text-[11px] font-semibold text-gold"
          style={{ fontFamily: "var(--font-numeric)" }}
        >
          {n}
        </span>
        <h3 className="text-[13px] font-semibold text-fg">{title}</h3>
        {aside && <span className="text-[10px] text-faint">· {aside}</span>}
        <span className="h-px flex-1 bg-line/60" />
      </div>
      {children}
    </section>
  );
}

function StatTile({
  label,
  value,
  unit,
  hint,
  tone = "text-fg",
}: {
  label: string;
  value: string;
  unit?: string;
  hint?: string;
  tone?: string;
}) {
  return (
    <div className="rounded-lg border border-line/50 bg-ink-800/50 px-3 py-2.5">
      <div className="text-[10px] text-faint">{label}</div>
      <div className="mt-0.5 flex items-baseline gap-1">
        <span className={`text-[19px] font-semibold leading-none ${tone}`} style={{ fontFamily: "var(--font-numeric)" }}>
          {value}
        </span>
        {unit && <span className="text-[11px] text-muted">{unit}</span>}
      </div>
      {hint && <div className="mt-0.5 text-[9.5px] text-faint">{hint}</div>}
    </div>
  );
}

// ------------------------------------------------------------------
// 메인 리포트
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
          <div className="text-[10px] uppercase tracking-[0.16em] text-faint">상권 분석 리포트</div>
          <h2 className="mt-0.5 font-[family-name:var(--font-display)] text-xl text-fg">{title}</h2>
          <p className="text-xs text-muted">{subtitle} · {industry.name ?? industry.code}</p>
        </header>
        <div className="rounded-lg border border-caution/30 bg-caution/5 p-4">
          <p className="text-sm leading-relaxed text-fg">
            표본이 적어 신뢰할 만한 리포트를 제공하기 어렵습니다.
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

  const grade = result.survival?.grade ?? null;
  const v = grade ? VERDICT[grade] : null;
  const pct = result.revenue?.percentileInSangwon ?? null;

  return (
    <div className="space-y-3.5">
      {/* ── 리포트 헤더 (종합 판정) ─────────────────────── */}
      <header
        className={`rise-in rounded-xl border bg-gradient-to-br from-ink-800/80 to-ink-800/30 px-5 py-4 ${v ? v.ring : "border-line/60"}`}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-[0.16em] text-faint">상권 분석 리포트</div>
            <h2 className="mt-0.5 font-[family-name:var(--font-display)] text-[22px] leading-tight text-fg">
              {title}
            </h2>
            <p className="mt-0.5 text-xs text-muted">
              {subtitle && <span>{subtitle} · </span>}
              <span className="text-gold-soft">{industry.name ?? industry.code}</span>
            </p>
          </div>
          {result.sourceMode === "mock" && <MockBadge />}
        </div>

        {/* 종합 판정 */}
        {v && result.survival && (
          <div className="mt-3 flex items-center gap-2.5 rounded-lg border border-line/50 bg-ink-900/50 px-3 py-2">
            <span className={`shrink-0 rounded-md border px-2 py-0.5 text-[11px] font-bold ${v.chip}`}>
              {v.label}
            </span>
            <span className="text-[12px] leading-snug text-fg/90">
              3년 생존율 <b className={v.text}>{(result.survival.probability * 100).toFixed(0)}%</b> 추정. {v.sentence}
            </span>
          </div>
        )}

        {/* 메타 라인 */}
        <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] text-faint">
          <span>기준 {result.meta.dataAsOf}</span>
          <span>
            신뢰도{" "}
            <b className={result.meta.confidence === "high" ? "text-safe" : result.meta.confidence === "medium" ? "text-caution" : "text-risk"}>
              {CONFIDENCE_LABEL[result.meta.confidence]}
            </b>
          </span>
          <span>표본 {result.meta.sampleSize}건</span>
          <span>· {SOURCE_LABEL[result.sourceMode]}</span>
        </div>
      </header>

      {/* ── KPI 요약 행 ─────────────────────────────────── */}
      <div className="rise-in grid grid-cols-2 gap-2" style={{ animationDelay: "0.04s" }}>
        {result.survival && (
          <StatTile
            label="3년 생존율"
            value={`${(result.survival.probability * 100).toFixed(0)}%`}
            tone={v ? v.text : "text-fg"}
            hint="실측 폐업률 환산"
          />
        )}
        {result.revenue && (
          <StatTile label="예상 월매출" value={formatKRW(result.revenue.monthlyEstimateKRW)} hint="상권×업종 합산" />
        )}
        {pct != null && (
          <StatTile label="동일업종 내" value={`상위 ${(100 - pct).toFixed(0)}%`} tone="text-gold" hint="예상매출 백분위" />
        )}
        {result.context?.footTraffic && (
          <StatTile
            label="분기 유동인구"
            value={formatPeople(result.context.footTraffic.total)}
            hint="상권 단위"
          />
        )}
      </div>

      {/* ── ① 생존 전망 ─────────────────────────────────── */}
      {result.survival && (
        <Section n={1} title="생존 전망 — 판단 기준">
          <div className="flex justify-center">
            <SurvivalGauge
              probability={result.survival.probability}
              grade={result.survival.grade}
              horizonYears={result.survival.horizonYears}
            />
          </div>
          <p className="mt-2 text-center text-[11px] leading-relaxed text-faint">
            {result.survival.basis === "empirical_closure_rate"
              ? "예측치가 아닌 실측 폐업률 통계의 3년 환산값입니다."
              : "모델 산출값입니다."}
            {result.survival.granularity === "seoul_industry" &&
              " 업종 단위 통계로, 상권별 차이는 아직 반영되지 않았습니다."}
          </p>
        </Section>
      )}

      {/* ── ② 예상 매출 ─────────────────────────────────── */}
      {result.revenue && (
        <Section n={2} title="예상 매출 — 참고 지표">
          <div className="flex items-end justify-between gap-3">
            <div>
              <div className="text-[30px] font-semibold leading-none text-fg" style={{ fontFamily: "var(--font-numeric)" }}>
                {formatKRW(result.revenue.monthlyEstimateKRW)}
              </div>
              <div className="mt-1 text-[11px] text-muted">
                월 기준(분기 평균) · {result.revenue.scaleNote}
              </div>
            </div>
            {pct != null && (
              <div className="shrink-0 text-right">
                <div className="text-lg font-semibold text-gold" style={{ fontFamily: "var(--font-numeric)" }}>
                  상위 {(100 - pct).toFixed(0)}%
                </div>
                <div className="text-[10px] text-faint">동일 업종 상권 중</div>
              </div>
            )}
          </div>
          {pct != null && (
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-ink-600/70">
              <div className="h-full rounded-full bg-gradient-to-r from-gold/60 to-gold" style={{ width: `${pct}%` }} />
            </div>
          )}
          <p className="mt-3 border-l-2 border-caution/50 pl-2 text-[11px] leading-relaxed text-muted">
            {result.revenue.disclaimer}
          </p>
        </Section>
      )}

      {/* ── ③ 상권 지표 ─────────────────────────────────── */}
      {result.context && (
        <Section n={3} title="상권 지표">
          <div className="mb-3 grid grid-cols-2 gap-3">
            {result.context.footTraffic && (
              <div className="rounded-lg bg-ink-700/50 px-3 py-2.5">
                <div className="text-[10px] text-faint">분기 유동인구 (상권)</div>
                <div className="mt-0.5 text-base font-semibold text-fg" style={{ fontFamily: "var(--font-numeric)" }}>
                  {formatPeople(result.context.footTraffic.total)}
                </div>
              </div>
            )}
            {result.context.competition?.storeCount != null && (
              <div className="rounded-lg bg-ink-700/50 px-3 py-2.5">
                <div className="text-[10px] text-faint">
                  동일 업종 점포
                  {result.context.competition.granularity === "seoul_industry" && " (서울 전체)"}
                </div>
                <div className="mt-0.5 text-base font-semibold text-fg" style={{ fontFamily: "var(--font-numeric)" }}>
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
        </Section>
      )}

      {/* ── ④ 종합 해석 ─────────────────────────────────── */}
      {result.narrative && (
        <Section n={4} title="종합 해석" aside={result.narrative.generator === "rule_based" ? "규칙 기반" : result.narrative.generator}>
          <p className="font-[family-name:var(--font-display)] text-[15px] leading-[1.75] text-fg/95">
            {result.narrative.summary}
          </p>
        </Section>
      )}

      {/* ── ⑤ 유의사항 · 한계 ───────────────────────────── */}
      <Section n={5} title="유의사항 · 한계">
        <ul className="space-y-1.5 text-[11px] leading-relaxed text-muted">
          {result.survival?.granularity === "seoul_industry" && (
            <li className="flex gap-1.5">
              <span className="text-faint">·</span>
              생존율은 예측이 아니라 <b className="text-fg/80">실측 폐업률의 3년 환산치</b>이며, 업종 단위 통계입니다(상권별 차이 미반영).
            </li>
          )}
          {result.revenue && (
            <li className="flex gap-1.5">
              <span className="text-faint">·</span>
              예상 매출은 <b className="text-fg/80">상권×업종 전체 점포의 합산 규모</b>로, 개별 점포 매출이 아닙니다.
            </li>
          )}
          <li className="flex gap-1.5">
            <span className="text-faint">·</span>
            모든 수치는 공공데이터 기반 참고 지표이며, 투자·창업 결정의 근거가 아닌 탐색 도구입니다.
          </li>
        </ul>
      </Section>

      {/* ── ⑥ 데이터 출처 ───────────────────────────────── */}
      {result.meta.sources.length > 0 && (
        <Section n={6} title="데이터 출처">
          <ul className="space-y-0.5">
            {result.meta.sources.map((s) => (
              <li key={s} className="text-[10.5px] leading-relaxed text-faint">
                · {s}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* 재탐색 (UC-003) */}
      <RetryRow onChangeIndustry={onChangeIndustry} onChangeLocation={onChangeLocation} />
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

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
import type { AnalyzeResult, Grade, RatioSlice } from "@/lib/contracts";
import { formatKRW, formatKRWCompact, formatPeople, pctChange } from "@/lib/format";
import { incomeDecileRange, mockHinterland } from "@/lib/mockExtras";
import SurvivalGauge from "./SurvivalGauge";
import DemographicsChart from "./DemographicsChart";
import {
  CompareBars,
  DeltaBadge,
  GenderSplit,
  SliceBarChart,
  TrendChart,
} from "./DetailCharts";

// ------------------------------------------------------------------
// 포맷터 / 상수
// ------------------------------------------------------------------
/** 비중 배열에서 최댓값 슬라이스 (한 줄 요약용) */
function topOf(arr?: RatioSlice[] | null): RatioSlice | null {
  if (!arr || !arr.length) return null;
  return arr.reduce((a, b) => (b.ratio > a.ratio ? b : a));
}

/** 유동인구 축약 (차트 라벨용) */
const formatPeopleCompact = (v: number) =>
  v >= 1e4 ? `${Math.round(v / 1e4)}만` : Math.round(v).toLocaleString();

/** 연령 밴드 한글 라벨 (한 줄 요약용 — 차트 내부 라벨은 DetailCharts가 처리) */
const AGE_KO: Record<string, string> = {
  "10s": "10대", "20s": "20대", "30s": "30대", "40s": "40대", "50s": "50대", "60s+": "60대 이상",
};

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

/** 상권 내 업종 기회 순위 — 지역 랭킹(TopIndustries) 데이터에서 파생 (golmok '나의 등수' 패턴) */
export type RankingContext = {
  rank: number;
  total: number;
  opportunityScore: number;
};

// ------------------------------------------------------------------
// 상태 화면들
// ------------------------------------------------------------------
/** 질문형 온보딩 — 기능 나열 대신 사용자 상황으로 분기 (golmok '창업하려는 업종이 있으세요?' 패턴) */
export function OnboardingCard({
  onPickLocation,
  onPickIndustry,
}: {
  onPickLocation: () => void;
  onPickIndustry: () => void;
}) {
  return (
    <div className="rise-in rounded-xl border border-line/60 bg-ink-800/40 px-6 py-7">
      <div className="text-[10px] uppercase tracking-[0.16em] text-faint">시작하기</div>
      <h2 className="mt-1 font-[family-name:var(--font-display)] text-[19px] leading-snug text-fg">
        창업하려는 <span className="text-gold">업종</span>이 정해져 있나요?
      </h2>
      <div className="mt-4 space-y-2">
        <button
          onClick={onPickLocation}
          className="group w-full rounded-xl border border-line/70 bg-ink-700/40 px-4 py-3.5 text-left transition hover:border-gold/60 hover:bg-ink-700/70"
        >
          <div className="text-[14px] font-semibold text-fg transition group-hover:text-gold-soft">
            아직이요 — 자리부터 볼래요
          </div>
          <div className="mt-0.5 text-[11px] leading-relaxed text-muted">
            지도를 클릭하면 그 자리의 <b className="text-fg/80">유망 업종 순위</b>부터 보여드립니다
          </div>
        </button>
        <button
          onClick={onPickIndustry}
          className="group w-full rounded-xl border border-line/70 bg-ink-700/40 px-4 py-3.5 text-left transition hover:border-gold/60 hover:bg-ink-700/70"
        >
          <div className="text-[14px] font-semibold text-fg transition group-hover:text-gold-soft">
            네 — 업종이 있어요
          </div>
          <div className="mt-0.5 text-[11px] leading-relaxed text-muted">
            업종을 고르면 <b className="text-fg/80">서울 전체 상권 적합도</b>를 히트맵으로 보여드립니다
          </div>
        </button>
      </div>
      <p className="mt-4 text-[10px] leading-relaxed text-faint">
        어느 쪽이든 같은 분석 리포트로 이어집니다. 상단 토글로 언제든 바꿀 수 있어요.
      </p>
    </div>
  );
}

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

/** 상세 섹션 내부 소제목 블록 */
function SubBlock({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-3">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <div className="text-[10px] font-medium text-faint">{title}</div>
        {aside && <div className="text-[9.5px] text-faint/80">{aside}</div>}
      </div>
      {children}
    </div>
  );
}

/** 종합 의견 불릿 한 줄 — [지표 태그] + 값·판단 문장 (golmok 종합의견 패턴) */
function Bullet({ tag, children }: { tag: string; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <span className="mt-[3px] shrink-0 rounded border border-line/70 bg-ink-700/60 px-1.5 py-0.5 text-[9px] font-medium text-muted">
        {tag}
      </span>
      <span className="text-[12px] leading-relaxed text-fg/90">{children}</span>
    </li>
  );
}

// ------------------------------------------------------------------
// 메인 리포트
// ------------------------------------------------------------------
export default function ResultPanel({
  result,
  rankingContext,
  onChangeIndustry,
  onChangeLocation,
}: {
  result: AnalyzeResult;
  /** 상권 내 업종 기회 순위 (지역 랭킹 데이터 보유 시) */
  rankingContext?: RankingContext | null;
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
  // 유동인구 핵심 연령대 (종합 의견용) — ratio 스케일(0~1 / 0~100) 양쪽 허용
  const topAge = result.context?.demographics?.length
    ? [...result.context.demographics].sort((a, b) => b.ratio - a.ratio)[0]
    : null;
  const topAgePct = topAge ? (topAge.ratio <= 1 ? topAge.ratio * 100 : topAge.ratio) : 0;

  // 상세 분석(실측 원천값) — 목업 폴백에는 없음 (섹션 자동 생략)
  const detail = result.detail ?? null;
  // 배후지 '예시 데이터' — 상권 코드 기반 결정적 생성 (⑥ 섹션에 배지로 명시)
  const hinterland = mockHinterland(result.sangwon.code);

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
        {rankingContext && (
          <StatTile
            label="상권 내 기회 순위"
            value={`${rankingContext.rank}위`}
            unit={`/ ${rankingContext.total}개 업종`}
            tone="text-gold"
            hint="창업기회점수 기준"
          />
        )}
        {result.context?.footTraffic && (
          <StatTile
            label="분기 유동인구"
            value={formatPeople(result.context.footTraffic.total)}
            hint="상권 단위"
          />
        )}
      </div>

      {/* ── ① 종합 의견 — 지표별 값·판단 불릿 (golmok 패턴) ── */}
      <Section n={1} title="종합 의견" aside="규칙 기반 요약">
        <ul className="space-y-2">
          {result.survival && v && (
            <Bullet tag="생존">
              3년 생존율 <b className={v.text}>{(result.survival.probability * 100).toFixed(0)}%</b>{" "}
              <b className={v.text}>({v.label})</b> — {v.sentence}{" "}
              <span className="text-muted">실측 폐업률 환산·업종 단위 통계입니다.</span>
            </Bullet>
          )}
          {result.revenue && (
            <Bullet tag="매출">
              예상 월매출 <b className="text-fg">{formatKRW(result.revenue.monthlyEstimateKRW)}</b>
              {pct != null && (
                <>
                  {" "}— 동일 업종 상권 중 <b className="text-gold">상위 {(100 - pct).toFixed(0)}%</b>
                </>
              )}
              <span className="text-muted"> (상권×업종 합산 규모).</span>
              {(() => {
                const chg = pctChange(detail?.sales?.monthlyTotalKRW ?? null, detail?.sales?.prev ?? null);
                if (chg == null || Math.abs(chg) < 0.05) return null;
                return (
                  <>
                    {" "}실측 기준 전분기 대비{" "}
                    <b className={chg > 0 ? "text-safe" : "text-risk"}>
                      {chg > 0 ? "▲" : "▼"} {Math.abs(chg).toFixed(1)}%
                    </b>
                    .
                  </>
                );
              })()}
            </Bullet>
          )}
          {rankingContext && (
            <Bullet tag="기회">
              이 상권의 {rankingContext.total}개 업종 중 창업기회점수{" "}
              <b className="text-gold">{rankingContext.rank}위</b>
              <span className="text-muted">
                {" "}(점수 {rankingContext.opportunityScore.toFixed(0)} — 상권 내 상대 지표).
              </span>
            </Bullet>
          )}
          {result.context?.competition?.storeCount != null && (
            <Bullet tag="경쟁">
              동일 업종 점포 <b className="text-fg">{result.context.competition.storeCount.toLocaleString()}개</b>
              {result.context.competition.franchiseRatio != null && (
                <> · 프랜차이즈 {(result.context.competition.franchiseRatio * 100).toFixed(0)}%</>
              )}
              {result.context.competition.granularity === "seoul_industry" ? (
                <span className="text-muted"> (서울 전체 기준) — 경쟁 밀도를 함께 살펴보세요.</span>
              ) : (
                <span className="text-muted"> — 경쟁 밀도를 함께 살펴보세요.</span>
              )}
            </Bullet>
          )}
          {result.context?.footTraffic && (
            <Bullet tag="인구">
              분기 유동인구 <b className="text-fg">{formatPeople(result.context.footTraffic.total)}</b>
              {topAge && (
                <>
                  {" "}— 핵심 연령대 <b className="text-fg">{topAge.ageBand}</b>
                  <span className="text-muted"> ({topAgePct.toFixed(0)}%)</span>
                </>
              )}
              .
            </Bullet>
          )}
        </ul>
        {result.narrative && (
          <p className="mt-3 border-l-2 border-gold/40 pl-2.5 font-[family-name:var(--font-display)] text-[13.5px] leading-[1.7] text-fg/90">
            {result.narrative.summary}
            <span className="ml-1.5 text-[9px] text-faint">
              — {result.narrative.generator === "rule_based" ? "규칙 기반 생성" : result.narrative.generator}
            </span>
          </p>
        )}
      </Section>

      {/* ── ② 생존 전망 ─────────────────────────────────── */}
      {result.survival && (
        <Section n={2} title="생존 전망 — 판단 기준">
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

      {/* ── ③ 매출 분석 — 모델 예측 + 실측 집계 ──────────── */}
      {result.revenue && (
        <Section n={3} title="매출 분석">
          {/* (a) 모델 예측 */}
          <div className="mb-1.5 flex items-center gap-1.5 text-[10px] text-faint">
            <span className="rounded border border-gold/40 bg-gold/10 px-1.5 py-px font-medium text-gold-soft">
              모델 예측
            </span>
            학습된 회귀 모델({result.meta.dataAsOf} 입력)의 추정치
          </div>
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

          {/* (b) 실측 집계 (카드 추정 원천값) */}
          {detail?.sales && (
            <div className="mt-4 border-t border-line/40 pt-3">
              <div className="mb-2 flex items-center gap-1.5 text-[10px] text-faint">
                <span className="rounded border border-line bg-ink-700/60 px-1.5 py-px font-medium text-muted">
                  실측 집계
                </span>
                카드 결제 기반 추정 원천값 · {result.meta.dataAsOf}
              </div>
              {detail.sales.monthlyTotalKRW != null && (
                <div className="flex items-end justify-between gap-3">
                  <div>
                    <div className="text-[10px] text-faint">분기 월평균 매출 (상권×업종 합산)</div>
                    <div className="mt-0.5 text-xl font-semibold text-fg" style={{ fontFamily: "var(--font-numeric)" }}>
                      {formatKRW(detail.sales.monthlyTotalKRW)}
                    </div>
                  </div>
                  {detail.sales.perStoreKRW != null && (
                    <div className="shrink-0 text-right">
                      <div className="text-[10px] text-faint">점포당</div>
                      <div className="text-sm font-semibold text-fg/90" style={{ fontFamily: "var(--font-numeric)" }}>
                        {formatKRW(detail.sales.perStoreKRW)}
                      </div>
                    </div>
                  )}
                </div>
              )}
              <div className="mt-2 flex flex-wrap gap-1.5">
                <DeltaBadge current={detail.sales.monthlyTotalKRW} base={detail.sales.prev} label="전분기" />
                <DeltaBadge current={detail.sales.monthlyTotalKRW} base={detail.sales.yoy} label="전년 동분기" />
              </div>

              {detail.sales.trend.length > 1 && (
                <SubBlock title="분기 매출 추이" aside="실측 카드 추정 · 단위: 원">
                  <TrendChart data={detail.sales.trend} format={formatKRWCompact} />
                </SubBlock>
              )}
              {detail.sales.byDay && (
                <SubBlock
                  title="요일별 매출"
                  aside={topOf(detail.sales.byDay) && (
                    <><b className="text-gold-soft">{topOf(detail.sales.byDay)!.label}요일</b> {(topOf(detail.sales.byDay)!.ratio * 100).toFixed(1)}% 최고</>
                  )}
                >
                  <SliceBarChart data={detail.sales.byDay} />
                </SubBlock>
              )}
              {detail.sales.byTime && (
                <SubBlock
                  title="시간대별 매출"
                  aside={topOf(detail.sales.byTime) && (
                    <><b className="text-gold-soft">{topOf(detail.sales.byTime)!.label}시</b> {(topOf(detail.sales.byTime)!.ratio * 100).toFixed(1)}% 최고</>
                  )}
                >
                  <SliceBarChart data={detail.sales.byTime} />
                </SubBlock>
              )}
              {detail.sales.byGender && (
                <SubBlock title="성별 매출">
                  <GenderSplit data={detail.sales.byGender} />
                </SubBlock>
              )}
              {detail.sales.byAge && (
                <SubBlock
                  title="연령대별 매출"
                  aside={topOf(detail.sales.byAge) && (
                    <><b className="text-gold-soft">{AGE_KO[topOf(detail.sales.byAge)!.label] ?? topOf(detail.sales.byAge)!.label}</b> 소비 최다</>
                  )}
                >
                  <SliceBarChart data={detail.sales.byAge} />
                </SubBlock>
              )}
            </div>
          )}
        </Section>
      )}

      {/* ── ④ 업종·경쟁 분석 ────────────────────────────── */}
      {(result.context?.competition || detail?.store || detail?.comparison) && (
        <Section n={4} title="업종·경쟁 분석">
          <div className="grid grid-cols-2 gap-2">
            {result.context?.competition?.storeCount != null && (
              <div className="rounded-lg bg-ink-700/50 px-3 py-2.5">
                <div className="text-[10px] text-faint">동일 업종 점포</div>
                <div className="mt-0.5 text-base font-semibold text-fg" style={{ fontFamily: "var(--font-numeric)" }}>
                  {result.context.competition.storeCount.toLocaleString()}
                  <span className="text-xs text-muted">개</span>
                </div>
                {detail?.store?.franchiseCount != null && (
                  <div className="mt-0.5 text-[10px] text-muted">
                    프랜차이즈 {detail.store.franchiseCount.toLocaleString()} · 일반{" "}
                    {detail.store.generalCount?.toLocaleString() ?? "―"}
                  </div>
                )}
              </div>
            )}
            {detail?.store && (detail.store.openCount != null || detail.store.closeCount != null) && (
              <div className="rounded-lg bg-ink-700/50 px-3 py-2.5">
                <div className="text-[10px] text-faint">이번 분기 개·폐업</div>
                <div className="mt-0.5 text-base font-semibold" style={{ fontFamily: "var(--font-numeric)" }}>
                  <span className="text-safe">+{detail.store.openCount ?? 0}</span>
                  <span className="mx-1 text-faint">/</span>
                  <span className="text-risk">-{detail.store.closeCount ?? 0}</span>
                </div>
                <div className="mt-0.5 text-[10px] text-muted">
                  개업률 {detail.store.openRate != null ? `${detail.store.openRate.toFixed(1)}%` : "―"} · 폐업률{" "}
                  {detail.store.closeRate != null ? `${detail.store.closeRate.toFixed(1)}%` : "―"}
                </div>
              </div>
            )}
          </div>

          {detail?.store && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              <DeltaBadge
                current={detail.store.trend.length ? detail.store.trend[detail.store.trend.length - 1].value : null}
                base={detail.store.prev}
                label="점포수 전분기"
              />
              <DeltaBadge
                current={detail.store.trend.length ? detail.store.trend[detail.store.trend.length - 1].value : null}
                base={detail.store.yoy}
                label="전년 동분기"
              />
            </div>
          )}

          {detail?.store && detail.store.trend.length > 1 && (
            <SubBlock title="점포수 추이" aside="단위: 개">
              <TrendChart data={detail.store.trend} format={(v) => `${Math.round(v).toLocaleString()}개`} />
            </SubBlock>
          )}

          {detail?.comparison && (
            <>
              <SubBlock title="동일 업종 점포수 비교">
                <CompareBars
                  rows={[
                    { label: "이 상권", value: detail.comparison.storeCount.sangwon, highlight: true },
                    { label: detail.comparison.guName ?? "자치구", value: detail.comparison.storeCount.gu },
                    { label: "서울 전체", value: detail.comparison.storeCount.seoul },
                  ]}
                  format={(v) => `${Math.round(v).toLocaleString()}개`}
                />
              </SubBlock>
              <SubBlock title="점포당 월평균 매출 비교" aside="실측 집계 기준">
                <CompareBars
                  rows={[
                    { label: "이 상권", value: detail.comparison.perStoreSalesKRW.sangwon, highlight: true },
                    { label: detail.comparison.guName ?? "자치구", value: detail.comparison.perStoreSalesKRW.gu },
                    { label: "서울 전체", value: detail.comparison.perStoreSalesKRW.seoul },
                  ]}
                />
              </SubBlock>
              <p className="mt-2 text-[9.5px] leading-relaxed text-faint">{detail.comparison.note}</p>
            </>
          )}
        </Section>
      )}

      {/* ── ⑤ 인구 분석 ─────────────────────────────────── */}
      {(result.context?.footTraffic || detail?.footTraffic) && (
        <Section n={5} title="인구 분석" aside="유동인구 — 상권 단위(업종 무관)">
          {result.context?.footTraffic && (
            <div className="flex items-end justify-between gap-3">
              <div>
                <div className="text-[10px] text-faint">분기 유동인구</div>
                <div className="mt-0.5 text-xl font-semibold text-fg" style={{ fontFamily: "var(--font-numeric)" }}>
                  {formatPeople(result.context.footTraffic.total)}
                </div>
              </div>
              {detail?.footTraffic && (
                <div className="flex flex-wrap justify-end gap-1.5">
                  <DeltaBadge
                    current={result.context.footTraffic.total}
                    base={detail.footTraffic.prev}
                    label="전분기"
                  />
                  <DeltaBadge
                    current={result.context.footTraffic.total}
                    base={detail.footTraffic.yoy}
                    label="전년 동분기"
                  />
                </div>
              )}
            </div>
          )}

          {detail?.footTraffic && detail.footTraffic.trend.length > 1 && (
            <SubBlock title="유동인구 추이" aside={`최근 ${detail.footTraffic.trend.length}개 분기 · 단위: 명`}>
              <TrendChart data={detail.footTraffic.trend} format={formatPeopleCompact} />
            </SubBlock>
          )}
          {detail?.footTraffic?.byDay && (
            <SubBlock
              title="요일별 유동인구"
              aside={topOf(detail.footTraffic.byDay) && (
                <><b className="text-gold-soft">{topOf(detail.footTraffic.byDay)!.label}요일</b> {(topOf(detail.footTraffic.byDay)!.ratio * 100).toFixed(1)}% 최고</>
              )}
            >
              <SliceBarChart data={detail.footTraffic.byDay} />
            </SubBlock>
          )}
          {detail?.footTraffic?.byTime && (
            <SubBlock
              title="시간대별 유동인구"
              aside={topOf(detail.footTraffic.byTime) && (
                <><b className="text-gold-soft">{topOf(detail.footTraffic.byTime)!.label}시</b> {(topOf(detail.footTraffic.byTime)!.ratio * 100).toFixed(1)}% 최고</>
              )}
            >
              <SliceBarChart data={detail.footTraffic.byTime} />
            </SubBlock>
          )}
          {detail?.footTraffic?.byGender && (
            <SubBlock title="성별 유동인구">
              <GenderSplit data={detail.footTraffic.byGender} />
            </SubBlock>
          )}
          {result.context && result.context.demographics.length > 0 && (
            <SubBlock title="연령대 구성">
              <DemographicsChart data={result.context.demographics} />
            </SubBlock>
          )}
        </Section>
      )}

      {/* ── ⑥ 배후지 분석 — 예시 데이터 (실데이터 미보유) ── */}
      <Section n={6} title="배후지 분석" aside="주거·직장·소득·임대">
        <div className="mb-3 rounded-md border border-caution/40 bg-caution/10 px-2.5 py-2 text-[10px] leading-relaxed text-caution">
          ⚠ 예시 데이터 — 아래 수치는 실데이터 미보유 항목의 UI 시연용으로, 상권 코드 기반으로
          생성한 가상 값입니다. 실제 상권 특성과 무관하며, 실서비스에서는 상주인구·직장인구·
          소득소비·임대시세 공공 데이터셋을 연동합니다.
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg bg-ink-700/50 px-3 py-2.5">
            <div className="text-[10px] text-faint">주거인구</div>
            <div className="mt-0.5 text-base font-semibold text-fg" style={{ fontFamily: "var(--font-numeric)" }}>
              {formatPeople(hinterland.residents)}
            </div>
            <div className="mt-0.5 text-[10px] text-muted">{hinterland.households.toLocaleString()}가구</div>
          </div>
          <div className="rounded-lg bg-ink-700/50 px-3 py-2.5">
            <div className="text-[10px] text-faint">직장인구</div>
            <div className="mt-0.5 text-base font-semibold text-fg" style={{ fontFamily: "var(--font-numeric)" }}>
              {formatPeople(hinterland.workers)}
            </div>
            <div className="mt-0.5 text-[10px] text-muted">아파트 비율 {(hinterland.aptRatio * 100).toFixed(0)}%</div>
          </div>
          <div className="rounded-lg bg-ink-700/50 px-3 py-2.5">
            <div className="text-[10px] text-faint">주거인구 소득수준</div>
            <div className="mt-0.5 text-base font-semibold text-fg" style={{ fontFamily: "var(--font-numeric)" }}>
              {hinterland.incomeDecile}분위
            </div>
            <div className="mt-0.5 text-[10px] text-muted">{incomeDecileRange(hinterland.incomeDecile)}</div>
          </div>
          <div className="rounded-lg bg-ink-700/50 px-3 py-2.5">
            <div className="text-[10px] text-faint">1층 환산 임대시세</div>
            <div className="mt-0.5 text-base font-semibold text-fg" style={{ fontFamily: "var(--font-numeric)" }}>
              {formatKRW(hinterland.rentPer33m2)}
            </div>
            <div className="mt-0.5 text-[10px] text-muted">3.3㎡당 월 환산</div>
          </div>
        </div>
        <SubBlock title="소비 트렌드" aside="카테고리 비중">
          <SliceBarChart data={hinterland.consumption} />
        </SubBlock>
        <SubBlock title="주요 집객시설">
          <div className="flex flex-wrap gap-1.5">
            {hinterland.facilities.map((f) => (
              <span
                key={f.label}
                className="rounded-full border border-line/60 bg-ink-700/50 px-2 py-1 text-[10.5px] text-muted"
              >
                {f.label} <b className="text-fg/90" style={{ fontFamily: "var(--font-numeric)" }}>{f.count}</b>
              </span>
            ))}
          </div>
        </SubBlock>
      </Section>

      {/* ── ⑦ 유의사항 · 한계 ───────────────────────────── */}
      <Section n={7} title="유의사항 · 한계">
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
          {detail && (
            <li className="flex gap-1.5">
              <span className="text-faint">·</span>
              <b className="text-fg/80">&lsquo;모델 예측&rsquo;과 &lsquo;실측 집계&rsquo;는 산출 방식이 달라</b> 값이 다를 수 있습니다 — 각 블록에 기준을 표기했습니다. 상세 분포·추이는 클리핑 전 원천값 기준입니다.
            </li>
          )}
          <li className="flex gap-1.5">
            <span className="text-faint">·</span>
            <b className="text-caution/90">배후지 분석(⑥)은 예시 데이터</b>로, 실제 상권 특성과 무관합니다 (실데이터셋 연동 전 UI 시연용).
          </li>
          <li className="flex gap-1.5">
            <span className="text-faint">·</span>
            모든 수치는 공공데이터 기반 참고 지표이며, 투자·창업 결정의 근거가 아닌 탐색 도구입니다.
          </li>
        </ul>
      </Section>

      {/* ── ⑧ 데이터 출처 ───────────────────────────────── */}
      {result.meta.sources.length > 0 && (
        <Section n={8} title="데이터 출처">
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

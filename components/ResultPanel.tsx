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
import type {
  AnalyzeResult,
  Grade,
  HinterlandResult,
  RatioSlice,
  SafetyDetail,
} from "@/lib/contracts";
import { useEffect, useState } from "react";
import { competitionAdvice, footTrafficAdvice, revenueAdvice } from "@/lib/advice";
import { formatKRW, formatKRWCompact, formatPeople, pctChange } from "@/lib/format";
import { mockSafety } from "@/lib/mockExtras";
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

/** 백분위 → "상위 N%" — 백분위 100(1위권)이 "상위 0%"로 찍히지 않게 하한 1% */
const topPctLabel = (pct: number) => `상위 ${Math.max(1, Math.round(100 - pct))}%`;

/**
 * 생존율 집계 단위 라벨 — survival.granularity 로만 판단한다 (문구 하드코딩 금지).
 * 라이브(Commercial-AI-)는 상권×업종 폐업률이라 "상권×업종",
 * 정적 폴백(구 모델)은 업종 단위 서울 전체 통계라 "업종".
 */
function survivalScopeLabel(granularity: string): string {
  return granularity === "seoul_industry" ? "업종 단위" : "상권×업종 단위";
}

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
/** 시장 단계별 강조 톤 (v2 신규 — diagnosis.py market_stage 규칙의 5단계) */
const MARKET_STAGE_TONE: Record<string, string> = {
  성장기: "text-safe",
  안정기: "text-fg",
  경쟁심화기: "text-caution",
  재편기: "text-caution",
  쇠퇴기: "text-risk",
};

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

/**
 * 이중 종합점수 — '치안 반영' 토글의 리포트 버전 (page 가 계산해 내려준다).
 * base = 매출60%+생존40% 백분위, adjusted = base×95% + 자치구 안전점수×5%.
 * 순위는 동일 업종 상권 간 비교.
 */
export type ScoreComparison = {
  base: number;
  adjusted: number;
  baseRank: number;
  adjustedRank: number;
  total: number;
  safetyScore: number | null;
  guName: string | null;
  isMock: boolean;
  weightsNote: string;
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
/**
 * 서버가 상류 값을 보정했음을 알리는 배지.
 * competition.correction 이 있을 때만 렌더 — 표시 수치가 모델 서버 원본과 다르다는
 * 사실을 숨기지 않기 위한 장치다 (목업 배지와 같은 정직성 원칙).
 */
function CorrectedBadge() {
  return (
    <span
      className="ml-1 inline-block rounded border border-gold/40 bg-gold/10 px-1 py-px align-middle text-[9px] text-gold-soft"
      title="모델 서버 원본값을 보정해 표시했습니다 — ④ 업종·경쟁 분석에서 근거 확인"
    >
      보정됨
    </span>
  );
}

function MockBadge() {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-caution/40 bg-caution/10 px-2 py-0.5 text-[10px] font-medium text-caution">
      ● 목업 — 모델 미연결
    </span>
  );
}

/**
 * 섹션 점프 내비 — golmok 벤치마크(§3)의 리포트 탭과 같은 역할.
 * 그쪽도 뷰를 나누는 게 아니라 한 개의 긴 스크롤 안에서 위치를 옮긴다(`tabmove()` 실측 확인).
 * 리포트가 7~8화면이라 위치 감각을 주는 것이 목적 — 정보를 숨기지 않는다.
 */
const SECTION_NAV: { n: number; label: string }[] = [
  { n: 1, label: "종합" },
  { n: 2, label: "생존" },
  { n: 3, label: "매출" },
  { n: 4, label: "경쟁" },
  { n: 5, label: "인구" },
  { n: 6, label: "치안" },
  { n: 7, label: "배후지" },
  { n: 8, label: "유의사항" },
];

function SectionNav() {
  const [active, setActive] = useState(1);
  useEffect(() => {
    const els = SECTION_NAV.map((s) => document.getElementById(`report-sec-${s.n}`)).filter(
      (e): e is HTMLElement => !!e
    );
    if (!els.length) return;
    const io = new IntersectionObserver(
      (entries) => {
        const top = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (top) setActive(Number(top.target.id.replace("report-sec-", "")));
      },
      { rootMargin: "-8% 0px -70% 0px", threshold: 0 }
    );
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, []);

  return (
    <nav
      aria-label="리포트 섹션 이동"
      className="sticky top-0 z-10 -mx-1 flex gap-1 overflow-x-auto rounded-lg border border-line/50 bg-ink-800/90 px-1.5 py-1.5 backdrop-blur"
    >
      {SECTION_NAV.map((s) => (
        <button
          key={s.n}
          onClick={() =>
            document.getElementById(`report-sec-${s.n}`)?.scrollIntoView({ behavior: "smooth", block: "start" })
          }
          aria-current={active === s.n ? "true" : undefined}
          className={`shrink-0 rounded px-2 py-1 text-[10.5px] transition ${
            active === s.n
              ? "bg-gold/15 font-medium text-gold-soft"
              : "text-muted hover:bg-ink-700/60 hover:text-fg"
          }`}
        >
          {s.label}
        </button>
      ))}
    </nav>
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
    <section
      id={`report-sec-${n}`}
      className={`rise-in scroll-mt-3 rounded-xl border border-line/60 bg-ink-800/40 px-5 py-4 ${className}`}
    >
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
  scoreComparison,
  safetyFromScores,
  hinterland,
  extraSources,
  inCompare,
  compareCount,
  onToggleCompare,
  onChangeIndustry,
  onChangeLocation,
}: {
  result: AnalyzeResult;
  /** 상권 내 업종 기회 순위 (지역 랭킹 데이터 보유 시) */
  rankingContext?: RankingContext | null;
  /** 치안 미반영/반영 이중 종합점수 (동일 업종 상권 간 — 히트맵 데이터 보유 시) */
  scoreComparison?: ScoreComparison | null;
  /** /api/safety 실데이터에서 파생한 치안 통계 (목업이면 null — 예시 경로로 폴백) */
  safetyFromScores?: SafetyDetail | null;
  /** /api/hinterland 배후지 실측 (⑦ 섹션). 없으면 '데이터 없음' 안내 */
  hinterland?: HinterlandResult | null;
  /** 모델 응답 밖에서 실제로 사용한 추가 출처 (치안 실데이터 등) */
  extraSources?: string[];
  /** 비교 바스켓에 이미 담겨 있는가 (golmok '비교담기' 패턴) */
  inCompare?: boolean;
  compareCount?: number;
  onToggleCompare?: () => void;
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
              {/* v2 신규 — 상권 유형 5종 (규칙 기반 분류, 계보 '헤더 상권 유형' 행) */}
              {sangwon.type && (
                <span
                  title={sangwon.typeBasis ?? undefined}
                  className="ml-1.5 inline-flex items-center rounded border border-line/70 bg-ink-700/60 px-1.5 py-px align-middle text-[10px] text-muted"
                >
                  {sangwon.type} 상권
                </span>
              )}
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

      {/* ── 비교 담기 (golmok '비교담기' 패턴) ── */}
      {onToggleCompare && (
        <button
          onClick={onToggleCompare}
          aria-pressed={inCompare}
          className={`rise-in w-full rounded-lg border px-3 py-2 text-[11.5px] transition ${
            inCompare
              ? "border-gold/50 bg-gold/10 text-gold-soft"
              : "border-line bg-ink-700/50 text-muted hover:border-gold/40 hover:text-fg"
          }`}
        >
          {inCompare ? "✓ 비교 목록에 담김 — 빼기" : "이 상권을 비교에 담기"}
          {compareCount != null && compareCount > 0 && (
            <span className="ml-1.5 text-[10px] text-faint">({compareCount}/3)</span>
          )}
        </button>
      )}

      {/* ── 섹션 점프 내비 (golmok 리포트 탭과 같은 역할 — SectionNav 주석 참조) ── */}
      <SectionNav />

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
          <StatTile
            label="예상 월매출"
            value={formatKRW(result.revenue.monthlyEstimateKRW)}
            hint={result.revenue.scaleLabel}
          />
        )}
        {pct != null && (
          <StatTile label="동일업종 내" value={topPctLabel(pct)} tone="text-gold" hint="예상매출 백분위" />
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
              <span className="text-muted">
                실측 폐업률 환산·{survivalScopeLabel(result.survival.granularity)} 통계입니다.
              </span>
            </Bullet>
          )}
          {result.revenue && (
            <Bullet tag="매출">
              예상 월매출 <b className="text-fg">{formatKRW(result.revenue.monthlyEstimateKRW)}</b>
              {pct != null && (
                <>
                  {" "}— 동일 업종 상권 중 <b className="text-gold">{topPctLabel(pct)}</b>
                </>
              )}
              <span className="text-muted"> ({result.revenue.scaleLabel} 규모).</span>
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
              {/* 값 → 판단 → 조언 (규칙 기반 — 문턱값은 lib/advice.ts) */}
              {(() => {
                const a = revenueAdvice(pct);
                return a ? <span className="text-muted"> {a}</span> : null;
              })()}
            </Bullet>
          )}
          {rankingContext && (
            <Bullet tag="기회">
              이 상권의 {rankingContext.total}개 업종 중{" "}
              <b className="text-gold">{rankingContext.rank}위</b>
              {/* 원점수(백분위)는 표시하지 않는다 — 아래 '모델 종합진단' 점수와 같은
                  overall_score 에서 나온 다른 척도라 한 화면에 두 숫자가 있으면 혼선이 된다.
                  순위는 여기서, 점수는 진단 카드 한 곳에서만 말한다. */}
              <span className="text-muted"> (상권 내 업종 간 비교).</span>
            </Bullet>
          )}
          {result.context?.competition?.storeCount != null && (
            <Bullet tag="경쟁">
              동일 업종 점포 <b className="text-fg">{result.context.competition.storeCount.toLocaleString()}개</b>
              {result.context.competition.franchiseRatio != null && (
                <> · 프랜차이즈 {(result.context.competition.franchiseRatio * 100).toFixed(0)}%</>
              )}
              {/* v2 신규 — 시장 단계 (개업·폐업·점포수 증감 규칙 판정, 계보 '① 시장 단계' 행) */}
              {result.context.competition.marketStage && (
                <>
                  {" "}· 시장 단계{" "}
                  <b
                    className={MARKET_STAGE_TONE[result.context.competition.marketStage] ?? "text-fg"}
                    title="개업률·폐업률·점포수 증감의 규칙 판정 (모델 저장소 진단 규칙 — 서비스 정책값)"
                  >
                    {result.context.competition.marketStage}
                  </b>
                </>
              )}
              {result.context.competition.correction && <CorrectedBadge />}
              {result.context.competition.granularity === "seoul_industry" && (
                <span className="text-muted"> (서울 전체 기준)</span>
              )}
              {/* 값 → 판단 → 조언 (규칙 기반 — 문턱값은 lib/advice.ts) */}
              {(() => {
                const a = competitionAdvice(result);
                return a ? <span className="text-muted"> — {a}</span> : <span className="text-muted">.</span>;
              })()}
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
              {/* 값 → 판단 → 조언 (규칙 기반 — 문턱값은 lib/advice.ts) */}
              {(() => {
                const a = footTrafficAdvice(result);
                return a ? <span className="text-muted"> {a}</span> : null;
              })()}
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

        {/* v2 신규 — 모델 종합진단 분해 (계보 '① 종합진단 점수'·'① 강점·리스크' 행).
            웹 신호등(생존율 기반)과 별개 지표라 라벨로 구분한다 */}
        {result.diagnosis && (
          <div className="mt-3 rounded-lg border border-line/60 bg-ink-700/40 px-3 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <span className="rounded border border-line bg-ink-700/60 px-1.5 py-px text-[9px] font-medium text-muted">
                  모델 종합진단
                </span>
                <span className="text-[9.5px] text-faint">업종 내 백분위 기반 · 신호등(생존율)과 별개</span>
              </div>
              <div className="shrink-0 text-right">
                <b className="text-lg text-fg" style={{ fontFamily: "var(--font-numeric)" }}>
                  {result.diagnosis.overallScore.toFixed(0)}
                </b>
                <span className="text-[10px] text-faint">/100</span>
                {result.diagnosis.grade && (
                  <span className="ml-1.5 rounded border border-gold/40 bg-gold/10 px-1.5 py-px text-[10px] font-semibold text-gold-soft">
                    {result.diagnosis.grade}
                  </span>
                )}
              </div>
            </div>

            {result.diagnosis.components && result.diagnosis.components.length > 0 && (
              <div className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
                {(["positive", "negative"] as const).map((dir) => (
                  <div key={dir}>
                    <div className="mb-0.5 text-[9px] text-faint">
                      {dir === "positive" ? "가점 성분 (높을수록 유리)" : "감점 성분 (높을수록 불리)"}
                    </div>
                    {result.diagnosis!.components!
                      .filter((c) => c.direction === dir)
                      .map((c) => (
                        <div key={c.key} className="flex items-center gap-1.5 py-px">
                          <span className="w-[88px] shrink-0 truncate text-[9.5px] text-muted" title={c.label}>
                            {c.label}
                          </span>
                          <div className="h-1 flex-1 overflow-hidden rounded-full bg-ink-600/70">
                            <div
                              className={`h-full rounded-full ${dir === "positive" ? "bg-gold/70" : "bg-risk/60"}`}
                              style={{ width: `${Math.min(100, Math.max(0, c.score))}%` }}
                            />
                          </div>
                          <span
                            className="w-7 shrink-0 text-right text-[9.5px] text-fg/80"
                            style={{ fontFamily: "var(--font-numeric)" }}
                          >
                            {c.score.toFixed(0)}
                          </span>
                          <span className="w-9 shrink-0 text-[8.5px] text-faint">×{c.weight.toFixed(2)}</span>
                        </div>
                      ))}
                  </div>
                ))}
              </div>
            )}

            {/* diagnosis.strengths / risks 는 의도적으로 렌더하지 않는다 —
                위 불릿(advice.ts 의 값→판단→조언)과 같은 내용을 반복하기 때문.
                계보에도 행을 넣지 않는다. 데이터는 계약에 남겨 뒀다(다른 화면에서 쓸 수 있게). */}

            {result.diagnosis.note && (
              <p className="mt-1.5 text-[9px] leading-relaxed text-faint">{result.diagnosis.note}</p>
            )}
          </div>
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
            {result.survival.basis.startsWith("empirical_closure_rate")
              ? "예측치가 아닌 실측 폐업률 통계의 3년 환산값입니다."
              : "모델 산출값입니다."}
            {result.survival.basis.endsWith("_shrunk") &&
              " 점포 수가 적어 폐업 표본이 부족한 상권은 업종 평균 쪽으로 보정했습니다 (소표본이 100%로 표시되는 것을 막기 위함)."}
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
                  {topPctLabel(pct)}
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
          {/* v2 신규 — 업종별 test 오차(모델 성적표 채점 결과). 예측값이 아니라 투명성 표기 */}
          {result.revenue.accuracy && (
            <p className="mt-1.5 pl-2 text-[10px] leading-relaxed text-faint">
              예측 신뢰도: 이 업종에서 모델은 검증(test) 분기에 평균{" "}
              <b className="text-muted" style={{ fontFamily: "var(--font-numeric)" }}>
                ±{result.revenue.accuracy.smapePct.toFixed(1)}%
              </b>{" "}
              오차(SMAPE)를 보였습니다
              {result.revenue.accuracy.sampleN != null && (
                <> · 채점 표본 {result.revenue.accuracy.sampleN.toLocaleString()}건</>
              )}
              {result.revenue.accuracy.lowSample && (
                <>
                  {" "}· <span className="text-caution">표본이 적어 오차 추정 자체가 불안정한 업종입니다</span>
                </>
              )}
              {/* v2 확장 — 상권 유형별 오차 (이중 신뢰도) */}
              {result.revenue.accuracy.typeSmapePct != null && result.revenue.accuracy.typeLabel && (
                <>
                  {" "}· 이 상권 유형({result.revenue.accuracy.typeLabel})에서는 평균{" "}
                  <b className="text-muted" style={{ fontFamily: "var(--font-numeric)" }}>
                    ±{result.revenue.accuracy.typeSmapePct.toFixed(1)}%
                  </b>
                  {result.revenue.accuracy.typeLowSample && (
                    <span className="text-caution"> (표본 적음)</span>
                  )}
                </>
              )}
              . 모델 성적표의 채점 결과를 그대로 표시합니다.
            </p>
          )}

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
            {/* 보정 근거는 여기서 전부 밝힌다 (① 배지 → 이 블록으로 유도) */}
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

          {/* v2 신규 — 독립점포(비프랜차이즈) 관점 매출: 통계 추정, ML 예측 아님.
              프랜차이즈가 있거나(전체 평균이 독립 실상과 다를 수 있음) 순수 독립 상권일 때만 표시 */}
          {detail?.independent &&
            ((detail.store?.franchiseCount ?? 0) > 0 || detail.independent.isPure) && (
              <div className="mt-2 rounded-lg border border-line/60 bg-ink-700/40 px-3 py-2.5">
                <div className="flex items-center gap-1.5">
                  <span className="rounded border border-line bg-ink-700/60 px-1.5 py-px text-[9px] font-medium text-muted">
                    통계 추정
                  </span>
                  <span className="text-[10.5px] font-medium text-fg/90">
                    독립점포(비프랜차이즈) 관점 매출
                  </span>
                </div>

                {detail.independent.isPure ? (
                  <p className="mt-1.5 text-[10.5px] leading-relaxed text-muted">
                    이 상권의 {industry.name ?? "해당 업종"}은 <b className="text-fg/90">전부 독립점포</b>라
                    실측 점포당 매출이 곧 독립점포 매출입니다.
                    {detail.independent.onlyPercentile != null && detail.independent.peerCount != null && (
                      <>
                        {" "}같은 조건(프랜차이즈 0)의 상권 {detail.independent.peerCount.toLocaleString()}곳
                        중 상위{" "}
                        <b className="text-gold-soft" style={{ fontFamily: "var(--font-numeric)" }}>
                          {(100 - detail.independent.onlyPercentile).toFixed(0)}%
                        </b>
                        입니다.
                      </>
                    )}
                  </p>
                ) : detail.independent.kSource === "industry_fit" &&
                  detail.independent.estimatedSalesKRW != null ? (
                  <>
                    <div className="mt-1.5 flex items-end justify-between gap-3">
                      <div>
                        <div className="text-[10px] text-faint">추정 독립점포 매출 (점포당)</div>
                        <div
                          className="mt-0.5 text-lg font-semibold text-fg"
                          style={{ fontFamily: "var(--font-numeric)" }}
                        >
                          {formatKRW(detail.independent.estimatedSalesKRW)}
                        </div>
                      </div>
                      {detail.sales?.perStoreKRW != null && (
                        <div className="shrink-0 text-right">
                          <div className="text-[10px] text-faint">전체 점포 평균(실측)</div>
                          <div
                            className="text-sm font-semibold text-fg/80"
                            style={{ fontFamily: "var(--font-numeric)" }}
                          >
                            {formatKRW(detail.sales.perStoreKRW)}
                          </div>
                        </div>
                      )}
                    </div>
                    <p className="mt-1.5 text-[10px] leading-relaxed text-faint">
                      프랜차이즈 1곳이 독립점포 약{" "}
                      <b className="text-muted">{detail.independent.kUsed?.toFixed(1)}곳 몫</b>을 파는
                      것으로 추정해(서울 실측 회귀
                      {detail.independent.kFitR2 != null && <>, R² {detail.independent.kFitR2.toFixed(2)}</>}
                      {detail.independent.kSampleSize != null && (
                        <>, 표본 {detail.independent.kSampleSize.toLocaleString()}</>
                      )}
                      ) 전체 평균에서 독립점포 몫을 분리했습니다 — ML 예측이 아닌 통계 추정입니다.
                      {detail.independent.peerCount != null &&
                        detail.independent.peerMedianSalesKRW != null && (
                          <>
                            {" "}참고: 프랜차이즈 없는 같은 업종 상권{" "}
                            {detail.independent.peerCount.toLocaleString()}곳의 실측 중앙값은{" "}
                            {formatKRW(detail.independent.peerMedianSalesKRW)}입니다.
                          </>
                        )}
                    </p>
                  </>
                ) : (
                  <>
                    <p className="mt-1.5 text-[10.5px] leading-relaxed text-muted">
                      이 업종은 배수(k) 추정이 품질 기준(표본·설명력·시간 안정성)을 통과하지 못해{" "}
                      <b className="text-fg/90">확정값 대신 가정별 시나리오만</b> 제시합니다 — 값을
                      지어내지 않습니다.
                    </p>
                    {detail.independent.scenarios && (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {detail.independent.scenarios.map(
                          (s) =>
                            s.salesKRW != null && (
                              <span
                                key={s.k}
                                className="rounded border border-line/60 bg-ink-700/60 px-2 py-1 text-[10px] text-muted"
                                title={`프랜차이즈 1곳 = 독립점포 ${s.k}곳 몫 판매 가정`}
                              >
                                배수 {s.k}× →{" "}
                                <b className="text-fg/90" style={{ fontFamily: "var(--font-numeric)" }}>
                                  {formatKRW(s.salesKRW)}
                                </b>
                              </span>
                            )
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

          {result.context?.competition?.correction && (
            <div className="mt-2 rounded-lg border border-gold/25 bg-gold/5 px-3 py-2.5">
              <div className="flex items-center gap-1.5">
                <span className="rounded border border-gold/40 bg-gold/10 px-1.5 py-px text-[9px] font-medium text-gold-soft">
                  보정됨
                </span>
                <span className="text-[10.5px] font-medium text-gold-soft">
                  점포 수 · 프랜차이즈 비율
                </span>
              </div>
              <p className="mt-1.5 text-[10.5px] leading-relaxed text-muted">
                {result.context.competition.correction}
              </p>
              <p className="mt-1 text-[10px] leading-relaxed text-faint">
                원천 데이터에서 <b className="text-muted">일반 점포 + 프랜차이즈 = 전체</b> 항등식이
                전 행에서 성립함을 확인해 역산했습니다. 다만 <b className="text-muted">예상 매출은
                보정되지 않았습니다</b> — 같은 분모가 모델 학습에 쓰여 재학습 없이는 고칠 수 없습니다.
              </p>
            </div>
          )}

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

          {/* v2 신규 — 인구 밀도 (실측 ÷ 상권 면적, 계보 '⑤ 인구 밀도' 행) */}
          {result.context?.density &&
            (result.context.density.footTrafficPerKm2 != null ||
              result.context.density.residentPerKm2 != null ||
              result.context.density.workerPerKm2 != null) && (
              <SubBlock
                title="인구 밀도"
                aside={
                  <>
                    명/km²
                    {result.context.density.areaKm2 != null && (
                      <> · 상권 면적 {result.context.density.areaKm2.toFixed(2)}km² 기준</>
                    )}
                  </>
                }
              >
                {/* 값만 주면 높은지 낮은지 알 수 없어 자치구·서울 중앙값 대비를 함께 표시한다
                    (golmok 벤치마크 §3 — 밀도는 항상 3단 비교와 같이 나온다) */}
                <div className="grid grid-cols-3 gap-2">
                  {(
                    [
                      ["유동 (분기)", "footTrafficPerKm2"],
                      ["상주", "residentPerKm2"],
                      ["직장", "workerPerKm2"],
                    ] as const
                  ).map(([label, key]) => {
                    const d = result.context!.density!;
                    const v = d[key];
                    const gu = d.guMedian?.[key] ?? null;
                    const seoul = d.seoulMedian?.[key] ?? null;
                    const ratio = v != null && seoul ? v / seoul : null;
                    return (
                      <div key={label} className="rounded-lg bg-ink-700/50 px-3 py-2">
                        <div className="text-[10px] text-faint">{label}</div>
                        <div
                          className="mt-0.5 text-sm font-semibold text-fg"
                          style={{ fontFamily: "var(--font-numeric)" }}
                        >
                          {v != null ? formatPeopleCompact(v) : "―"}
                        </div>
                        {ratio != null && (
                          <div className="mt-0.5 text-[9.5px] leading-tight text-muted">
                            서울 중앙값의{" "}
                            {/* 1 미만은 '배'로 쓰면 0.0 으로 뭉개진다 (실측: 상주 0.004배) → % 로 */}
                            <b className={ratio >= 1 ? "text-safe" : "text-muted"}>
                              {ratio >= 1
                                ? `${ratio >= 10 ? Math.round(ratio) : ratio.toFixed(1)}배`
                                : `${(ratio * 100).toFixed(ratio >= 0.1 ? 0 : 1)}%`}
                            </b>
                          </div>
                        )}
                        {gu != null && v != null && (
                          <div className="text-[9px] leading-tight text-faint">
                            {d.guName ?? "자치구"} 중앙 {formatPeopleCompact(gu)}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </SubBlock>
            )}
        </Section>
      )}

      {/* ── ⑥ 치안 참고 — 자치구 5대 범죄 (기회점수에 5% 반영 · 매출 예측 피처는 아님) ── */}
      {(() => {
        // 실측 우선순위: 서빙 detail.safety → /api/safety 실데이터 → 예시(목업)
        const real = detail?.safety ?? safetyFromScores ?? null;
        const s = real ?? mockSafety(result.sangwon.gu);
        const vsSeoul =
          s.totalIncidents != null && s.seoulAvgIncidents
            ? pctChange(s.totalIncidents, s.seoulAvgIncidents)
            : null;
        return (
          <Section n={6} title="치안 참고" aside="자치구 단위 · 5대 범죄">
            {real ? (
              <div className="mb-3 flex items-center gap-1.5 text-[10px] text-faint">
                <span className="rounded border border-line bg-ink-700/60 px-1.5 py-px font-medium text-muted">
                  실측 통계
                </span>
                경찰청 5대 범죄 발생 현황 · {s.year}년 · {s.guName ?? "자치구"} 기준
                {scoreComparison && !scoreComparison.isMock && " · 안전점수 실측 반영"}
              </div>
            ) : (
              <div className="mb-3 rounded-md border border-caution/40 bg-caution/10 px-2.5 py-2 text-[10px] leading-relaxed text-caution">
                ⚠ 예시 데이터 — 범죄 통계 CSV(자치구별 5대 범죄) 미보유로 자치구명 기반 가상
                수치를 표시합니다. 실데이터 연동 시 경찰청 연간 통계로 대체됩니다.
              </div>
            )}

            {/* 치안 반영 이중 점수 — "포함하면 무엇이 달라지는가"를 사용자가 직접 비교 */}
            {scoreComparison && (
              <div className="mb-3 rounded-lg border border-[#4ad6c0]/30 bg-[#4ad6c0]/5 px-3.5 py-3">
                <div className="mb-2 flex items-center gap-1.5">
                  <span className="text-[10px] font-semibold text-[#4ad6c0]">
                    치안 반영 시 종합점수는 이렇게 달라집니다
                  </span>
                  {scoreComparison.isMock && (
                    <span className="rounded border border-caution/40 bg-caution/10 px-1 py-px text-[9px] text-caution">
                      안전점수: 예시
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex-1">
                    <div className="text-[9.5px] text-faint">미반영 (매출 60 + 생존 40)</div>
                    <div className="text-lg font-semibold text-fg" style={{ fontFamily: "var(--font-numeric)" }}>
                      {scoreComparison.base.toFixed(1)}
                      <span className="ml-1 text-[10px] text-muted">
                        {scoreComparison.baseRank.toLocaleString()}위/{scoreComparison.total.toLocaleString()}
                      </span>
                    </div>
                  </div>
                  <span className="shrink-0 text-base text-faint">→</span>
                  <div className="flex-1">
                    <div className="text-[9.5px] text-faint">반영 (×95% + 안전점수 5%)</div>
                    <div className="text-lg font-semibold text-[#4ad6c0]" style={{ fontFamily: "var(--font-numeric)" }}>
                      {scoreComparison.adjusted.toFixed(1)}
                      <span
                        className={`ml-1 text-[10px] ${
                          scoreComparison.adjustedRank < scoreComparison.baseRank
                            ? "text-safe"
                            : scoreComparison.adjustedRank > scoreComparison.baseRank
                              ? "text-caution"
                              : "text-muted"
                        }`}
                      >
                        {scoreComparison.adjustedRank.toLocaleString()}위
                        {scoreComparison.adjustedRank !== scoreComparison.baseRank &&
                          ` (${scoreComparison.adjustedRank < scoreComparison.baseRank ? "▲" : "▼"}${Math.abs(scoreComparison.baseRank - scoreComparison.adjustedRank)})`}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="mt-1.5 text-[10px] text-muted">
                  {scoreComparison.guName ?? "자치구"} 안전점수{" "}
                  <b className="text-fg/90" style={{ fontFamily: "var(--font-numeric)" }}>
                    {scoreComparison.safetyScore != null ? scoreComparison.safetyScore.toFixed(1) : "―"}
                  </b>
                  /100 · 순위는 동일 업종 상권 {scoreComparison.total.toLocaleString()}곳 기준 ·
                  지도의 <b className="text-fg/80">종합점수 + 치안 반영</b> 토글과 같은 산식
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg bg-ink-700/50 px-3 py-2.5">
                <div className="text-[10px] text-faint">연간 5대 범죄 발생</div>
                <div className="mt-0.5 text-base font-semibold text-fg" style={{ fontFamily: "var(--font-numeric)" }}>
                  {s.totalIncidents != null ? `${s.totalIncidents.toLocaleString()}건` : "―"}
                </div>
                {vsSeoul != null && (
                  <div className="mt-0.5 text-[10px] text-muted">
                    서울 자치구 평균 대비{" "}
                    <b className={vsSeoul <= 0 ? "text-safe" : "text-caution"}>
                      {vsSeoul > 0 ? "+" : ""}
                      {vsSeoul.toFixed(0)}%
                    </b>
                  </div>
                )}
              </div>
              <div className="rounded-lg bg-ink-700/50 px-3 py-2.5">
                <div className="text-[10px] text-faint">발생 적은 순</div>
                <div className="mt-0.5 text-base font-semibold text-fg" style={{ fontFamily: "var(--font-numeric)" }}>
                  {s.rankAmongGus != null ? `${s.rankAmongGus}위` : "―"}
                  <span className="text-xs text-muted"> / {s.guCount ?? 25}개 구</span>
                </div>
                {s.per100k != null && (
                  <div className="mt-0.5 text-[10px] text-muted">
                    인구 10만명당 {s.per100k.toLocaleString()}건
                  </div>
                )}
              </div>
            </div>
            {s.byType && s.byType.length > 0 && (
              <SubBlock title="죄종별 발생" aside="절도·폭력이 대부분을 차지합니다">
                <CompareBars
                  rows={s.byType.map((t: { label: string; count: number }) => ({
                    label: t.label,
                    value: t.count,
                  }))}
                  format={(v) => `${Math.round(v).toLocaleString()}건`}
                />
              </SubBlock>
            )}
            <p className="mt-3 text-[9.5px] leading-relaxed text-faint">
              자치구 단위 통계로 상권·골목별 차이는 반영되지 않으며, 체감 치안과 다를 수
              있습니다. 안전점수는{" "}
              <b className="text-muted">기회점수(종합진단)에 5% 가중으로 반영</b>되지만, 매출
              예측 모델의 학습 피처는 아닙니다(검증에서 성능 기여가 없어 제외).
            </p>
          </Section>
        );
      })()}

      {/* ── ⑦ 배후지 분석 — 실측 (항목별 기준 분기가 다름) ── */}
      {(() => {
        const h = hinterland?.hinterland ?? null;
        const isMock = !hinterland || hinterland.sourceMode === "mock" || !h;
        // v2 신규 — R-ONE 임대 지표 (analyze detail 소스라 배후지 유무와 무관하게 렌더.
        //           자치구 평균 조인 — 계보 '⑦ 임대 시세' 행)
        const rentBlock = detail?.realEstate ? (
          <SubBlock title="임대 시세 (자치구 평균)" aside="한국부동산원 R-ONE · 소규모 상가">
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-lg bg-ink-700/50 px-3 py-2">
                <div className="text-[10px] text-faint">임대료 (m²당)</div>
                <div className="mt-0.5 text-sm font-semibold text-fg" style={{ fontFamily: "var(--font-numeric)" }}>
                  {Math.round(detail.realEstate.rentPerM2KRW).toLocaleString()}원
                </div>
              </div>
              <div className="rounded-lg bg-ink-700/50 px-3 py-2">
                <div className="text-[10px] text-faint">공실률</div>
                <div className="mt-0.5 text-sm font-semibold text-fg" style={{ fontFamily: "var(--font-numeric)" }}>
                  {detail.realEstate.vacancyRate != null
                    ? `${(detail.realEstate.vacancyRate * 100).toFixed(1)}%`
                    : "―"}
                </div>
              </div>
              <div className="rounded-lg bg-ink-700/50 px-3 py-2">
                <div className="text-[10px] text-faint">임대가격지수</div>
                <div className="mt-0.5 text-sm font-semibold text-fg" style={{ fontFamily: "var(--font-numeric)" }}>
                  {detail.realEstate.rentIndex != null ? detail.realEstate.rentIndex.toFixed(1) : "―"}
                  {detail.realEstate.rentIndexYoy != null && (
                    <span
                      className={`ml-1 text-[10px] ${detail.realEstate.rentIndexYoy >= 0 ? "text-risk" : "text-safe"}`}
                    >
                      {detail.realEstate.rentIndexYoy >= 0 ? "▲" : "▼"}
                      {Math.abs(detail.realEstate.rentIndexYoy * 100).toFixed(1)}%
                    </span>
                  )}
                </div>
              </div>
            </div>
            {/* 서울 중앙값 대비 — 값만으로는 비싼지 싼지 알 수 없다 (golmok 벤치마크 §3) */}
            {detail.realEstate.seoulMedianRentPerM2KRW != null && (() => {
              const d = detail.realEstate!.rentPerM2KRW - detail.realEstate!.seoulMedianRentPerM2KRW!;
              const cheaper = d < 0;
              return (
                <p className="mt-1.5 text-[10.5px] leading-relaxed text-muted">
                  서울 중앙값(
                  {Math.round(detail.realEstate!.seoulMedianRentPerM2KRW!).toLocaleString()}원/m²)보다{" "}
                  <b className={cheaper ? "text-safe" : "text-caution"}>
                    {Math.abs(Math.round(d)).toLocaleString()}원 {cheaper ? "낮습니다" : "높습니다"}
                  </b>
                  . 고정비 부담을 주변 시세와 함께 확인하세요.
                </p>
              );
            })()}
            <p className="mt-1.5 text-[9.5px] leading-relaxed text-faint">{detail.realEstate.basis}</p>
          </SubBlock>
        ) : null;
        if (isMock) {
          return (
            <Section n={7} title="배후지 분석" aside="주거·직장·시설">
              <div className="rounded-md border border-caution/40 bg-caution/10 px-2.5 py-2 text-[10px] leading-relaxed text-caution">
                ⚠ 배후지 데이터 없음 — 이 상권의 상주·직장인구 등이 원본 데이터셋에 없거나
                산출물이 준비되지 않았습니다. 없는 값을 예시로 채우지 않습니다.
              </div>
              {rentBlock}
            </Section>
          );
        }
        const asOfChip = (q: string) => (
          <span className="rounded border border-line bg-ink-700/60 px-1 py-px text-[9px] text-muted">
            {q}
          </span>
        );
        const topSlice = (arr?: RatioSlice[] | null) => topOf(arr ?? null);
        return (
          <Section n={7} title="배후지 분석" aside="이 상권에 손님을 공급하는 생활권">
            <div className="grid grid-cols-2 gap-2">
              {h.resident?.total != null && (
                <div className="rounded-lg bg-ink-700/50 px-3 py-2.5">
                  <div className="flex items-center gap-1 text-[10px] text-faint">
                    주거(상주)인구 {asOfChip(h.resident.asOf)}
                  </div>
                  <div className="mt-0.5 text-base font-semibold text-fg" style={{ fontFamily: "var(--font-numeric)" }}>
                    {formatPeople(h.resident.total)}
                  </div>
                  {topSlice(h.resident.byAge) && (
                    <div className="mt-0.5 text-[10px] text-muted">
                      최다 {AGE_KO[topSlice(h.resident.byAge)!.label] ?? topSlice(h.resident.byAge)!.label}{" "}
                      {(topSlice(h.resident.byAge)!.ratio * 100).toFixed(0)}%
                    </div>
                  )}
                </div>
              )}
              {h.worker?.total != null && (
                <div className="rounded-lg bg-ink-700/50 px-3 py-2.5">
                  <div className="flex items-center gap-1 text-[10px] text-faint">
                    직장인구 {asOfChip(h.worker.asOf)}
                  </div>
                  <div className="mt-0.5 text-base font-semibold text-fg" style={{ fontFamily: "var(--font-numeric)" }}>
                    {formatPeople(h.worker.total)}
                  </div>
                  {h.resident?.total ? (
                    <div className="mt-0.5 text-[10px] text-muted">
                      주거 대비 {(h.worker.total / h.resident.total).toFixed(1)}배
                    </div>
                  ) : null}
                </div>
              )}
              {h.household?.total != null && (
                <div className="rounded-lg bg-ink-700/50 px-3 py-2.5">
                  <div className="flex items-center gap-1 text-[10px] text-faint">
                    가구 수 {asOfChip(h.household.asOf)}
                  </div>
                  <div className="mt-0.5 text-base font-semibold text-fg" style={{ fontFamily: "var(--font-numeric)" }}>
                    {h.household.total.toLocaleString()}가구
                  </div>
                  {/* 아파트/일반 분해는 원본 미제공 (APT_HSHLD_CO 전 구간 0) —
                      아파트 세대수는 옆 '아파트' 블록이 별도 데이터셋으로 답한다 */}
                  {h.apartment?.households != null && h.household.total > 0 && (
                    <div className="mt-0.5 text-[10px] text-muted">
                      이 중 아파트 세대 {h.apartment.households.toLocaleString()} (아파트-상권 기준)
                    </div>
                  )}
                </div>
              )}
              {h.apartment && (h.apartment.complexes != null || h.apartment.avgPriceKRW != null) && (
                <div className="rounded-lg bg-ink-700/50 px-3 py-2.5">
                  <div className="flex items-center gap-1 text-[10px] text-faint">
                    아파트 {asOfChip(h.apartment.asOf)}
                  </div>
                  <div className="mt-0.5 text-base font-semibold text-fg" style={{ fontFamily: "var(--font-numeric)" }}>
                    {h.apartment.complexes != null ? `${h.apartment.complexes.toLocaleString()}단지` : "―"}
                  </div>
                  <div className="mt-0.5 text-[10px] text-muted">
                    {h.apartment.avgPriceKRW != null && <>평균 {formatKRW(h.apartment.avgPriceKRW)}</>}
                    {h.apartment.avgAreaM2 != null && <> · {h.apartment.avgAreaM2}㎡</>}
                  </div>
                </div>
              )}
              {h.facility?.total != null && (
                <div className="rounded-lg bg-ink-700/50 px-3 py-2.5">
                  <div className="flex items-center gap-1 text-[10px] text-faint">
                    집객시설 {asOfChip(h.facility.asOf)}
                  </div>
                  <div className="mt-0.5 text-base font-semibold text-fg" style={{ fontFamily: "var(--font-numeric)" }}>
                    {h.facility.total.toLocaleString()}개
                  </div>
                  {h.facility.items?.[0] && (
                    <div className="mt-0.5 text-[10px] text-muted">
                      최다 {h.facility.items[0].label} {h.facility.items[0].count}개
                    </div>
                  )}
                </div>
              )}
            </div>

            {h.resident?.byAge && (
              <SubBlock title="배후지 연령 구성" aside={`상주인구 기준 · ${h.resident.asOf}`}>
                <SliceBarChart data={h.resident.byAge} />
              </SubBlock>
            )}
            {h.resident?.byGender && (
              <SubBlock title="배후지 성별 구성">
                <GenderSplit data={h.resident.byGender} />
              </SubBlock>
            )}
            {h.spending?.byCategory && (
              <SubBlock
                title="배후지 소비지출"
                aside={
                  <>
                    총 {h.spending.totalKRW != null ? formatKRW(h.spending.totalKRW) : "―"} ·{" "}
                    <b className="text-caution/90">{h.spending.asOf} 기준</b>
                  </>
                }
              >
                <SliceBarChart data={h.spending.byCategory} />
                <p className="mt-1.5 text-[9.5px] leading-relaxed text-faint">
                  소비지출은 원본이 <b className="text-muted">{h.spending.asOf} 이후 미공개</b>라 다른 블록보다
                  과거 값입니다. 매출 데이터와 겹치는 분기가 없어 예측 모델에는 사용하지 않습니다.
                </p>
              </SubBlock>
            )}
            {h.facility?.items && h.facility.items.length > 0 && (
              <SubBlock title="주요 집객시설" aside={h.facility.asOf}>
                <div className="flex flex-wrap gap-1.5">
                  {h.facility.items.map((f: { label: string; count: number }) => (
                    <span
                      key={f.label}
                      className="rounded-full border border-line/60 bg-ink-700/50 px-2 py-1 text-[10.5px] text-muted"
                    >
                      {f.label}{" "}
                      <b className="text-fg/90" style={{ fontFamily: "var(--font-numeric)" }}>{f.count}</b>
                    </span>
                  ))}
                </div>
              </SubBlock>
            )}

            {/* v2 신규 — R-ONE 임대 지표 (rentBlock 은 배후지 유무 양쪽 분기에서 렌더) */}
            {rentBlock}

            {/* 데이터셋에 없어 뺀 항목 — 왜 없는지 밝힌다 (빈칸을 목업으로 채우지 않음).
                임대시세는 detail.realEstate 가 생기면 목록에서 제외 (자치구 평균으로 제공 시작) */}
            {(() => {
              const unavailable = hinterland.unavailable.filter(
                (u: { item: string }) => !(detail?.realEstate && u.item.includes("임대"))
              );
              return unavailable.length > 0 ? (
                <div className="mt-3 border-t border-line/50 pt-2">
                  <div className="mb-1 text-[10px] text-faint">제공하지 않는 항목</div>
                  <ul className="space-y-0.5">
                    {unavailable.map((u: { item: string; reason: string }) => (
                      <li key={u.item} className="text-[9.5px] leading-relaxed text-faint">
                        · <b className="text-muted">{u.item}</b> — {u.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null;
            })()}
          </Section>
        );
      })()}

      {/* ── ⑧ 유의사항 · 한계 ───────────────────────────── */}
      <Section n={8} title="유의사항 · 한계">
        <ul className="space-y-1.5 text-[11px] leading-relaxed text-muted">
          {result.survival && (
            <li className="flex gap-1.5">
              <span className="text-faint">·</span>
              생존율은 예측이 아니라 <b className="text-fg/80">실측 폐업률의 3년 환산치</b>입니다
              ({survivalScopeLabel(result.survival.granularity)} 통계, 폐업률이 기간 내 일정하다는 가정).
              {result.survival.granularity === "seoul_industry" && " 상권별 차이는 반영되지 않습니다."}
            </li>
          )}
          {result.revenue && (
            /* 집계 수준 문구는 서버 주입값(scaleNote)을 그대로 쓴다 —
               소스에 따라 '합산'/'점포당'이 갈리므로 하드코딩하면 리포트 안에서 모순이 생긴다 */
            <li className="flex gap-1.5">
              <span className="text-faint">·</span>
              예상 매출 — {result.revenue.scaleNote}
            </li>
          )}
          {result.context?.competition?.correction && (
            <li className="flex gap-1.5">
              <span className="text-faint">·</span>
              <span>
                {/* 보정 사유는 서버 주입값(correction)을 그대로 쓴다 — 원인을 여기 하드코딩하면
                    상류가 고쳐졌을 때 화면에만 낡은 설명이 남는다 (2026-08-04 실제로 발생) */}
                <b className="text-fg/80">점포 수·프랜차이즈 비율은 보정된 값</b>입니다 (④ 참조).{" "}
                {result.context.competition.correction}
              </span>
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
            치안 참고(⑥)는 <b className="text-fg/80">자치구 단위</b> 경찰청 통계로 상권별 차이를 반영하지 않습니다.
            치안 지표는 실측값으로 채워져 있지만, 검증(ablation)에서 예측 성능을 개선하지 못해{" "}
            <b className="text-fg/80">매출 예측 모델의 학습 피처에서는 제외</b>됐습니다 — 대신
            종합점수의 안전점수(5%)와 참고 지표로 쓰입니다.
            지역에 대한 단정적 판단의 근거로 사용하지 마세요.
          </li>
          {hinterland?.hinterland?.spending && (
            <li className="flex gap-1.5">
              <span className="text-faint">·</span>
              배후지 분석(⑦)은 <b className="text-fg/80">항목별 기준 분기가 다릅니다</b> — 상주·직장인구·
              아파트·집객시설은 최신이지만 <b className="text-fg/80">소비지출은 {hinterland.hinterland.spending.asOf} 이후
              원본 미공개</b>라 그 시점 값입니다. 각 블록에 기준 분기를 표기했습니다.
            </li>
          )}
          <li className="flex gap-1.5">
            <span className="text-faint">·</span>
            모든 수치는 공공데이터 기반 참고 지표이며, 투자·창업 결정의 근거가 아닌 탐색 도구입니다.
          </li>
        </ul>
      </Section>

      {/* ── ⑨ 데이터 출처 ───────────────────────────────── */}
      {(result.meta.sources.length > 0 || (extraSources?.length ?? 0) > 0) && (
        <Section n={9} title="데이터 출처">
          <ul className="space-y-0.5">
            {[...result.meta.sources, ...(extraSources ?? [])].map((s) => (
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

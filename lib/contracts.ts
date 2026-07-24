/**
 * contracts.ts — 내부 계약 단일 소스 (프론트 ↔ 서버)
 *
 * TECH_SPEC.md §4의 정본. 프론트는 이 스키마에만 의존한다.
 * 외부 계약(모델 서버 응답)은 lib/normalize.ts 가 이 형태로 흡수한다.
 * 스키마 필드가 바뀌면 이 파일이 진실이고 TECH_SPEC.md 를 뒤따라 갱신한다.
 */
import { z } from "zod";

// ------------------------------------------------------------------
// 공통
// ------------------------------------------------------------------
export const AnalyzeStatus = z.enum(["ok", "insufficient_data", "error"]);
export type AnalyzeStatus = z.infer<typeof AnalyzeStatus>;

/** 응답이 실데이터인지 목업 폴백인지 — 신뢰성 UX를 위해 항상 노출 */
export const SourceMode = z.enum(["live", "file", "mock"]);
export type SourceMode = z.infer<typeof SourceMode>;

export const Grade = z.enum(["safe", "caution", "risk"]);
export type Grade = z.infer<typeof Grade>;

// ------------------------------------------------------------------
// 디버그 트레이스 — 인스펙터 콘솔용 (모델 서버와의 외부 통신 원문)
// ------------------------------------------------------------------
export const DebugTrace = z.object({
  /** 실제 호출한 모델 서버 URL (또는 읽은 파일 경로) */
  externalUrl: z.string(),
  /** 모델 서버로 보낸 요청 본문 (외부 계약) */
  externalRequest: z.unknown().nullable(),
  /** 모델 서버가 반환한 응답 원문 — normalize() 전 형태 */
  externalResponse: z.unknown().nullable(),
  externalStatus: z.number().nullable(),
  externalDurationMs: z.number(),
  /** 폴백 발생 시 원인 (예: fetch 실패 메시지) */
  error: z.string().nullable(),
});
export type DebugTrace = z.infer<typeof DebugTrace>;

// ------------------------------------------------------------------
// 분석 요청 / 응답
// ------------------------------------------------------------------
export const AnalyzeRequest = z.object({
  sangwonCode: z.number().int(),
  industryCode: z.string().min(1),
});
export type AnalyzeRequest = z.infer<typeof AnalyzeRequest>;

export const SurvivalPayload = z.object({
  /** 0~1. 실측 폐업률 환산 3년 생존율 (모델 서버 ANSWERS.md 참조) */
  probability: z.number().min(0).max(1),
  /** 신호등 판정은 서버(route handler)가 수행 — 문턱값이 프론트에 흩어지지 않게 */
  grade: Grade,
  horizonYears: z.number().int(),
  /** "empirical_closure_rate" 등 — 예측이 아닌 실측 기반임을 UI에 표기 */
  basis: z.string(),
  /** "seoul_industry"면 업종 단위 통계(상권별 차이 미반영)임을 안내 */
  granularity: z.string(),
});
export type SurvivalPayload = z.infer<typeof SurvivalPayload>;

export const RevenuePayload = z.object({
  monthlyEstimateKRW: z.number(),
  /** 같은 업종 내 전체 상권 대비 백분위 (0~100) */
  percentileInSangwon: z.number().min(0).max(100).nullable(),
  /** 면책 문구 — 서버가 강제 주입, UI 누락 구조적으로 불가 */
  disclaimer: z.string().min(1),
  /** 집계 수준 안내 — "상권×업종 전체 점포 합산" (1개 점포 매출 아님) */
  scaleNote: z.string(),
});
export type RevenuePayload = z.infer<typeof RevenuePayload>;

export const ContextPayload = z.object({
  footTraffic: z
    .object({
      total: z.number(),
      friday: z.number().nullable(),
      saturday: z.number().nullable(),
    })
    .nullable(),
  competition: z
    .object({
      storeCount: z.number().nullable(),
      franchiseRatio: z.number().nullable(),
      /** 점포 데이터 집계 단위 — "seoul_industry"면 서울 전체 기준 */
      granularity: z.string(),
    })
    .nullable(),
  demographics: z.array(
    z.object({ ageBand: z.string(), ratio: z.number() })
  ),
});
export type ContextPayload = z.infer<typeof ContextPayload>;

// ------------------------------------------------------------------
// 상세 분석 (golmok 벤치마크 확장) — 실측 원천값 기반, 모델 예측과 구분
// ------------------------------------------------------------------
/** 비중 슬라이스 — 요일/시간대/성별/연령 분포 (ratio 0~1, 그룹 합 대비) */
export const RatioSlice = z.object({ label: z.string(), ratio: z.number() });
export type RatioSlice = z.infer<typeof RatioSlice>;

/** 분기 추이 포인트 */
export const TrendPoint = z.object({ quarter: z.string(), value: z.number() });
export type TrendPoint = z.infer<typeof TrendPoint>;

export const SalesDetail = z.object({
  /** 실측(카드 추정) 분기 매출 — 모델 예측(monthlyEstimateKRW)과 별개 */
  monthlyTotalKRW: z.number().nullable(),
  perStoreKRW: z.number().nullable(),
  byDay: z.array(RatioSlice).nullable(),
  byTime: z.array(RatioSlice).nullable(),
  byGender: z.array(RatioSlice).nullable(),
  byAge: z.array(RatioSlice).nullable(),
  trend: z.array(TrendPoint),
  /** 전분기 값 (없으면 null) */
  prev: z.number().nullable(),
  /** 전년 동분기 값 (없으면 null) */
  yoy: z.number().nullable(),
  basis: z.string(),
});
export type SalesDetail = z.infer<typeof SalesDetail>;

export const StoreDetail = z.object({
  openCount: z.number().nullable(),
  openRate: z.number().nullable(),
  closeCount: z.number().nullable(),
  closeRate: z.number().nullable(),
  franchiseCount: z.number().nullable(),
  generalCount: z.number().nullable(),
  trend: z.array(TrendPoint),
  prev: z.number().nullable(),
  yoy: z.number().nullable(),
});
export type StoreDetail = z.infer<typeof StoreDetail>;

export const FootTrafficDetail = z.object({
  byDay: z.array(RatioSlice).nullable(),
  byTime: z.array(RatioSlice).nullable(),
  byGender: z.array(RatioSlice).nullable(),
  trend: z.array(TrendPoint),
  prev: z.number().nullable(),
  yoy: z.number().nullable(),
  /** "sangwon" — 업종 무관 상권 단위 */
  granularity: z.string(),
});
export type FootTrafficDetail = z.infer<typeof FootTrafficDetail>;

/** 서울시/자치구/상권 3단 비교 (상권 단위 데이터 집계 기준) */
export const ComparisonDetail = z.object({
  guName: z.string().nullable(),
  storeCount: z.object({
    sangwon: z.number().nullable(),
    gu: z.number().nullable(),
    seoul: z.number().nullable(),
  }),
  perStoreSalesKRW: z.object({
    sangwon: z.number().nullable(),
    gu: z.number().nullable(),
    seoul: z.number().nullable(),
  }),
  note: z.string(),
});
export type ComparisonDetail = z.infer<typeof ComparisonDetail>;

export const AnalyzeDetail = z.object({
  sales: SalesDetail.nullable(),
  store: StoreDetail.nullable(),
  footTraffic: FootTrafficDetail.nullable(),
  comparison: ComparisonDetail.nullable(),
});
export type AnalyzeDetail = z.infer<typeof AnalyzeDetail>;

export const AnalyzeResult = z.object({
  status: AnalyzeStatus,
  sourceMode: SourceMode,
  sangwon: z.object({
    code: z.number(),
    name: z.string().nullable(),
    gu: z.string().nullable(),
    dong: z.string().nullable(),
    lat: z.number().nullable(),
    lon: z.number().nullable(),
  }),
  industry: z.object({ code: z.string(), name: z.string().nullable() }),
  survival: SurvivalPayload.nullable(),
  revenue: RevenuePayload.nullable(),
  context: ContextPayload.nullable(),
  narrative: z
    .object({ summary: z.string(), generator: z.string() })
    .nullable(),
  /** 상세 분석 (실측 원천값) — 목업 폴백에는 없을 수 있음 */
  detail: AnalyzeDetail.nullable().optional(),
  meta: z.object({
    confidence: z.enum(["high", "medium", "low"]),
    sampleSize: z.number().int(),
    dataAsOf: z.string(),
    sources: z.array(z.string()),
  }),
  /** 인스펙터 콘솔용 — 모델 서버와의 통신 원문 (데모 투명성) */
  debug: DebugTrace.nullable().optional(),
});
export type AnalyzeResult = z.infer<typeof AnalyzeResult>;

// ------------------------------------------------------------------
// 히트맵
// ------------------------------------------------------------------
export const HeatmapCell = z.object({
  sangwonCode: z.number(),
  sangwonName: z.string().nullable(),
  gu: z.string().nullable(),
  lat: z.number().nullable(),
  lon: z.number().nullable(),
  survivalProbability: z.number().nullable(),
  monthlyEstimateKRW: z.number().nullable(),
  /** 같은 업종 내 매출 백분위 — 현 데이터에서 히트맵 기본 색 기준 */
  salesPercentile: z.number().nullable(),
  grade: Grade.nullable(),
});
export type HeatmapCell = z.infer<typeof HeatmapCell>;

export const HeatmapResult = z.object({
  industryCode: z.string(),
  industryName: z.string().nullable(),
  sourceMode: SourceMode,
  dataAsOf: z.string(),
  /** 생존율 집계 단위 — "seoul_industry"면 생존율 색칠은 단색이 되므로 UI가 매출 기준을 기본으로 */
  survivalGranularity: z.string(),
  cells: z.array(HeatmapCell),
  /** 인스펙터 콘솔용 — 어떤 사전계산 파일을 읽었는지 */
  debug: DebugTrace.nullable().optional(),
});
export type HeatmapResult = z.infer<typeof HeatmapResult>;

// ------------------------------------------------------------------
// 메타 (업종/상권 목록)
// ------------------------------------------------------------------
export const MetaResult = z.object({
  sourceMode: SourceMode,
  dataAsOf: z.string(),
  industries: z.array(z.object({ code: z.string(), name: z.string() })),
  sangwons: z.array(
    z.object({
      code: z.number(),
      name: z.string().nullable(),
      category: z.string().nullable(),
      gu: z.string().nullable(),
      dong: z.string().nullable(),
      lat: z.number().nullable(),
      lon: z.number().nullable(),
    })
  ),
});
export type MetaResult = z.infer<typeof MetaResult>;

// ------------------------------------------------------------------
// 지역 우선 — 상권 내 업종 랭킹 (위치 먼저 플로우)
//   위치를 먼저 고르면, 그 상권의 업종별 요약 통계를 먼저 보여주고
//   사용자가 그걸 보고 업종을 선택하게 한다. grade는 서버(route)가 주입.
// ------------------------------------------------------------------
export const TopIndustry = z.object({
  code: z.string(),
  name: z.string().nullable(),
  /** 상권×업종 전체 점포 합산 예상 월매출 */
  monthlyEstimateKRW: z.number(),
  /** 같은 업종 내 전체 상권 대비 백분위 (0~100) */
  salesPercentile: z.number().min(0).max(100).nullable(),
  survivalProbability: z.number().min(0).max(1).nullable(),
  grade: Grade.nullable(),
  storeCount: z.number().nullable(),
  franchiseRatio: z.number().nullable(),
  /** 이 상권 '안에서' 업종 간 상대 창업기회점수 (0~100) */
  opportunityScore: z.number(),
});
export type TopIndustry = z.infer<typeof TopIndustry>;

export const TopIndustriesResult = z.object({
  sourceMode: SourceMode,
  dataAsOf: z.string(),
  survivalGranularity: z.string(),
  sangwon: z.object({
    code: z.number(),
    name: z.string().nullable(),
    category: z.string().nullable(),
    gu: z.string().nullable(),
    dong: z.string().nullable(),
    lat: z.number().nullable(),
    lon: z.number().nullable(),
    /** 상권 단위 분기 유동인구 (업종 무관 동일) */
    footTraffic: z.number().nullable(),
  }),
  industries: z.array(TopIndustry),
  debug: DebugTrace.nullable().optional(),
});
export type TopIndustriesResult = z.infer<typeof TopIndustriesResult>;

// ------------------------------------------------------------------
// 신호등 판정 (서버 전용 — ANSWERS.md Q6 권장 문턱값)
// ------------------------------------------------------------------
export const GRADE_THRESHOLDS = { safe: 0.6, caution: 0.45 } as const;

export function gradeOf(probability: number): Grade {
  if (probability >= GRADE_THRESHOLDS.safe) return "safe";
  if (probability >= GRADE_THRESHOLDS.caution) return "caution";
  return "risk";
}

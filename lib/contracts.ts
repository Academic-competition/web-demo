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

/**
 * 업종별 예측 오차(모델 채점 결과) — v2 신규, 정적 산출물에만 존재.
 * 예측값이 아니라 "이 업종에서 test 분기에 평균 몇 % 틀렸는지"다.
 * 투명성 표기용 — 신뢰도 배지·문구에 쓰고, 점수 계산에 쓰지 말 것.
 */
export const RevenueAccuracy = z.object({
  /** SMAPE(%) — 낮을수록 정확. 서울 평균 ≈ 26% */
  smapePct: z.number(),
  /** test 분기 채점 표본 수 */
  sampleN: z.number().nullable(),
  /** 표본이 적어 오차 추정 자체가 불안정한 업종 */
  lowSample: z.boolean(),
});
export type RevenueAccuracy = z.infer<typeof RevenueAccuracy>;

export const RevenuePayload = z.object({
  monthlyEstimateKRW: z.number(),
  /** 같은 업종 내 전체 상권 대비 백분위 (0~100) */
  percentileInSangwon: z.number().min(0).max(100).nullable(),
  /** v2 신규 — 없으면(구 번들·라이브·목업) UI 는 신뢰도 표기를 생략 */
  accuracy: RevenueAccuracy.nullable().optional(),
  /** 면책 문구 — 서버가 강제 주입, UI 누락 구조적으로 불가 */
  disclaimer: z.string().min(1),
  /**
   * 집계 수준 안내(긴 문장) — 서버가 강제 주입.
   * 소스에 따라 의미가 정반대다: 정적 폴백은 "상권 전체 점포 합산",
   * 라이브(Commercial-AI-)는 "점포 1곳 평균". UI 는 이 값을 그대로 쓸 것.
   */
  scaleNote: z.string(),
  /**
   * 집계 수준 짧은 라벨 — KPI 타일·요약 한 줄용 ("상권×업종 합산" / "점포당 평균").
   * ⚠️ UI 에 하드코딩하지 말 것. scaleNote 와 반드시 같은 의미여야 하며,
   *    라이브/정적 소스가 섞이면 한 리포트 안에서 모순된 라벨이 나온다.
   */
  scaleLabel: z.string(),
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
      /**
       * 상류 정의 보정 안내 — 서버가 보정을 적용했을 때만 문구가 담긴다 (미적용이면 null).
       * ⚠️ UI 는 이 값이 있으면 **반드시 노출**할 것. 표시 수치가 모델 서버 원본과
       *    다르다는 사실을 숨기지 않기 위한 필드다.
       */
      correction: z.string().nullable(),
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

/** 치안 참고 — 자치구 5대 범죄 (경찰청 통계, 기회점수 미반영 표시 전용) */
export const SafetyDetail = z.object({
  year: z.string(),
  guName: z.string().nullable(),
  totalIncidents: z.number().nullable(),
  byType: z.array(z.object({ label: z.string(), count: z.number() })).nullable(),
  /** 발생 건수 적은 순 순위 (1 = 서울 자치구 중 가장 적음) */
  rankAmongGus: z.number().nullable(),
  guCount: z.number().nullable(),
  seoulAvgIncidents: z.number().nullable(),
  /** 주민등록인구 10만명당 발생 (인구 파일 있을 때만) */
  per100k: z.number().nullable(),
  /** "gu" — 자치구 단위(상권별 차이 미반영) */
  granularity: z.string(),
});
export type SafetyDetail = z.infer<typeof SafetyDetail>;

/**
 * 자치구 안전 종합점수 (0~100, 높을수록 안전) — '치안 반영' 토글의 데이터 소스.
 * 산식은 모델 정본(Commercial-AI- scoring_weights.yaml)과 동일:
 *   0.50×(1−범죄율 백분위) + 0.25×검거율 백분위 + 0.25×CCTV밀도 백분위
 * ⚠️ 자치구 단위 — 같은 구 안의 상권들은 전부 같은 점수를 받는다.
 */
export const SafetyScoresResult = z.object({
  sourceMode: SourceMode,
  /** 범죄 통계 기준 연도 — 목업이면 "예시" */
  year: z.string(),
  /** CCTV 기준 연도 (성분에 포함됐을 때만) */
  cctvYear: z.string().nullable().optional(),
  byGu: z.record(
    z.string(),
    z.object({
      /** 안전 종합점수 0~100 (높을수록 안전) */
      score: z.number(),
      crimeRatePer100k: z.number().nullable(),
      /** 검거/발생 비 — 원본 그대로라 1.0 을 넘을 수 있다. '검거율'로 표시하지 말 것 */
      arrestRate: z.number().nullable(),
      cctvPerKm2: z.number().nullable(),
      // ↓ 점수 성분이 아니라 리포트 ⑥ 타일용 원본 집계 (실데이터에만 존재)
      totalIncidents: z.number().nullable().optional(),
      byType: z.array(z.object({ label: z.string(), count: z.number() })).nullable().optional(),
      rankAmongGus: z.number().nullable().optional(),
      guCount: z.number().nullable().optional(),
      seoulAvgIncidents: z.number().nullable().optional(),
    })
  ),
  /** 산식·가중치 설명 — 실데이터면 산출 스크립트가 기록한 문구를 그대로 쓴다 */
  weightsNote: z.string(),
  /** 실제 사용한 출처 (실데이터에만) */
  sources: z.array(z.string()).nullable().optional(),
  debug: DebugTrace.nullable().optional(),
});
export type SafetyScoresResult = z.infer<typeof SafetyScoresResult>;

/**
 * 배후지 실측 — 리포트 ⑦. `meta/hinterland.json.gz` (tools/build_hinterland.py 산출).
 *
 * ⚠️ **항목별 기준 분기(asOf)가 다르다.** 상주/직장/아파트/집객시설은 최신(2026Q1)이지만
 *    소비지출은 원본이 2023Q4 이후 미공개다. 한 분기로 강제하면 최신 4종을 끌어내려야 해서
 *    항목별 as-of 를 쓴다 — **UI 는 각 블록에 asOf 를 반드시 표기할 것**(혼합 빈티지를 숨기지 않는다).
 */
export const HinterlandDetail = z.object({
  resident: z
    .object({
      total: z.number().nullable(),
      byGender: z.array(RatioSlice).nullable(),
      byAge: z.array(RatioSlice).nullable(),
      asOf: z.string(),
    })
    .nullable()
    .optional(),
  worker: z
    .object({
      total: z.number().nullable(),
      byAge: z.array(RatioSlice).nullable(),
      asOf: z.string(),
    })
    .nullable()
    .optional(),
  apartment: z
    .object({
      complexes: z.number().nullable(),
      /** 아파트 세대수 합 — 전체 가구 수가 아니다 (라벨 주의) */
      households: z.number().nullable(),
      avgPriceKRW: z.number().nullable(),
      avgAreaM2: z.number().nullable(),
      asOf: z.string(),
    })
    .nullable()
    .optional(),
  facility: z
    .object({
      total: z.number().nullable(),
      items: z.array(z.object({ label: z.string(), count: z.number() })).nullable(),
      asOf: z.string(),
    })
    .nullable()
    .optional(),
  /** 배후지 소비지출 — 표시 전용. 매출과 겹치는 분기가 없어 ML 누출 검증 불가 (ML 제외) */
  spending: z
    .object({
      totalKRW: z.number().nullable(),
      byCategory: z.array(RatioSlice).nullable(),
      asOf: z.string(),
    })
    .nullable()
    .optional(),
});
export type HinterlandDetail = z.infer<typeof HinterlandDetail>;

/** 데이터셋에 없어서 리포트에서 뺀 항목 — 왜 없는지 화면에 밝힌다 */
export const UnavailableItem = z.object({ item: z.string(), reason: z.string() });
export type UnavailableItem = z.infer<typeof UnavailableItem>;

export const HinterlandResult = z.object({
  sourceMode: SourceMode,
  hinterland: HinterlandDetail.nullable(),
  unavailable: z.array(UnavailableItem),
  sources: z.array(z.string()),
  debug: DebugTrace.nullable().optional(),
});
export type HinterlandResult = z.infer<typeof HinterlandResult>;

/**
 * 독립점포(비프랜차이즈) 관점 매출 — v2 신규, 통계 추정 (ML 예측 아님).
 * k = 프랜차이즈 1곳이 독립점포 몇 곳 몫을 파는지 (서울 데이터 내부 회귀로 추정).
 * kSource="industry_fit" 이면 품질 게이트 통과 → estimatedSalesKRW 제공,
 * "scenario_only" 면 미통과 → 고정 k 시나리오만 (값을 지어내지 않음 — UI 도 그렇게 표기).
 */
export const IndependentDetail = z.object({
  kSource: z.enum(["industry_fit", "scenario_only"]),
  /** 이 상권이 프랜차이즈 0 인 '순수 독립' 상권인가 */
  isPure: z.boolean().nullable(),
  /** isPure 일 때: 순수 독립 상권들 사이 백분위 (0~100) */
  onlyPercentile: z.number().nullable(),
  /** Tier1 — 같은 업종 '프랜차이즈 0' 상권 표본 수·점포당 매출 중앙값 */
  peerCount: z.number().nullable(),
  peerMedianSalesKRW: z.number().nullable(),
  /** Tier2 — 고정 k 가정 시나리오 (금액 단위 = detail.sales.perStoreKRW 와 동일) */
  scenarios: z.array(z.object({ k: z.number(), salesKRW: z.number().nullable() })).nullable(),
  /** Tier3 — 업종별 추정 k 와 그 품질 (industry_fit 일 때만 신뢰) */
  kUsed: z.number().nullable(),
  kFitR2: z.number().nullable(),
  kSampleSize: z.number().nullable(),
  /** 추정 k 적용 시 독립점포 기대 매출 — industry_fit 일 때만 값 존재 */
  estimatedSalesKRW: z.number().nullable(),
  basis: z.string(),
});
export type IndependentDetail = z.infer<typeof IndependentDetail>;

export const AnalyzeDetail = z.object({
  sales: SalesDetail.nullable(),
  store: StoreDetail.nullable(),
  footTraffic: FootTrafficDetail.nullable(),
  comparison: ComparisonDetail.nullable(),
  /** crime.csv 로드 시에만 존재 — 없으면 웹이 '예시 데이터'로 폴백 */
  safety: SafetyDetail.nullable().optional(),
  /** v2 신규 — 구 번들에는 없음 (UI 는 있을 때만 카드 렌더) */
  independent: IndependentDetail.nullable().optional(),
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
    /** v2 신규 — 상권 유형 5종 (주거형/직장형/유동형/주말·여가형/혼합형, 규칙 기반) */
    type: z.string().nullable().optional(),
    typeBasis: z.string().nullable().optional(),
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

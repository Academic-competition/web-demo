/**
 * mock.ts — 목업 데이터 팩토리
 *
 * 모델 서버가 없거나 오류일 때 route handler가 반환하는 폴백 (UC-006).
 * 모든 목업 응답은 sourceMode: "mock" 으로 표시되어 UI에 배지로 노출된다.
 */
import type {
  AnalyzeRequest,
  AnalyzeResult,
  HeatmapResult,
  MetaResult,
} from "./contracts";
import { gradeOf } from "./contracts";

const MOCK_DATA_AS_OF = "2025-Q4";
const MOCK_SOURCES = [
  "서울 열린데이터광장 상권분석서비스 (목업 데이터)",
  "모델 서버 미연결 상태의 예시 응답입니다",
];

export const MOCK_INDUSTRIES = [
  { code: "CS100001", name: "한식음식점" },
  { code: "CS100005", name: "제과점" },
  { code: "CS100008", name: "커피-음료" },
  { code: "CS100010", name: "치킨전문점" },
  { code: "CS200019", name: "PC방" },
  { code: "CS300007", name: "편의점" },
];

export const MOCK_SANGWONS = [
  { code: 900001, name: "역삼역 남부", category: "발달상권", gu: "강남구", dong: "역삼1동", lat: 37.4979, lon: 127.0276 },
  { code: 900002, name: "홍대입구역", category: "발달상권", gu: "마포구", dong: "서교동", lat: 37.5563, lon: 126.9236 },
  { code: 900003, name: "성수사거리", category: "골목상권", gu: "성동구", dong: "성수2가", lat: 37.5424, lon: 127.0557 },
  { code: 900004, name: "혜화역 대학로", category: "발달상권", gu: "종로구", dong: "혜화동", lat: 37.5822, lon: 127.0019 },
  { code: 900005, name: "노량진역", category: "골목상권", gu: "동작구", dong: "노량진1동", lat: 37.5133, lon: 126.9425 },
];

/** 코드 기반 결정적 의사난수 (같은 조합 = 같은 목업 값) */
function seeded(seed: number): () => number {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

export function mockMeta(): MetaResult {
  return {
    sourceMode: "mock",
    dataAsOf: MOCK_DATA_AS_OF,
    industries: MOCK_INDUSTRIES,
    sangwons: MOCK_SANGWONS,
  };
}

export function mockAnalyze(req: AnalyzeRequest): AnalyzeResult {
  const rand = seeded(req.sangwonCode + req.industryCode.charCodeAt(5) * 131);
  const probability = 0.4 + rand() * 0.35;
  const revenue = Math.round((3 + rand() * 15) * 1e8);
  const sangwon =
    MOCK_SANGWONS.find((s) => s.code === req.sangwonCode) ?? {
      code: req.sangwonCode,
      name: `상권 #${req.sangwonCode}`,
      category: null,
      gu: null,
      dong: null,
      lat: null,
      lon: null,
    };
  const industry =
    MOCK_INDUSTRIES.find((i) => i.code === req.industryCode) ?? {
      code: req.industryCode,
      name: null,
    };

  return {
    status: "ok",
    sourceMode: "mock",
    sangwon,
    industry,
    survival: {
      probability: Math.round(probability * 1e4) / 1e4,
      grade: gradeOf(probability),
      horizonYears: 3,
      basis: "empirical_closure_rate",
      granularity: "seoul_industry",
    },
    revenue: {
      monthlyEstimateKRW: revenue,
      percentileInSangwon: Math.round(rand() * 1000) / 10,
      disclaimer:
        "카드 결제 기반 추정치를 재추정한 상권 간 비교용 참고 지표입니다. 절대 금액 보장이 아닙니다.",
      scaleNote: "해당 상권 내 동일 업종 전체 점포의 합산 규모입니다 (1개 점포 매출 아님).",
    },
    context: {
      footTraffic: {
        total: Math.round(20 + rand() * 180) * 10000,
        friday: Math.round(3 + rand() * 30) * 10000,
        saturday: Math.round(3 + rand() * 30) * 10000,
      },
      competition: {
        storeCount: Math.round(500 + rand() * 60000),
        franchiseRatio: Math.round(rand() * 400) / 1000,
        granularity: "seoul_industry",
      },
      demographics: [
        { ageBand: "10s", ratio: 0.06 },
        { ageBand: "20s", ratio: 0.24 },
        { ageBand: "30s", ratio: 0.22 },
        { ageBand: "40s", ratio: 0.18 },
        { ageBand: "50s", ratio: 0.16 },
        { ageBand: "60s+", ratio: 0.14 },
      ],
    },
    narrative: {
      summary:
        "목업 응답입니다. 모델 서버가 연결되면 실제 데이터 기반 해석이 이 자리에 표시됩니다. " +
        "이 상권의 예상 매출 규모와 유동인구, 업종 생존율을 종합해 판단 근거를 제시합니다.",
      generator: "mock",
    },
    meta: {
      confidence: "low",
      sampleSize: 4,
      dataAsOf: MOCK_DATA_AS_OF,
      sources: MOCK_SOURCES,
    },
  };
}

export function mockHeatmap(industryCode: string): HeatmapResult {
  const industry = MOCK_INDUSTRIES.find((i) => i.code === industryCode);
  return {
    industryCode,
    industryName: industry?.name ?? null,
    sourceMode: "mock",
    dataAsOf: MOCK_DATA_AS_OF,
    survivalGranularity: "seoul_industry",
    cells: MOCK_SANGWONS.map((s, idx) => {
      const rand = seeded(s.code + industryCode.charCodeAt(5) * 17);
      const prob = 0.4 + rand() * 0.35;
      return {
        sangwonCode: s.code,
        sangwonName: s.name,
        gu: s.gu,
        lat: s.lat,
        lon: s.lon,
        survivalProbability: Math.round(prob * 1e4) / 1e4,
        monthlyEstimateKRW: Math.round((3 + rand() * 15) * 1e8),
        salesPercentile: Math.round(((idx + 1) / MOCK_SANGWONS.length) * 1000) / 10,
        grade: gradeOf(prob),
      };
    }),
  };
}

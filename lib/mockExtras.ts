/**
 * mockExtras — 배후지 분석 '예시 데이터' 생성 (실데이터 미보유 항목)
 *
 * golmok(서울시 상권분석서비스)의 배후지 지표(주거·직장인구, 가구, 소득, 소비,
 * 임대시세, 집객시설)는 별도 데이터셋(상주인구·직장인구·소득소비 등)이 필요해
 * 현재 번들에 없다. 데모 완성도를 위해 UI는 먼저 만들되, 값은 상권 코드 기반
 * 결정적(seeded) 생성임을 명확히 표기한다 — UI에 "예시 데이터" 배지 필수.
 *
 * 실데이터 연동 시: 서빙 detail에 hinterland 필드를 추가하고 이 파일을 제거한다.
 */

export type HinterlandMock = {
  /** 주거인구 (명) */
  residents: number;
  /** 직장인구 (명) */
  workers: number;
  /** 가구 수 */
  households: number;
  /** 아파트 가구 비율 (0~1) */
  aptRatio: number;
  /** 소득 분위 (1~10) */
  incomeDecile: number;
  /** 1층 환산 임대료 (3.3㎡당 월, 원) */
  rentPer33m2: number;
  /** 소비 카테고리 비중 (합 1) */
  consumption: { label: string; ratio: number }[];
  /** 집객시설 수 */
  facilities: { label: string; count: number }[];
};

/** mulberry32 — 상권 코드 시드 결정적 난수 (같은 상권 = 항상 같은 예시값) */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CONSUMPTION_LABELS = ["식료품·외식", "생활용품", "의료·건강", "여가·문화", "교육", "기타"];
const FACILITY_LABELS = ["학교", "병·의원", "교통시설", "유통점", "금융기관"];

export function mockHinterland(sangwonCode: number): HinterlandMock {
  const rand = mulberry32(sangwonCode);

  const residents = Math.round(6000 + rand() * 38000);
  const workers = Math.round(1500 + rand() * 55000);
  const households = Math.round(residents / (2.0 + rand() * 0.6));
  const aptRatio = Math.round((0.2 + rand() * 0.6) * 100) / 100;
  const incomeDecile = 4 + Math.floor(rand() * 6); // 4~9분위
  const rentPer33m2 = Math.round((90_000 + rand() * 160_000) / 1000) * 1000;

  // 소비 비중: 식료품·외식이 가장 크게, 나머지 랜덤 후 정규화
  const weights = [3.5 + rand() * 2, 1 + rand(), 0.6 + rand(), 0.6 + rand(), 0.4 + rand(), 0.5 + rand()];
  const wsum = weights.reduce((a, b) => a + b, 0);
  const consumption = CONSUMPTION_LABELS.map((label, i) => ({
    label,
    ratio: Math.round((weights[i] / wsum) * 1000) / 1000,
  }));

  const facilities = FACILITY_LABELS.map((label) => ({
    label,
    count: Math.round(1 + rand() * 14),
  }));

  return { residents, workers, households, aptRatio, incomeDecile, rentPer33m2, consumption, facilities };
}

/** 소득 분위 → 대략적 월소득 구간 문구 (데모 안내용) */
export function incomeDecileRange(decile: number): string {
  const base = 180 + (decile - 1) * 45; // 만원 단위 대략치
  return `월 ${base.toLocaleString()}~${(base + 45).toLocaleString()}만원대`;
}

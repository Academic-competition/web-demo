/**
 * mockExtras — 실데이터 미보유 구간의 '예시 데이터' 폴백
 *
 * 값은 상권/자치구 시드 결정적(seeded) 생성이며 **UI 에 "예시 데이터" 배지 필수**.
 *
 * ## 히스토리 — 배후지(⑦) 목업은 제거됨 (2026-07-29)
 *
 * golmok 벤치마크 때 ⑦ 배후지 8개 항목(주거·직장인구, 가구수, 아파트 비율, 소득분위,
 * 임대시세, 소비트렌드, 집객시설)을 `mockHinterland()` 로 채워 UI 를 먼저 만들었고,
 * 실데이터를 받아 `meta/hinterland.json.gz` + `/api/hinterland` 로 교체하면서 지웠다.
 *
 * 그 과정에서 **원본 데이터셋에 없어 항목 자체를 뺀 것들** (없는 값을 목업으로 채우지 않기로 함):
 *
 * - **소득분위**: `소득소비-상권배후지`(OA-15571) 에는 소득이 아니라 **지출 금액만** 있다
 *   (`지출_총금액` + 카테고리 9종). golmok 의 "소득수준 N분위" 는 다른 소스이며, 소비지출로
 *   소득을 역산하면 근거 없는 수치가 된다. 추후 소득 컬럼이 있는 데이터셋(예: `소득소비-상권`
 *   OA-21278)을 확인해 붙일 수 있다
 * - **총 가구 수**: `아파트-상권`(OA-15566) 은 아파트 세대수만 제공한다. 그래서 ⑦ 은
 *   "아파트 단지/세대" 로만 표기하고 '가구 수' 라는 라벨을 쓰지 않는다
 * - **임대시세**: 한국부동산원 R-ONE 별도 데이터. 정본 파이프라인(`re_*`)은 있으나 값 미보유
 *
 * 또 소비지출은 원본이 **2023Q4 이후 미공개**여서 다른 블록(2026Q1)과 기준 분기가 다르다.
 * 매출 데이터(2025Q1~)와 겹치는 분기가 0개라 타깃 누출 검증이 불가능해 **ML 에는 쓰지 않는다**.
 *
 * 남은 목업은 치안(`mockSafety`) 폴백 하나이며, 실데이터가 있으면 호출되지 않는다.
 */

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



// ------------------------------------------------------------------
// 치안 참고 '예시 데이터' — crime.csv 미보유 시 폴백 (SafetyDetail과 동일 형태)
// ------------------------------------------------------------------
export type SafetyMock = {
  year: string;
  guName: string | null;
  totalIncidents: number;
  byType: { label: string; count: number }[];
  rankAmongGus: number;
  guCount: number;
  seoulAvgIncidents: number;
  per100k: number;
  granularity: "gu";
};

/** 문자열 → 32bit 시드 (자치구명 기반 결정적 생성) */
function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function mockSafety(guName: string | null): SafetyMock {
  const rand = mulberry32(hashSeed(guName ?? "서울"));
  // 5대 범죄 연간 발생 — 절도·폭력이 대부분, 살인·강도는 극소 (자치구 규모의 그럴듯한 범위)
  const theft = Math.round(1200 + rand() * 2600);
  const violence = Math.round(1100 + rand() * 2300);
  const sexual = Math.round(120 + rand() * 380);
  const robbery = Math.round(2 + rand() * 10);
  const murder = Math.round(rand() * 4);
  const total = theft + violence + sexual + robbery + murder;
  return {
    year: "예시",
    guName,
    totalIncidents: total,
    byType: [
      { label: "살인", count: murder },
      { label: "강도", count: robbery },
      { label: "성범죄", count: sexual },
      { label: "절도", count: theft },
      { label: "폭력", count: violence },
    ],
    rankAmongGus: 1 + Math.floor(rand() * 25),
    guCount: 25,
    seoulAvgIncidents: Math.round(total * (0.85 + rand() * 0.3)),
    per100k: Math.round(700 + rand() * 700),
    granularity: "gu",
  };
}

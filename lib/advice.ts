/**
 * advice.ts — 종합 의견(①)의 "값 → 판단 → 조언" 조건부 문장 (규칙 기반, 결정적)
 *
 * 원칙:
 *  - **응답에 이미 있는 필드로만** 분기한다. 필요한 필드가 없으면 null 을 반환하고
 *    UI 는 문장을 생략한다 (없는 값을 지어내지 않는다 — 기존 정직성 원칙과 동일).
 *  - 문턱값은 이 파일 상단 상수에만 둔다 (UI 에 흩어지면 문구·판정이 갈라진다).
 *  - 톤: 단정·투자권유 금지. "확인이 필요합니다 / 유리합니다" 수준까지만.
 *    (전역 면책: 모든 수치는 참고 지표 — page.tsx 푸터)
 *
 * provenance: 이 문장들은 ① 종합 의견의 일부로 '규칙 기반' 분류에 속한다
 * (lib/provenance.ts — 신호등 판정과 같은 범주).
 */
import type { AnalyzeResult, RatioSlice } from "./contracts";

// ------------------------------------------------------------------
// 문턱값 (판단 기준을 바꿀 땐 여기만)
// ------------------------------------------------------------------
/** 매출 백분위: 이 이상이면 상위권 */
const REVENUE_TOP_PCT = 75;
/** 매출 백분위: 이 미만이면 하위권 */
const REVENUE_BOTTOM_PCT = 40;
/** 프랜차이즈 비중: 이 이상이면 브랜드 경쟁 신호 */
const FRANCHISE_HEAVY = 0.5;
/** 동일 업종 점포: 이 이하면 "선점 vs 수요부재" 양면 신호 */
const STORE_SPARSE = 3;
/** 점포당 매출 상권/구 비교: ±이 비율을 넘어야 의미 있는 차이로 본다 */
const PER_STORE_GAP = 0.1;
/** 주말(토+일) 유동 비중: 이 이상이면 주말형 (균등 기준 2/7 ≈ 0.286) */
const WEEKEND_HEAVY = 0.35;
/** 저녁·야간(17~24시) 유동 비중: 이 이상이면 저녁형 */
const EVENING_HEAVY = 0.4;

const sliceSum = (arr: RatioSlice[] | null | undefined, labels: string[]): number | null => {
  if (!arr?.length) return null;
  const hit = arr.filter((s) => labels.includes(s.label));
  if (!hit.length) return null;
  return hit.reduce((a, s) => a + s.ratio, 0);
};

// ------------------------------------------------------------------
// 매출 — 동일 업종 상권 간 백분위 3구간
// ------------------------------------------------------------------
export function revenueAdvice(percentile: number | null | undefined): string | null {
  if (percentile == null || !Number.isFinite(percentile)) return null;
  if (percentile >= REVENUE_TOP_PCT)
    return "매출 체력은 상위권 — 남은 변수는 비용·경쟁 조건 검증입니다.";
  if (percentile < REVENUE_BOTTOM_PCT)
    return "동일 업종 내 하위권 — 배후 수요(⑦)와 유동 흐름(⑤)에서 근거를 먼저 확인하세요.";
  return "중위권 — 입지 자체보다 운영 전략이 성패를 가르는 구간입니다.";
}

// ------------------------------------------------------------------
// 경쟁 — 점포 수 · 프랜차이즈 비중 · 점포당 매출(상권 vs 자치구)
//   여러 신호가 겹치면 더 구체적인 것 하나만 말한다 (불릿이 길어지면 아무도 안 읽는다)
// ------------------------------------------------------------------
export function competitionAdvice(result: AnalyzeResult): string | null {
  const comp = result.context?.competition;
  if (!comp || comp.storeCount == null) return null;

  if (comp.storeCount <= STORE_SPARSE)
    return "동일 업종이 거의 없습니다 — 선점 기회일 수도, 수요 부재 신호일 수도 있어 양쪽 검증이 필요합니다.";

  if (comp.franchiseRatio != null && comp.franchiseRatio >= FRANCHISE_HEAVY)
    return "프랜차이즈 중심의 자리 — 개인 창업이라면 브랜드 대비 차별화 요소가 필요합니다.";

  const ps = result.detail?.comparison?.perStoreSalesKRW;
  if (ps?.sangwon != null && ps?.gu != null && ps.gu > 0) {
    const gap = ps.sangwon / ps.gu - 1;
    if (gap >= PER_STORE_GAP)
      return "경쟁이 있어도 점포당 매출이 자치구 평균을 웃돌아 수요가 받쳐주는 편입니다.";
    if (gap <= -PER_STORE_GAP)
      return "점포당 매출이 자치구 평균을 밑돕니다 — 나눠먹기 부담을 ④에서 확인하세요.";
  }

  return "경쟁 밀도가 특이 신호 없이 평이한 수준입니다.";
}

// ------------------------------------------------------------------
// 인구 — 요일·시간대 분포 (detail.footTraffic 없으면 생략)
// ------------------------------------------------------------------
export function footTrafficAdvice(result: AnalyzeResult): string | null {
  const ft = result.detail?.footTraffic;
  if (!ft) return null;

  const weekend = sliceSum(ft.byDay, ["토", "일"]);
  if (weekend != null && weekend >= WEEKEND_HEAVY)
    return `주말 유동 비중이 ${(weekend * 100).toFixed(0)}%로 높습니다 — 주말 중심 운영·메뉴 구성이 유리합니다.`;

  const evening = sliceSum(ft.byTime, ["17-21", "21-24"]);
  if (evening != null && evening >= EVENING_HEAVY)
    return `저녁·야간(17~24시) 유동이 ${(evening * 100).toFixed(0)}%를 차지합니다 — 영업시간 설계에 반영하세요.`;

  const morning = sliceSum(ft.byTime, ["06-11"]);
  if (morning != null && morning >= 0.3)
    return `오전(06~11시) 유동 비중이 ${(morning * 100).toFixed(0)}%로 높습니다 — 출근·오전 수요형 상권입니다.`;

  return null; // 특이 패턴 없음 → 값만 보여주고 조언 생략
}

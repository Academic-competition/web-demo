/**
 * provenance.ts — 리포트 숫자의 '출처 계보' 파생
 *
 * "이 서비스는 그냥 CSV 조회 아니냐"에 답하기 위한 장치. 리포트 블록별로 그 값이
 * **① ML 예측 · ② 통계 가공 · ③ 실측 집계 · ④ 규칙 기반 · ⑤ 예시** 중 무엇인지 분류한다.
 *
 * ⚠️ 분류는 **응답에 실제로 담긴 필드**(`revenue.basis`, `survival.basis`, `granularity`,
 *    `sourceMode`, `asOf`)에서 파생한다 — 화면에 하드코딩하지 않는다. 모델 쪽에서 산출
 *    방식이 바뀌면 basis 값이 바뀌고, 그러면 이 표도 따라 바뀌어야 정상이다.
 *    (basis 문자열의 정본: 모델 저장소 `tools/export_web_static.py` / `api/schemas.py`)
 */
import type { AnalyzeResult, BuzzResult, SourceMode } from "./contracts";

export type ProvenanceKind = "ml" | "stat" | "measured" | "rule" | "generated" | "example";

export const PROVENANCE_LABEL: Record<ProvenanceKind, string> = {
  ml: "ML 예측",
  stat: "통계 가공",
  measured: "실측 집계",
  rule: "규칙 기반",
  generated: "생성형 AI",
  example: "예시 데이터",
};

export type ProvenanceRow = {
  /** 리포트 섹션 번호와 블록 이름 */
  block: string;
  kind: ProvenanceKind;
  /** 그 값이 어떻게 만들어졌는지 한 줄 */
  how: string;
  /** 판단 근거가 된 응답 필드 (감사 가능하게 남긴다) */
  from: string;
};

/** basis 문자열 → 사람이 읽는 설명. 모르는 값이면 그대로 노출한다(숨기지 않음). */
function revenueHow(basis: string | undefined, scaleLabel: string): string {
  if (basis === "per_store_predicted") {
    return `학습된 회귀모델이 예측한 점포당 매출 (${scaleLabel})`;
  }
  return `모델 산출값 (basis=${basis ?? "unknown"} · ${scaleLabel})`;
}

function survivalHow(basis: string, granularity: string): string {
  const scope = granularity === "seoul_industry" ? "업종 단위" : "상권×업종 단위";
  if (basis === "empirical_closure_rate_shrunk") {
    return `실측 폐업률 3년 환산 + 소표본 축소추정 (${scope})`;
  }
  if (basis === "empirical_closure_rate") {
    return `실측 폐업률 3년 환산 (${scope}, 축소추정 없음)`;
  }
  return `basis=${basis} (${scope})`;
}

export function provenanceOf(
  result: AnalyzeResult,
  extra?: {
    /** /api/safety sourceMode — 실측이면 measured, 목업이면 example */
    safety?: SourceMode | null;
    /** /api/hinterland sourceMode */
    hinterland?: SourceMode | null;
    /** 배후지 소비지출 기준 분기 (다른 블록과 다르면 표에 드러낸다) */
    spendingAsOf?: string | null;
    /** 상권 내 기회 순위가 리포트에 표시됐는지 */
    hasRanking?: boolean;
  }
): ProvenanceRow[] {
  const rows: ProvenanceRow[] = [];
  const mocked = result.sourceMode === "mock";

  // ── ML 예측 ────────────────────────────────────────────────
  if (result.revenue) {
    // 예측 매출의 basis 는 계약에 별도 필드가 없어 scaleLabel 로 성질을 구분한다
    // ("점포당 평균" = per_store_predicted 경로). 계약에 revenue.basis 가 생기면 그걸 쓸 것.
    const perStore = result.revenue.scaleLabel.includes("점포당");
    rows.push({
      block: "③ 예상 매출",
      kind: mocked ? "example" : "ml",
      how: mocked
        ? "모델·정적 파일 모두 실패해 목업 값"
        : revenueHow(perStore ? "per_store_predicted" : undefined, result.revenue.scaleLabel),
      from: `revenue.scaleLabel="${result.revenue.scaleLabel}" · sourceMode=${result.sourceMode}`,
    });
  }

  // ── 통계 가공 ──────────────────────────────────────────────
  if (result.survival) {
    rows.push({
      block: "② 생존 전망",
      kind: mocked ? "example" : "stat",
      how: survivalHow(result.survival.basis, result.survival.granularity),
      from: `survival.basis="${result.survival.basis}" · granularity="${result.survival.granularity}"`,
    });
  }
  if (result.revenue?.percentileInSangwon != null) {
    rows.push({
      block: "③ 동일업종 내 상위 %",
      kind: "stat",
      how: "같은 업종 전체 상권 중 예측 매출 순위 백분위",
      from: "revenue.percentileInSangwon",
    });
  }
  if (result.revenue?.accuracy) {
    // 예측값이 아니라 채점 결과 — 모델 성적표(test_breakdown)를 그대로 노출
    rows.push({
      block: "③ 예측 신뢰도(오차)",
      kind: "stat",
      how: `이 업종의 test 분기 평균 오차 SMAPE ${result.revenue.accuracy.smapePct}% — 모델 성적표 채점 결과`,
      from: `revenue.accuracy (n=${result.revenue.accuracy.sampleN ?? "?"})`,
    });
  }
  if (result.diagnosis) {
    rows.push({
      block: "① 모델 종합진단",
      kind: "stat",
      how: `업종 내 백분위 성분의 정책 가중합 ${result.diagnosis.overallScore.toFixed(0)}점${result.diagnosis.grade ? ` (${result.diagnosis.grade})` : ""} — 가중치는 파일에 실려 온 서비스 정책값`,
      from: `diagnosis.overallScore · components ${result.diagnosis.components?.length ?? 0}개`,
    });
  }
  if (result.context?.density) {
    rows.push({
      block: "⑤ 인구 밀도",
      kind: "stat",
      how: "실측 인구 ÷ 상권 영역 면적(명/km²) 단순 환산",
      from: "context.density (영역_면적 기준)",
    });
  }
  if (result.detail?.independent) {
    const ind = result.detail.independent;
    rows.push({
      block: "④ 독립점포 관점 매출",
      kind: "stat",
      how:
        ind.kSource === "industry_fit"
          ? `프랜차이즈 배수 k=${ind.kUsed?.toFixed(2)} 를 서울 데이터 회귀로 추정해 독립점포 몫을 분리 (ML 예측 아님)`
          : "업종 k 추정이 품질 게이트 미통과 → 고정 k 가정 시나리오만 제시 (값을 지어내지 않음)",
      from: `detail.independent.kSource="${ind.kSource}"`,
    });
  }
  if (extra?.hasRanking) {
    rows.push({
      block: "① 상권 내 기회 순위",
      kind: "stat",
      how: "종합진단 점수(백분위 가중합)를 상권 안에서 업종끼리 재정렬",
      from: "by-sangwon 산출물의 opportunityScore",
    });
  }

  // ── 실측 집계 ──────────────────────────────────────────────
  const d = result.detail;
  if (d?.sales) {
    rows.push({
      block: "③ 매출 분포·추이",
      kind: "measured",
      how: "카드 결제 기반 추정 원천값 — 요일·시간대·성별·연령 비중, 분기 추이",
      from: `detail.sales.basis="${d.sales.basis}" · trend ${d.sales.trend.length}분기`,
    });
  }
  if (d?.store) {
    rows.push({
      block: "④ 점포·개폐업",
      kind: "measured",
      how: "점포 수·프랜차이즈·개업/폐업 실측" +
        (result.context?.competition?.correction ? " (점포 수는 원천 항등식으로 역산 보정)" : ""),
      from: result.context?.competition?.correction
        ? "detail.store + context.competition.correction"
        : "detail.store",
    });
  }
  if (d?.footTraffic) {
    rows.push({
      block: "⑤ 유동인구",
      kind: "measured",
      how: `길단위 유동인구 실측 (${d.footTraffic.granularity === "sangwon" ? "상권 단위" : d.footTraffic.granularity})`,
      from: `detail.footTraffic.granularity="${d.footTraffic.granularity}"`,
    });
  }
  if (d?.comparison) {
    rows.push({
      block: "④ 상권/자치구/서울 비교",
      kind: "measured",
      how: "상권 단위 원천값을 자치구·서울로 합산",
      from: "detail.comparison",
    });
  }

  // ── 외부 데이터 (별도 API) ─────────────────────────────────
  if (d?.safety) {
    // 서빙 산출물에 실린 치안 상세 — ResultPanel 의 1순위 소스와 동일한 판정
    rows.push({
      block: "⑥ 치안",
      kind: "measured",
      how: `경찰청 5대 범죄 실측 (${d.safety.year}년 · ${d.safety.granularity === "gu" ? "자치구 단위" : d.safety.granularity}) — 모델 저장소 원본`,
      from: "detail.safety",
    });
  } else if (extra?.safety) {
    rows.push({
      block: "⑥ 치안",
      kind: extra.safety === "mock" ? "example" : "measured",
      how:
        extra.safety === "mock"
          ? "범죄 통계 미보유 → 자치구명 시드 예시 값"
          : "경찰청 5대 범죄·CCTV 실측 → 자치구 백분위 가중합(안전점수)",
      from: `/api/safety sourceMode=${extra.safety}`,
    });
  }
  if (result.detail?.realEstate) {
    rows.push({
      block: "⑦ 임대 시세",
      kind: "measured",
      how: `R-ONE 소규모 상가 임대동향 — ${result.detail.realEstate.joinMethod === "gu_mean" ? "자치구 평균값 조인 (상권 단위 실측 아님)" : `조인: ${result.detail.realEstate.joinMethod ?? "?"}`}`,
      from: `detail.realEstate.joinMethod="${result.detail.realEstate.joinMethod ?? "?"}"`,
    });
  }
  if (extra?.hinterland) {
    rows.push({
      block: "⑦ 배후지",
      kind: extra.hinterland === "mock" ? "example" : "measured",
      how:
        extra.hinterland === "mock"
          ? "배후지 데이터 없음"
          : "상주·직장인구·아파트·집객시설 실측" +
            (extra.spendingAsOf ? ` (소비지출만 ${extra.spendingAsOf} 기준)` : ""),
      from: `/api/hinterland sourceMode=${extra.hinterland}`,
    });
  }

  // ── 규칙 기반 ──────────────────────────────────────────────
  if (result.context?.competition?.marketStage) {
    rows.push({
      block: "① 시장 단계",
      kind: "rule",
      how: `${result.context.competition.marketStage} — 개업률·폐업률·점포수 증감의 문턱값 판정 (서비스 정책)`,
      from: `context.competition.marketStage="${result.context.competition.marketStage}"`,
    });
  }
  if (result.sangwon.type) {
    rows.push({
      block: "헤더 상권 유형",
      kind: "rule",
      how: `${result.sangwon.type} — ${result.sangwon.typeBasis ?? "규칙 기반 분류"}`,
      from: `sangwon.type="${result.sangwon.type}"`,
    });
  }
  if (result.survival?.grade) {
    rows.push({
      block: "① 신호등 판정",
      kind: "rule",
      how: "생존율 문턱값 판정 (safe ≥ 0.60 / caution ≥ 0.45) — 웹 서버가 주입",
      from: `survival.grade="${result.survival.grade}" (gradeOf)`,
    });
  }
  // diagnosis.strengths/risks 행 없음 — 화면에 렌더하지 않는다 (불릿과 중복).
  // 계보는 '화면에 보이는 숫자의 출처'를 설명하는 표이므로 렌더 안 하는 항목은 넣지 않는다.
  if (result.narrative) {
    rows.push({
      block: "① 해석 문장",
      kind: result.narrative.generator === "rule_based" ? "rule" : "ml",
      how:
        result.narrative.generator === "rule_based"
          ? "지표 조건부 문장 템플릿 (LLM 아님)"
          : `생성기: ${result.narrative.generator}`,
      from: `narrative.generator="${result.narrative.generator}"`,
    });
  }

  return rows;
}

/**
 * SNS 언급 분석(베타) 계보 행 — provenanceOf 와 분리된 이유:
 * 계보 표는 analyze 응답 시점에 만들어지지만 이 블록은 사용자가 버튼을 눌러야
 * 실행된다(옵트인·LLM 과금). 실행 전에 행을 넣으면 "안 쓴 것을 썼다"는 거짓이
 * 되므로, useBuzz 가 성공 응답을 받은 시점에 이 행을 만들어 인스펙터에 남긴다.
 * 분류는 응답 필드(model·postCount)에서 파생 — 하드코딩 아님.
 */
export function buzzProvenanceRow(buzz: BuzzResult): ProvenanceRow {
  return {
    block: "SNS 언급 분석 (베타)",
    kind: "generated",
    how: `네이버 블로그·카페 ${buzz.postCount ?? "?"}건 실시간 수집 → ${buzz.model ?? "LLM"} 생성 요약 — 비결정적(실행마다 다를 수 있음), 수집 원문 공개`,
    from: `buzz.model="${buzz.model}" · postCount=${buzz.postCount} · collectedAt=${buzz.collectedAt}`,
  };
}

/** 계보 요약 — "ML 1 · 통계 3 · 실측 5 · 규칙 2" 형태 */
export function provenanceSummary(rows: ProvenanceRow[]): string {
  const order: ProvenanceKind[] = ["ml", "stat", "measured", "rule", "generated", "example"];
  return order
    .map((k) => ({ k, n: rows.filter((r) => r.kind === k).length }))
    .filter((x) => x.n > 0)
    .map((x) => `${PROVENANCE_LABEL[x.k]} ${x.n}`)
    .join(" · ");
}

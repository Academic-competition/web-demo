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
import type { AnalyzeResult, SourceMode } from "./contracts";

export type ProvenanceKind = "ml" | "stat" | "measured" | "rule" | "example";

export const PROVENANCE_LABEL: Record<ProvenanceKind, string> = {
  ml: "ML 예측",
  stat: "통계 가공",
  measured: "실측 집계",
  rule: "규칙 기반",
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
  if (extra?.safety) {
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
  if (result.survival?.grade) {
    rows.push({
      block: "① 신호등 판정",
      kind: "rule",
      how: "생존율 문턱값 판정 (safe ≥ 0.60 / caution ≥ 0.45) — 웹 서버가 주입",
      from: `survival.grade="${result.survival.grade}" (gradeOf)`,
    });
  }
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

/** 계보 요약 — "ML 1 · 통계 3 · 실측 5 · 규칙 2" 형태 */
export function provenanceSummary(rows: ProvenanceRow[]): string {
  const order: ProvenanceKind[] = ["ml", "stat", "measured", "rule", "example"];
  return order
    .map((k) => ({ k, n: rows.filter((r) => r.kind === k).length }))
    .filter((x) => x.n > 0)
    .map((x) => `${PROVENANCE_LABEL[x.k]} ${x.n}`)
    .join(" · ");
}

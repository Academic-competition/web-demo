/**
 * GET /api/safety — 자치구 안전 종합점수 ('치안 반영' 토글용)
 *
 * 실측 파일(model-exports/meta/safety-scores.json) 우선, 없으면 결정적 목업
 * (sourceMode:"mock" — UI가 예시 배지를 붙인다). 산식은 모델 정본과 동일.
 */
import { NextResponse } from "next/server";

import { SafetyScoresResult } from "@/lib/contracts";
import { safetyScores } from "@/lib/normalize";

export async function GET() {
  try {
    const result = await safetyScores();
    return NextResponse.json(SafetyScoresResult.parse(result));
  } catch (err) {
    console.error("[/api/safety] 실패:", err);
    return NextResponse.json(
      { message: "안전점수를 불러오지 못했습니다." },
      { status: 502 }
    );
  }
}

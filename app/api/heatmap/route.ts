/**
 * GET /api/heatmap?industryCode= — 업종 먼저 모드 히트맵 (UC-002)
 *
 * 사전계산 정적 JSON(모델 레포 exports/)을 읽어 즉시 응답 — 실시간 추론 없음.
 * 파일이 없으면 목업 폴백 (sourceMode: "mock").
 */
import { NextRequest, NextResponse } from "next/server";

import { HeatmapResult } from "@/lib/contracts";
import { heatmapViaFile } from "@/lib/normalize";
import { mockHeatmap } from "@/lib/mock";

const MOCK_FALLBACK = process.env.MOCK_FALLBACK !== "false";

export async function GET(req: NextRequest) {
  const industryCode = req.nextUrl.searchParams.get("industryCode");
  if (!industryCode) {
    return NextResponse.json({ message: "industryCode 쿼리가 필요합니다." }, { status: 400 });
  }

  try {
    const result = await heatmapViaFile(industryCode);
    return NextResponse.json(HeatmapResult.parse(result), {
      headers: { "Cache-Control": "public, max-age=300" },
    });
  } catch (err) {
    console.error("[/api/heatmap] 사전계산 그리드 로드 실패:", err);
    if (MOCK_FALLBACK) {
      return NextResponse.json(HeatmapResult.parse(mockHeatmap(industryCode)));
    }
    return NextResponse.json(
      { message: "히트맵 데이터를 불러오지 못했습니다." },
      { status: 502 }
    );
  }
}

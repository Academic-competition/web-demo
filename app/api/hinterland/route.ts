/**
 * GET /api/hinterland?sangwonCode=... — 배후지 실측 (리포트 ⑦)
 *
 * 상주인구·직장인구·아파트·집객시설·소비지출. 항목별 기준 분기(asOf)가 다르므로
 * UI 는 각 블록에 그 값을 표기한다. 산출물이 없으면 sourceMode:"mock" 으로 응답한다.
 */
import { NextRequest, NextResponse } from "next/server";

import { HinterlandResult } from "@/lib/contracts";
import { hinterland } from "@/lib/normalize";

export async function GET(req: NextRequest) {
  const code = Number(req.nextUrl.searchParams.get("sangwonCode"));
  if (!Number.isInteger(code)) {
    return NextResponse.json(
      { message: "sangwonCode 가 필요합니다." },
      { status: 400 }
    );
  }
  try {
    const result = await hinterland(code);
    return NextResponse.json(HinterlandResult.parse(result));
  } catch (err) {
    console.error("[/api/hinterland] 실패:", err);
    return NextResponse.json(
      { message: "배후지 정보를 불러오지 못했습니다." },
      { status: 502 }
    );
  }
}

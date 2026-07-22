/**
 * GET /api/top-industries?sangwonCode= — 지역 우선 플로우 (위치 먼저)
 *
 * 특정 상권을 고르면 그 상권의 업종별 요약(매출·생존율·경쟁·기회점수)을 랭킹으로 반환.
 * 모델 서버(1차) → 정적 사전계산 by-sangwon.json.gz(2차). grade는 normalize가 주입.
 */
import { NextRequest, NextResponse } from "next/server";

import { TopIndustriesResult } from "@/lib/contracts";
import { topIndustriesViaModel, topIndustriesViaFile } from "@/lib/normalize";

export async function GET(req: NextRequest) {
  const codeParam = req.nextUrl.searchParams.get("sangwonCode");
  const code = Number(codeParam);
  if (!codeParam || !Number.isInteger(code)) {
    return NextResponse.json({ message: "sangwonCode 쿼리(정수)가 필요합니다." }, { status: 400 });
  }

  try {
    const result = await topIndustriesViaModel(code);
    return NextResponse.json(TopIndustriesResult.parse(result));
  } catch (modelErr) {
    try {
      const result = await topIndustriesViaFile(code);
      return NextResponse.json(TopIndustriesResult.parse(result), {
        headers: { "Cache-Control": "public, max-age=300" },
      });
    } catch (fileErr) {
      console.error("[/api/top-industries] model·file 폴백 모두 실패:", modelErr, fileErr);
      return NextResponse.json(
        { message: "해당 상권의 업종 데이터를 불러오지 못했습니다." },
        { status: 502 }
      );
    }
  }
}

/**
 * GET /api/meta — 업종/상권 목록 (드롭다운·좌표→상권 매핑용)
 *
 * 모델 서버(1차) → 배치 산출물 파일(2차) → 목업(3차) 순 폴백.
 */
import { NextResponse } from "next/server";

import { MetaResult } from "@/lib/contracts";
import { metaViaModel, metaViaFile } from "@/lib/normalize";
import { mockMeta } from "@/lib/mock";

export async function GET() {
  try {
    const result = await metaViaModel();
    return NextResponse.json(MetaResult.parse(result));
  } catch {
    // 모델 서버가 없어도 배치 산출물로 동작
  }
  try {
    const result = await metaViaFile();
    return NextResponse.json(MetaResult.parse(result));
  } catch (err) {
    console.error("[/api/meta] 모델 서버·배치 파일 모두 실패:", err);
    return NextResponse.json(MetaResult.parse(mockMeta()));
  }
}

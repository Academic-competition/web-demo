/**
 * GET /api/rankings — 상권 단위 지표 랭킹 재료 (golmok '뜨는 상권' 대응)
 *
 * 지표 5종(점포수·매출·유동인구·상주·직장인구)의 상권별 값·직전 분기 대비
 * 증감률·소표본(lowBase) 판정. 전부 파이프라인 산출이며 웹은 정렬·표시만 한다.
 * 전체 번들을 한 번에 내려 클라이언트 토글이 재요청 없이 즉답하게 한다
 * (1,650 상권 × 5지표 — gzip 전송 ~90KB).
 *
 * 목업 폴백이 없다 — 예시 순위를 지어내는 것은 정직성 원칙에 반한다.
 * 산출물이 없으면 502 로 실패하고 UI 가 패널을 숨긴다.
 */
import { NextResponse } from "next/server";

import { RankingsResult } from "@/lib/contracts";
import { rankings } from "@/lib/normalize";

export async function GET() {
  try {
    const result = await rankings();
    return NextResponse.json(RankingsResult.parse(result));
  } catch (err) {
    console.error("[/api/rankings] 실패:", err);
    return NextResponse.json(
      { message: "상권 랭킹을 불러오지 못했습니다." },
      { status: 502 }
    );
  }
}

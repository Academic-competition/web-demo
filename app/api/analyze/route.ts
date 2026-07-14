/**
 * POST /api/analyze — 단건 분석 (UC-001, UC-004, UC-006)
 *
 * 요청 검증(zod) → 모델 서버 호출 → 내부 계약으로 정규화.
 * 모델 서버 오류/타임아웃 시 목업 폴백 (sourceMode: "mock" 으로 명시).
 */
import { NextRequest, NextResponse } from "next/server";

import { AnalyzeRequest, AnalyzeResult, type DebugTrace } from "@/lib/contracts";
import { analyzeViaModel, analyzeViaFile, MODEL_SERVER_URL } from "@/lib/normalize";
import { mockAnalyze } from "@/lib/mock";

const MOCK_FALLBACK = process.env.MOCK_FALLBACK !== "false";

export async function POST(req: NextRequest) {
  let parsed: AnalyzeRequest;
  try {
    parsed = AnalyzeRequest.parse(await req.json());
  } catch {
    return NextResponse.json(
      { message: "요청 형식이 올바르지 않습니다. { sangwonCode: number, industryCode: string }" },
      { status: 400 }
    );
  }

  try {
    const result = await analyzeViaModel(parsed);
    return NextResponse.json(AnalyzeResult.parse(result));
  } catch (modelErr) {
    // 1차 폴백: 정적 사전계산 값(실데이터) — 모델 서버 미연결(예: Vercel)에서도 동작
    try {
      const result = await analyzeViaFile(parsed);
      return NextResponse.json(AnalyzeResult.parse(result));
    } catch (fileErr) {
      console.error("[/api/analyze] model·file 폴백 모두 실패:", modelErr, fileErr);
      if (MOCK_FALLBACK) {
        // 목업 폴백에도 실패 원인 트레이스를 실어 인스펙터 콘솔에서 확인 가능하게
        const trace: DebugTrace = (modelErr as { trace?: DebugTrace })?.trace ?? {
          externalUrl: `${MODEL_SERVER_URL}/predict`,
          externalRequest: parsed,
          externalResponse: null,
          externalStatus: null,
          externalDurationMs: 0,
          error: modelErr instanceof Error ? modelErr.message : String(modelErr),
        };
        const mocked = mockAnalyze(parsed);
        mocked.debug = trace;
        return NextResponse.json(AnalyzeResult.parse(mocked));
      }
      return NextResponse.json(
        { message: "일시적으로 분석 결과를 불러오지 못했습니다. 잠시 후 다시 시도해주세요." },
        { status: 502 }
      );
    }
  }
}

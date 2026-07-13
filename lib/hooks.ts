"use client";
/**
 * hooks.ts — 프론트 데이터 훅 (TanStack Query)
 * 프론트는 내부 계약(/api/*)에만 의존한다.
 * 모든 요청/응답은 인스펙터 콘솔(lib/inspector.ts)에 기록된다.
 */
import { useMutation, useQuery } from "@tanstack/react-query";

import type {
  AnalyzeRequest,
  AnalyzeResult,
  HeatmapResult,
  MetaResult,
} from "./contracts";
import { inspect } from "./inspector";

export function useMeta() {
  return useQuery<MetaResult>({
    queryKey: ["meta"],
    queryFn: async () => {
      const started = Date.now();
      const res = await fetch("/api/meta");
      if (!res.ok) throw new Error("meta 로드 실패");
      const data: MetaResult = await res.json();
      inspect(
        "file",
        `GET /api/meta — 업종 ${data.industries.length}개 · 상권 ${data.sangwons.length}개 (${data.sourceMode})`,
        { sourceMode: data.sourceMode, dataAsOf: data.dataAsOf },
        Date.now() - started
      );
      return data;
    },
    staleTime: Infinity,
  });
}

export function useAnalyze() {
  return useMutation<AnalyzeResult, Error, AnalyzeRequest>({
    mutationFn: async (req) => {
      inspect("req", `POST /api/analyze — 상권 ${req.sangwonCode} × ${req.industryCode}`, req);
      const started = Date.now();

      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        inspect("err", `분석 실패 — HTTP ${res.status}`, body, Date.now() - started);
        throw new Error(body?.message ?? "분석 요청에 실패했습니다.");
      }
      const data: AnalyzeResult = await res.json();
      const totalMs = Date.now() - started;

      // 모델 서버와의 외부 통신 원문 (route handler가 debug로 내려줌)
      if (data.debug) {
        const failed = !!data.debug.error;
        inspect(
          failed ? "err" : "model",
          failed
            ? `모델 서버 호출 실패 → 목업 폴백: ${data.debug.error}`
            : `POST ${data.debug.externalUrl} → HTTP ${data.debug.externalStatus}`,
          { 외부_요청: data.debug.externalRequest, 외부_응답_원문: data.debug.externalResponse },
          data.debug.externalDurationMs
        );
      }

      inspect(
        "res",
        `정규화 응답 — status=${data.status}` +
          (data.survival ? ` · 생존율 ${(data.survival.probability * 100).toFixed(1)}% (${data.survival.grade})` : "") +
          (data.revenue ? ` · 매출 ${(data.revenue.monthlyEstimateKRW / 1e8).toFixed(1)}억` : "") +
          ` · ${data.sourceMode}`,
        {
          status: data.status,
          sourceMode: data.sourceMode,
          survival: data.survival,
          revenue: data.revenue,
          meta: data.meta,
        },
        totalMs
      );
      return data;
    },
  });
}

export function useHeatmap(industryCode: string | null, enabled: boolean) {
  return useQuery<HeatmapResult>({
    queryKey: ["heatmap", industryCode],
    queryFn: async () => {
      inspect("req", `GET /api/heatmap?industryCode=${industryCode}`);
      const started = Date.now();
      const res = await fetch(`/api/heatmap?industryCode=${industryCode}`);
      if (!res.ok) {
        inspect("err", `히트맵 로드 실패 — HTTP ${res.status}`, undefined, Date.now() - started);
        throw new Error("히트맵 로드 실패");
      }
      const data: HeatmapResult = await res.json();
      inspect(
        "file",
        `히트맵 ${data.industryName ?? data.industryCode} — ${data.cells.length}개 상권 (${data.sourceMode}, 사전계산)`,
        data.debug ?? { sourceMode: data.sourceMode, dataAsOf: data.dataAsOf },
        Date.now() - started
      );
      return data;
    },
    enabled: enabled && !!industryCode,
    staleTime: 5 * 60 * 1000,
  });
}

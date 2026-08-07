"use client";
/**
 * hooks.ts — 프론트 데이터 훅 (TanStack Query)
 * 프론트는 내부 계약(/api/*)에만 의존한다.
 * 모든 요청/응답은 인스펙터 콘솔(lib/inspector.ts)에 기록된다.
 */
import { useMutation, useQueries, useQuery } from "@tanstack/react-query";

import type {
  AnalyzeRequest,
  AnalyzeResult,
  BuzzResult,
  HeatmapResult,
  HinterlandResult,
  MetaResult,
  RankingsResult,
  SafetyScoresResult,
  SourceMode,
  TopIndustriesResult,
} from "./contracts";
import { inspect } from "./inspector";
import { PROVENANCE_LABEL, buzzProvenanceRow, provenanceOf, provenanceSummary } from "./provenance";

/**
 * 외부 데이터(치안·배후지)의 최근 sourceMode.
 *
 * 계보 표는 analyze 응답만으로는 완성되지 않는다(⑥⑦ 은 별도 API). 훅끼리 상태를 주고받는
 * 대신, 각 훅이 응답을 받을 때 여기에 최근 값을 남기고 analyze 가 그걸 읽는다.
 * 순서가 어긋나면(치안이 아직 안 온 상태) 해당 행이 빠질 뿐이라 거짓을 만들지 않는다.
 */
const lastExternal: {
  safety: SourceMode | null;
  hinterland: SourceMode | null;
  spendingAsOf: string | null;
} = { safety: null, hinterland: null, spendingAsOf: null };

/**
 * 상권 비교 — 담아둔 (상권 × 업종) 조합을 각각 `/api/analyze` 로 가져온다.
 *
 * ⚠️ **웹은 비교용 수치를 새로 만들지 않는다.** 기존 분석 응답을 그대로 나란히 놓기만 하고,
 *    "누가 더 낫다" 같은 판단도 모델이 이미 준 값(백분위·등급·서울 대비)으로만 말한다.
 *    비교 전용 집계가 필요해지면 그건 모델/서빙 쪽에 요청할 것 —
 *    산식이 웹에 생기면 리포트와 비교 화면의 숫자가 갈라진다 (치안 산식에서 겪은 문제).
 */
export function useCompare(items: { sangwonCode: number; industryCode: string }[]) {
  return useQueries({
    queries: items.map((it) => ({
      queryKey: ["compare", it.sangwonCode, it.industryCode] as const,
      queryFn: async (): Promise<AnalyzeResult> => {
        const started = Date.now();
        const res = await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(it),
        });
        if (!res.ok) throw new Error("비교 대상 분석 실패");
        const data: AnalyzeResult = await res.json();
        inspect(
          "file",
          `비교 대상 로드 — ${data.sangwon.name ?? it.sangwonCode} × ${data.industry.name ?? it.industryCode} (${data.sourceMode})`,
          { sangwonCode: it.sangwonCode, industryCode: it.industryCode, status: data.status },
          Date.now() - started
        );
        return data;
      },
      staleTime: 5 * 60 * 1000,
    })),
  });
}

/**
 * 상권 지표 랭킹 — 초기 화면의 '뜨는 상권' 패널 (golmok 대응).
 * 값·증감·lowBase 는 파이프라인 산출 — 프론트는 정렬·TopN 슬라이스만 한다.
 * 실패 시 패널을 숨긴다 (목업 순위를 지어내지 않는다).
 */
export function useRankings(enabled: boolean) {
  return useQuery<RankingsResult>({
    queryKey: ["rankings"],
    queryFn: async () => {
      const started = Date.now();
      const res = await fetch("/api/rankings");
      if (!res.ok) throw new Error("상권 랭킹 로드 실패");
      const data: RankingsResult = await res.json();
      inspect(
        "file",
        `GET /api/rankings — 상권 ${data.rows.length}개 × 지표 ${Object.keys(data.metrics).length}종 (${data.sourceMode})`,
        data.debug ?? { sourceMode: data.sourceMode },
        Date.now() - started
      );
      return data;
    },
    enabled,
    staleTime: 30 * 60 * 1000, // 정적 산출물 — 세션 내 재요청 불필요
  });
}

/** 배후지 실측 — 리포트 ⑦ (상권이 정해지면 로드) */
export function useHinterland(sangwonCode: number | null) {
  return useQuery<HinterlandResult>({
    queryKey: ["hinterland", sangwonCode],
    queryFn: async () => {
      const started = Date.now();
      const res = await fetch(`/api/hinterland?sangwonCode=${sangwonCode}`);
      if (!res.ok) throw new Error("배후지 정보 로드 실패");
      const data: HinterlandResult = await res.json();
      lastExternal.hinterland = data.sourceMode;
      lastExternal.spendingAsOf = data.hinterland?.spending?.asOf ?? null;
      const blocks = data.hinterland
        ? Object.entries(data.hinterland).filter(([, v]) => v).length
        : 0;
      inspect(
        data.sourceMode === "mock" ? "err" : "file",
        `GET /api/hinterland — 배후지 ${blocks}개 블록 (${data.sourceMode})`,
        data.debug ?? { sourceMode: data.sourceMode },
        Date.now() - started
      );
      return data;
    },
    enabled: sangwonCode != null,
    staleTime: 5 * 60 * 1000,
  });
}

/** 자치구 안전점수 — '치안 반영' 토글용 (작고 정적이라 세션 내 1회 로드) */
export function useSafetyScores() {
  return useQuery<SafetyScoresResult>({
    queryKey: ["safety-scores"],
    queryFn: async () => {
      const started = Date.now();
      const res = await fetch("/api/safety");
      if (!res.ok) throw new Error("안전점수 로드 실패");
      const data: SafetyScoresResult = await res.json();
      lastExternal.safety = data.sourceMode;
      inspect(
        data.sourceMode === "mock" ? "err" : "file",
        `GET /api/safety — 자치구 ${Object.keys(data.byGu).length}개 안전점수 (${data.sourceMode}${data.sourceMode === "mock" ? " · 예시 데이터" : ` · ${data.year}`})`,
        data.debug ?? { sourceMode: data.sourceMode },
        Date.now() - started
      );
      return data;
    },
    staleTime: Infinity,
  });
}

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

      // ---- 데이터 계보 — 이 리포트의 어느 숫자가 ML 예측이고 어디가 실측인지 ----
      if (data.status === "ok") {
        const rows = provenanceOf(data, {
          safety: lastExternal.safety,
          hinterland: lastExternal.hinterland,
          spendingAsOf: lastExternal.spendingAsOf,
          hasRanking: true,
        });
        const ml = rows.filter((r) => r.kind === "ml");
        if (ml.length > 0) {
          inspect(
            "ml",
            `학습된 모델의 예측이 쓰인 곳 ${ml.length}개 — ${ml.map((r) => r.block).join(", ")}`,
            ml.map((r) => ({ 블록: r.block, 산출: r.how, 근거필드: r.from }))
          );
        }
        inspect(
          "res",
          `데이터 계보 — ${provenanceSummary(rows)}`,
          rows.map((r) => ({
            블록: r.block,
            분류: PROVENANCE_LABEL[r.kind],
            산출: r.how,
            근거필드: r.from,
          }))
        );
      }
      return data;
    },
  });
}

/**
 * SNS 언급 분석 (베타) — 리포트의 유일한 **생성형 AI** 데이터.
 *
 * enabled=false 로 시작해 사용자가 버튼을 눌러야 호출된다 — 요청마다 외부 API
 * (네이버 검색)와 LLM 과금이 발생하므로 자동 실행하지 않는다 (옵트인).
 * 결과는 결정적이지 않다: 같은 입력이라도 실행마다 요약이 다를 수 있고,
 * UI 는 이를 라벨로 상시 밝힌다. staleTime Infinity — 서버 캐시(6h)와 별개로
 * 세션 내 재호출을 막는다.
 */
export function useBuzz(
  params: {
    sangwonCode: number;
    industryCode: string;
    sangwonName: string | null;
    dong: string | null;
    industryName: string | null;
  } | null,
  enabled: boolean
) {
  return useQuery<BuzzResult>({
    queryKey: ["buzz", params?.sangwonCode, params?.industryCode],
    queryFn: async () => {
      const qs = new URLSearchParams({
        sangwonCode: String(params!.sangwonCode),
        industryCode: params!.industryCode,
        ...(params!.sangwonName ? { sangwonName: params!.sangwonName } : {}),
        ...(params!.dong ? { dong: params!.dong } : {}),
        ...(params!.industryName ? { industryName: params!.industryName } : {}),
      });
      inspect("req", `GET /api/buzz — SNS 수집·생성형 요약 (옵트인 실행)`, Object.fromEntries(qs));
      const started = Date.now();
      const res = await fetch(`/api/buzz?${qs}`);
      if (!res.ok) {
        inspect("err", `SNS 분석 실패 — HTTP ${res.status}`, undefined, Date.now() - started);
        throw new Error("SNS 분석 요청에 실패했습니다.");
      }
      const data: BuzzResult = await res.json();
      if (data.available) {
        // 계보: 이 블록만 '생성형 AI' — 규칙 기반 해석 문장과 다른 층임을 콘솔에도 남긴다
        const row = buzzProvenanceRow(data);
        inspect(
          "model",
          `생성형 요약 — Claude ${data.model} · 수집 ${data.postCount}건${data.cached ? " (서버 캐시)" : ""}`,
          {
            계보: { 블록: row.block, 분류: PROVENANCE_LABEL[row.kind], 산출: row.how, 근거필드: row.from },
            검색어: data.query,
            표본진단: data.summary?.representativeness,
            광고의심비율: data.summary?.adRatio,
          },
          Date.now() - started
        );
      } else {
        inspect("err", `SNS 분석 불가 — ${data.reason}`, data, Date.now() - started);
      }
      return data;
    },
    enabled: enabled && !!params,
    staleTime: Infinity,
    retry: false, // LLM 호출 — 실패 시 자동 재시도로 과금하지 않는다
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

/** 지역 우선(위치 먼저): 선택한 상권의 업종별 요약·랭킹 */
export function useTopIndustries(sangwonCode: number | null) {
  return useQuery<TopIndustriesResult>({
    queryKey: ["top-industries", sangwonCode],
    queryFn: async () => {
      inspect("req", `GET /api/top-industries?sangwonCode=${sangwonCode}`);
      const started = Date.now();
      const res = await fetch(`/api/top-industries?sangwonCode=${sangwonCode}`);
      if (!res.ok) {
        inspect("err", `상권 업종 랭킹 로드 실패 — HTTP ${res.status}`, undefined, Date.now() - started);
        throw new Error("상권 업종 랭킹을 불러오지 못했습니다.");
      }
      const data: TopIndustriesResult = await res.json();
      inspect(
        "file",
        `상권 업종 랭킹 — ${data.sangwon.name ?? sangwonCode} · ${data.industries.length}개 업종 (${data.sourceMode})`,
        data.debug ?? { sourceMode: data.sourceMode, dataAsOf: data.dataAsOf },
        Date.now() - started
      );
      return data;
    },
    enabled: sangwonCode != null,
    staleTime: 5 * 60 * 1000,
  });
}

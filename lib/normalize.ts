/**
 * normalize.ts — anti-corruption layer (서버 전용)
 *
 * 외부 계약(모델 서버, files/ANSWERS.md)이 어떤 형태든 여기서 내부 계약
 * (lib/contracts.ts)으로 정규화한다. 모델 스펙이 바뀌면 이 파일만 고친다.
 *
 * - grade(신호등) 판정: 여기서 수행 (모델은 확률만 반환)
 * - disclaimer / scaleNote: 여기서 강제 주입 (UI 누락 구조적 차단)
 * - 브라우저는 모델 서버를 직접 호출하지 않는다 (반드시 이 서버 경유)
 */
import fs from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";

import type {
  AnalyzeRequest,
  AnalyzeResult,
  HeatmapResult,
  MetaResult,
  TopIndustriesResult,
} from "./contracts";
import { gradeOf } from "./contracts";

export const MODEL_SERVER_URL = process.env.MODEL_SERVER_URL ?? "http://localhost:8000";
const MODEL_TIMEOUT_MS = Number(process.env.MODEL_TIMEOUT_MS ?? 8000);

/** 모델 레포의 배치 산출물(exports/) 위치 — 히트맵·메타의 1차 소스 */
const EXPORTS_DIR =
  process.env.MODEL_EXPORTS_DIR ?? path.join(process.cwd(), "model-exports");

const REVENUE_DISCLAIMER =
  "카드 결제 기반 추정치를 재추정한 상권 간 비교용 참고 지표입니다. 절대 금액 보장이 아닙니다.";
const REVENUE_SCALE_NOTE =
  "해당 상권 내 동일 업종 전체 점포의 합산 규모입니다 (1개 점포 매출 아님).";

// ------------------------------------------------------------------
// 모델 서버 호출
// ------------------------------------------------------------------
async function fetchModel(pathname: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`${MODEL_SERVER_URL}${pathname}`, {
    ...init,
    signal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`model server ${pathname} -> HTTP ${res.status}`);
  }
  return res.json();
}

/** fetchModel + 인스펙터 콘솔용 트레이스(외부 요청/응답 원문, 소요시간) 캡처 */
async function fetchModelTraced(
  pathname: string,
  requestBody: unknown,
  init?: RequestInit
): Promise<{ raw: unknown; trace: import("./contracts").DebugTrace }> {
  const url = `${MODEL_SERVER_URL}${pathname}`;
  const started = Date.now();
  const res = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
    cache: "no-store",
  });
  const durationMs = Date.now() - started;
  const raw = res.ok ? await res.json() : await res.text();
  if (!res.ok) {
    const err = new Error(`model server ${pathname} -> HTTP ${res.status}`) as Error & {
      trace?: import("./contracts").DebugTrace;
    };
    err.trace = {
      externalUrl: url,
      externalRequest: requestBody,
      externalResponse: typeof raw === "string" ? raw.slice(0, 500) : raw,
      externalStatus: res.status,
      externalDurationMs: durationMs,
      error: err.message,
    };
    throw err;
  }
  return {
    raw,
    trace: {
      externalUrl: url,
      externalRequest: requestBody,
      externalResponse: raw,
      externalStatus: res.status,
      externalDurationMs: durationMs,
      error: null,
    },
  };
}

// ------------------------------------------------------------------
// /predict 정규화
// ------------------------------------------------------------------
/* eslint-disable @typescript-eslint/no-explicit-any */
export async function analyzeViaModel(req: AnalyzeRequest): Promise<AnalyzeResult> {
  const externalRequest = { sangwonCode: req.sangwonCode, industryCode: req.industryCode };
  const { raw, trace } = (await fetchModelTraced("/predict", externalRequest, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(externalRequest),
  })) as { raw: any; trace: import("./contracts").DebugTrace };
  return normalizeAnalyze(raw, req, "live", trace);
}

/**
 * 정적 사전계산 값(model-exports/analyze/{업종}.json.gz)으로 분석 응답.
 * 모델 서버가 없을 때(예: Vercel 배포)의 폴백 — 실측 데이터를 그대로 서빙한다.
 * 나중에 MODEL_SERVER_URL 을 실서버로 지정하면 analyzeViaModel 이 우선 사용된다.
 */
export async function analyzeViaFile(req: AnalyzeRequest): Promise<AnalyzeResult> {
  if (!/^[A-Za-z0-9]+$/.test(req.industryCode)) {
    throw new Error(`잘못된 업종 코드: ${req.industryCode}`);
  }
  const file = path.join(EXPORTS_DIR, "analyze", `${req.industryCode}.json.gz`);
  const started = Date.now();
  const buf = await fs.readFile(file);
  const table = JSON.parse(zlib.gunzipSync(buf).toString("utf-8")) as Record<string, any>;
  const rawFromFile = table[String(req.sangwonCode)];
  const durationMs = Date.now() - started;

  const fileTrace: import("./contracts").DebugTrace = {
    externalUrl: `file://${file}`,
    externalRequest: { sangwonCode: req.sangwonCode, industryCode: req.industryCode },
    externalResponse: rawFromFile
      ? { note: "정적 사전계산 값 (모델 서버 미연결)", status: rawFromFile.status }
      : { note: "해당 상권×업종 조합 없음", status: "insufficient_data" },
    externalStatus: rawFromFile ? 200 : 404,
    externalDurationMs: durationMs,
    error: null,
  };

  const payload = rawFromFile ?? {
    status: "insufficient_data",
    sangwon: { code: req.sangwonCode },
    industry: { code: req.industryCode },
    meta: {},
  };
  return normalizeAnalyze(payload, req, "file", fileTrace);
}

/** 모델/파일 공통: 외부 raw 응답을 내부 계약(AnalyzeResult)으로 정규화 + grade/면책 주입 */
/** 상세 분석(detail) 흡수 — 실측 원천값. 필드가 없거나 형태가 다르면 null로 방어 */
function packDetail(raw: any): AnalyzeResult["detail"] {
  if (!raw || typeof raw !== "object") return null;

  const slices = (arr: any): { label: string; ratio: number }[] | null =>
    Array.isArray(arr) && arr.length
      ? arr.map((s: any) => ({ label: String(s.label), ratio: Number(s.ratio ?? 0) }))
      : null;
  const trend = (arr: any): { quarter: string; value: number }[] =>
    Array.isArray(arr)
      ? arr
          .filter((p: any) => p && p.value != null)
          .map((p: any) => ({ quarter: String(p.quarter), value: Number(p.value) }))
      : [];
  const num = (v: any): number | null => (v != null && Number.isFinite(Number(v)) ? Number(v) : null);

  return {
    sales: raw.sales
      ? {
          monthlyTotalKRW: num(raw.sales.monthlyTotalKRW),
          perStoreKRW: num(raw.sales.perStoreKRW),
          byDay: slices(raw.sales.byDay),
          byTime: slices(raw.sales.byTime),
          byGender: slices(raw.sales.byGender),
          byAge: slices(raw.sales.byAge),
          trend: trend(raw.sales.trend),
          prev: num(raw.sales.prev),
          yoy: num(raw.sales.yoy),
          basis: String(raw.sales.basis ?? "unknown"),
        }
      : null,
    store: raw.store
      ? {
          openCount: num(raw.store.openCount),
          openRate: num(raw.store.openRate),
          closeCount: num(raw.store.closeCount),
          closeRate: num(raw.store.closeRate),
          franchiseCount: num(raw.store.franchiseCount),
          generalCount: num(raw.store.generalCount),
          trend: trend(raw.store.trend),
          prev: num(raw.store.prev),
          yoy: num(raw.store.yoy),
        }
      : null,
    footTraffic: raw.footTraffic
      ? {
          byDay: slices(raw.footTraffic.byDay),
          byTime: slices(raw.footTraffic.byTime),
          byGender: slices(raw.footTraffic.byGender),
          trend: trend(raw.footTraffic.trend),
          prev: num(raw.footTraffic.prev),
          yoy: num(raw.footTraffic.yoy),
          granularity: String(raw.footTraffic.granularity ?? "unknown"),
        }
      : null,
    comparison: raw.comparison
      ? {
          guName: raw.comparison.guName ?? null,
          storeCount: {
            sangwon: num(raw.comparison.storeCount?.sangwon),
            gu: num(raw.comparison.storeCount?.gu),
            seoul: num(raw.comparison.storeCount?.seoul),
          },
          perStoreSalesKRW: {
            sangwon: num(raw.comparison.perStoreSalesKRW?.sangwon),
            gu: num(raw.comparison.perStoreSalesKRW?.gu),
            seoul: num(raw.comparison.perStoreSalesKRW?.seoul),
          },
          note: String(raw.comparison.note ?? ""),
        }
      : null,
  };
}

function normalizeAnalyze(
  raw: any,
  req: AnalyzeRequest,
  sourceMode: "live" | "file",
  trace: import("./contracts").DebugTrace
): AnalyzeResult {
  const sangwon = {
    code: Number(raw?.sangwon?.code ?? req.sangwonCode),
    name: raw?.sangwon?.name ?? null,
    gu: raw?.sangwon?.gu ?? null,
    dong: raw?.sangwon?.dong ?? null,
    lat: raw?.sangwon?.lat ?? null,
    lon: raw?.sangwon?.lon ?? null,
  };
  const industry = {
    code: String(raw?.industry?.code ?? req.industryCode),
    name: raw?.industry?.name ?? null,
  };
  const meta = {
    confidence: (raw?.meta?.confidence ?? "low") as "high" | "medium" | "low",
    sampleSize: Number(raw?.meta?.sampleSize ?? 0),
    dataAsOf: String(raw?.meta?.dataAsOf ?? "unknown"),
    sources: Array.isArray(raw?.meta?.sources) ? raw.meta.sources.map(String) : [],
  };

  if (raw?.status !== "ok") {
    return {
      status: raw?.status === "insufficient_data" ? "insufficient_data" : "error",
      sourceMode,
      sangwon,
      industry,
      survival: null,
      revenue: null,
      context: null,
      narrative: null,
      meta,
      debug: trace,
    };
  }

  const probability = Number(raw?.survival?.probability ?? NaN);

  return {
    status: "ok",
    sourceMode,
    sangwon,
    industry,
    survival: Number.isFinite(probability)
      ? {
          probability,
          grade: gradeOf(probability), // 신호등 판정은 플랫폼 책임 (Q6)
          horizonYears: Number(raw?.survival?.horizonYears ?? 3),
          basis: String(raw?.survival?.basis ?? "unknown"),
          granularity: String(raw?.survival?.granularity ?? "unknown"),
        }
      : null,
    revenue: raw?.revenue
      ? {
          monthlyEstimateKRW: Number(raw.revenue.monthlyEstimateKRW ?? 0),
          percentileInSangwon:
            raw.revenue.percentileAmongSangwons != null
              ? Number(raw.revenue.percentileAmongSangwons)
              : null,
          disclaimer: REVENUE_DISCLAIMER, // 모델 응답과 무관하게 강제 주입
          scaleNote: REVENUE_SCALE_NOTE,
        }
      : null,
    context: raw?.context
      ? {
          footTraffic: raw.context.footTraffic
            ? {
                total: Number(raw.context.footTraffic.total ?? 0),
                friday: raw.context.footTraffic.friday ?? null,
                saturday: raw.context.footTraffic.saturday ?? null,
              }
            : null,
          competition: raw.context.competition
            ? {
                storeCount: raw.context.competition.storeCount ?? null,
                franchiseRatio: raw.context.competition.franchiseRatio ?? null,
                granularity: String(raw.context.competition.granularity ?? "unknown"),
              }
            : null,
          demographics: Array.isArray(raw.context.demographics)
            ? raw.context.demographics.map((d: any) => ({
                ageBand: String(d.ageBand),
                ratio: Number(d.ratio),
              }))
            : [],
        }
      : null,
    narrative: raw?.narrative
      ? {
          summary: String(raw.narrative.summary ?? ""),
          generator: String(raw.narrative.generator ?? "unknown"),
        }
      : null,
    detail: packDetail(raw?.detail),
    meta,
    debug: trace,
  };
}

// ------------------------------------------------------------------
// 지역 우선 — 상권 내 업종 랭킹 (위치 먼저 플로우)
//   grade는 여기서 gradeOf로 주입 (문턱값이 프론트에 흩어지지 않게 — analyze와 동일 원칙)
// ------------------------------------------------------------------
function packTopIndustries(
  raw: any,
  sourceMode: "live" | "file",
  trace: import("./contracts").DebugTrace
): TopIndustriesResult {
  const sango = raw?.sangwon ?? {};
  return {
    sourceMode,
    dataAsOf: String(raw?.dataAsOf ?? "unknown"),
    survivalGranularity: String(raw?.survivalGranularity ?? "unknown"),
    sangwon: {
      code: Number(sango.code),
      name: sango.name ?? null,
      category: sango.category ?? null,
      gu: sango.gu ?? null,
      dong: sango.dong ?? null,
      lat: sango.lat ?? null,
      lon: sango.lon ?? null,
      footTraffic: sango.footTraffic ?? null,
    },
    industries: (raw?.industries ?? []).map((it: any) => {
      const sp = it.survivalProbability != null ? Number(it.survivalProbability) : null;
      return {
        code: String(it.code),
        name: it.name ?? null,
        monthlyEstimateKRW: Number(it.monthlyEstimateKRW ?? 0),
        salesPercentile: it.salesPercentile != null ? Number(it.salesPercentile) : null,
        survivalProbability: sp,
        grade: sp != null ? gradeOf(sp) : null, // 신호등 판정은 플랫폼 책임
        storeCount: it.storeCount != null ? Number(it.storeCount) : null,
        franchiseRatio: it.franchiseRatio != null ? Number(it.franchiseRatio) : null,
        opportunityScore: Number(it.opportunityScore ?? 0),
      };
    }),
    debug: trace,
  };
}

export async function topIndustriesViaModel(sangwonCode: number): Promise<TopIndustriesResult> {
  const { raw, trace } = await fetchModelTraced(`/sangwon/${sangwonCode}/industries`, { sangwonCode });
  return packTopIndustries(raw, "live", trace);
}

/** by-sangwon.json.gz 는 상권 수가 많아 한 번 읽고 모듈 메모리에 캐시한다. */
let _bySangwonCache: Record<string, any> | null = null;
async function loadBySangwon(): Promise<Record<string, any>> {
  if (_bySangwonCache) return _bySangwonCache;
  const file = path.join(EXPORTS_DIR, "by-sangwon.json.gz");
  const buf = await fs.readFile(file);
  _bySangwonCache = JSON.parse(zlib.gunzipSync(buf).toString("utf-8")) as Record<string, any>;
  return _bySangwonCache;
}

export async function topIndustriesViaFile(sangwonCode: number): Promise<TopIndustriesResult> {
  const started = Date.now();
  const table = await loadBySangwon();
  const raw = table[String(sangwonCode)];
  const durationMs = Date.now() - started;
  if (!raw) {
    throw new Error(`by-sangwon: 상권 ${sangwonCode} 데이터 없음`);
  }
  const trace: import("./contracts").DebugTrace = {
    externalUrl: `file://model-exports/by-sangwon.json.gz#${sangwonCode}`,
    externalRequest: { sangwonCode },
    externalResponse: {
      note: "정적 사전계산 — 상권 내 업종 랭킹 (실시간 추론 없음)",
      industryCount: raw.industryCount,
      dataAsOf: raw.dataAsOf,
    },
    externalStatus: 200,
    externalDurationMs: durationMs,
    error: null,
  };
  return packTopIndustries(raw, "file", trace);
}

// ------------------------------------------------------------------
// 히트맵 — 사전계산 정적 JSON(1차) → 모델 서버 없이도 동작 (Q13)
// ------------------------------------------------------------------
export async function heatmapViaFile(industryCode: string): Promise<HeatmapResult> {
  // 경로 조작 방지: 업종 코드는 영숫자만 허용
  if (!/^[A-Za-z0-9]+$/.test(industryCode)) {
    throw new Error(`잘못된 업종 코드: ${industryCode}`);
  }
  const file = path.join(EXPORTS_DIR, "heatmap", `${industryCode}.json`);
  const started = Date.now();
  const raw: any = JSON.parse(await fs.readFile(file, "utf-8"));
  const durationMs = Date.now() - started;

  return {
    industryCode: String(raw.industryCode ?? industryCode),
    industryName: raw.industryName ?? null,
    sourceMode: "file",
    dataAsOf: String(raw.dataAsOf ?? "unknown"),
    survivalGranularity: String(raw.survivalGranularity ?? "unknown"),
    cells: (raw.cells ?? []).map((c: any) => ({
      sangwonCode: Number(c.sangwonCode),
      sangwonName: c.sangwonName ?? null,
      gu: c.gu ?? null,
      lat: c.lat ?? null,
      lon: c.lon ?? null,
      survivalProbability: c.survivalProbability ?? null,
      monthlyEstimateKRW: c.monthlyEstimateKRW ?? null,
      salesPercentile: c.salesPercentile ?? null,
      grade: c.survivalProbability != null ? gradeOf(Number(c.survivalProbability)) : null,
    })),
    debug: {
      externalUrl: `file://${file}`,
      externalRequest: { industryCode },
      // 셀 배열은 크므로 원문 대신 요약만 담는다
      externalResponse: {
        industryName: raw.industryName,
        dataAsOf: raw.dataAsOf,
        cellCount: (raw.cells ?? []).length,
        note: "사전계산 배치 산출물 — 실시간 추론 없음",
      },
      externalStatus: 200,
      externalDurationMs: durationMs,
      error: null,
    },
  };
}

// ------------------------------------------------------------------
// 메타 — 모델 서버(1차) → 배치 산출물 파일(2차)
// ------------------------------------------------------------------
export async function metaViaModel(): Promise<MetaResult> {
  const [ind, sw]: any[] = await Promise.all([
    fetchModel("/meta/industries"),
    fetchModel("/meta/sangwons"),
  ]);
  return {
    sourceMode: "live",
    dataAsOf: String(ind?.dataAsOf ?? "unknown"),
    industries: (ind?.industries ?? []).map((i: any) => ({
      code: String(i.code),
      name: String(i.name),
    })),
    sangwons: (sw?.sangwons ?? []).map((s: any) => ({
      code: Number(s.code),
      name: s.name ?? null,
      category: s.category ?? null,
      gu: s.gu ?? null,
      dong: s.dong ?? null,
      lat: s.lat ?? null,
      lon: s.lon ?? null,
    })),
  };
}

export async function metaViaFile(): Promise<MetaResult> {
  const [ind, sw]: any[] = await Promise.all([
    fs.readFile(path.join(EXPORTS_DIR, "meta", "industries.json"), "utf-8").then(JSON.parse),
    fs.readFile(path.join(EXPORTS_DIR, "meta", "sangwons.json"), "utf-8").then(JSON.parse),
  ]);
  return {
    sourceMode: "file",
    dataAsOf: String(ind?.dataAsOf ?? "unknown"),
    industries: (ind?.industries ?? []).map((i: any) => ({
      code: String(i.code),
      name: String(i.name),
    })),
    sangwons: (sw?.sangwons ?? []).map((s: any) => ({
      code: Number(s.code),
      name: s.name ?? null,
      category: s.category ?? null,
      gu: s.gu ?? null,
      dong: s.dong ?? null,
      lat: s.lat ?? null,
      lon: s.lon ?? null,
    })),
  };
}

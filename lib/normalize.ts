/**
 * normalize.ts — anti-corruption layer (서버 전용)
 *
 * 외부 계약이 어떤 형태든 여기서 내부 계약(lib/contracts.ts)으로 정규화한다.
 * 모델 스펙이 바뀌면 이 파일만 고친다 (프론트 무변경이 설계 목표).
 *
 * ⚠️ 현재 흡수하는 외부 계약이 **두 개**다. 스키마가 서로 호환되지 않으니 섞지 말 것:
 *
 *  1) 라이브 — Commercial-AI- FastAPI (모델 정본)
 *     POST /reports/summary · GET /meta/{industries,districts} · GET /health
 *     → normalizeSummary(). 필드명이 districtCode 계열이고 매출은 "점포당".
 *     → 생존율을 주지 않으므로 폐업률에서 웹이 환산한다.
 *
 *  2) 정적 폴백 — model-exports/ (구 모델 배치 산출물, 실측 2026-Q1)
 *     analyze/*.json.gz · heatmap/*.json · by-sangwon.json.gz · meta/*.json
 *     → normalizeAnalyze(). 필드명이 sangwonCode 계열이고 매출은 "상권 전체 합산".
 *     → 생존율·추이·요일/시간대 분해를 이미 포함한다.
 *
 * - grade(신호등) 판정: 여기서 수행 (문턱값이 프론트에 흩어지지 않게)
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
  HinterlandResult,
  MetaResult,
  SafetyScoresResult,
  TopIndustriesResult,
} from "./contracts";
import { gradeOf } from "./contracts";

/**
 * 라이브 모델 서버는 **명시적 옵트인**이다 (미설정 = 정적 산출물 사용).
 *
 * 이유: 정적 산출물(model-exports/)은 62업종×1,645상권 실측이고, 모델 서버는 서빙
 * 테이블에 실데이터가 적재되기 전까지 그보다 커버리지가 좁다. 기본값을 localhost 로
 * 두면 (a) 데모 커버리지가 조용히 줄고 (b) Vercel 처럼 모델 서버가 없는 환경에서
 * 매 요청마다 실패할 fetch 를 한 번씩 낭비한다.
 */
export const MODEL_SERVER_URL = process.env.MODEL_SERVER_URL ?? "";
export const MODEL_LIVE_ENABLED = MODEL_SERVER_URL.length > 0;
const MODEL_TIMEOUT_MS = Number(process.env.MODEL_TIMEOUT_MS ?? 8000);

/** 라이브 미설정 시 즉시 실패시켜 정적 폴백을 앞당긴다 (네트워크 왕복 없음) */
function requireLiveEnabled(pathname: string): void {
  if (!MODEL_LIVE_ENABLED) {
    throw new Error(
      `MODEL_SERVER_URL 미설정 — 라이브 호출(${pathname}) 생략, 정적 산출물 사용`
    );
  }
}

/** 모델 레포의 배치 산출물(exports/) 위치 — 히트맵·메타의 1차 소스 */
const EXPORTS_DIR =
  process.env.MODEL_EXPORTS_DIR ?? path.join(process.cwd(), "model-exports");

const REVENUE_DISCLAIMER =
  "카드 결제 기반 추정치를 재추정한 상권 간 비교용 참고 지표입니다. 절대 금액 보장이 아닙니다.";
const REVENUE_SCALE_NOTE =
  "해당 상권 내 동일 업종 전체 점포의 합산 규모입니다 (1개 점포 매출 아님).";
/** KPI 타일·요약용 짧은 라벨 — 위 scaleNote 와 항상 같은 의미를 유지할 것 */
const REVENUE_SCALE_LABEL = "상권×업종 합산";

// ------------------------------------------------------------------
// 모델 서버 호출
// ------------------------------------------------------------------
async function fetchModel(pathname: string, init?: RequestInit): Promise<unknown> {
  requireLiveEnabled(pathname);
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
  requireLiveEnabled(pathname);
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
// 생존율 환산 (웹 레이어 책임)
//
// Commercial-AI- 는 생존율을 산출하지 않고 분기 폐업률(competition.closureRate, %)만
// 제공한다. 3년(=12분기) 생존 확률을 여기서 기하 환산한다:
//     p = (1 − 분기폐업률)^12
//
// ⚠️ 예측이 아니라 실측 폐업률의 환산값이며, "폐업률이 12분기 동안 일정하다"는
//    가정이 들어간다. UI 면책 문구를 반드시 유지할 것.
//
// 기존 모델은 이 값을 업종 단위(서울 전체)로만 줘서 상권 간 차이가 없었고(히트맵 단색),
// 그래서 granularity 가 "seoul_industry" 였다. Commercial-AI- 의 폐업률은
// 상권×업종 단위이므로 "sangwon_industry" 로 한 단계 올라간다.
// ------------------------------------------------------------------
const SURVIVAL_HORIZON_YEARS = 3;
const SURVIVAL_HORIZON_QUARTERS = SURVIVAL_HORIZON_YEARS * 4;

/**
 * 축소추정(Empirical Bayes) 사전관측 수 — tools/export_web_static.py 와 동일하게 유지할 것.
 *
 * 관측 폐업률을 그대로 쓰면 안 되는 이유: 상권×업종 점포 수 중앙값이 2개라 한 분기에
 * 폐업 0건인 조합이 대부분이고, 그러면 생존율이 정확히 100% 로 찍힌다 (실측 90.2%).
 * "3년 생존율 100%" 는 확실성이 아니라 소표본 artifact 이므로 표시할 수 없다.
 *
 *     보정 폐업률 = (관측률 × 노출 + k × 업종사전률) / (노출 + k)
 */
const SHRINKAGE_PSEUDO_COUNT = 20;
/** 사전표를 못 읽을 때의 대비값 — 전 업종 분기 폐업률 중앙값(실측 2.06%) */
const FALLBACK_CLOSURE_PRIOR = 0.0206;

/**
 * 업종별 사전 폐업률 — tools/export_web_static.py 가 내보낸 meta/closure-priors.json.
 * 모델 서버는 단일 분기 폐업률만 주므로 이 표 없이는 라이브가 100% 를 뱉는다.
 */
let _closurePriorCache: Map<string, number> | null = null;
async function loadClosurePriors(): Promise<Map<string, number>> {
  if (!_closurePriorCache) {
    try {
      const raw = JSON.parse(
        await fs.readFile(path.join(EXPORTS_DIR, "meta", "closure-priors.json"), "utf-8")
      ) as { quarterlyClosureRateByIndustry?: Record<string, number> };
      _closurePriorCache = new Map(
        Object.entries(raw.quarterlyClosureRateByIndustry ?? {}).map(([k, v]) => [k, Number(v)])
      );
    } catch {
      _closurePriorCache = new Map(); // 파일 없음 → FALLBACK 사용
    }
  }
  return _closurePriorCache;
}

/**
 * 생존율 = (1 − 보정 분기폐업률)^12. 예측이 아니라 실측 폐업률의 환산값.
 *
 * @param closureRatePct 모델 서버가 준 관측 분기 폐업률(%)
 * @param exposure       노출 규모 — 전체 점포 수(해당 분기). 클수록 관측을 신뢰한다.
 * @param prior          업종 사전 폐업률(0~1)
 *
 * ⚠️ 라이브는 단일 분기 관측만 쓸 수 있어 정적 산출물(10분기 누적)보다 거친 추정이다.
 */
function survivalFromClosure(
  closureRatePct: unknown,
  exposure: number | null,
  prior: number
): { probability: number; shrunkRatePct: number } | null {
  const pct = Number(closureRatePct);
  if (!Number.isFinite(pct) || pct < 0) return null;
  const observed = Math.min(pct / 100, 1);
  const n = exposure != null && Number.isFinite(exposure) && exposure > 0 ? exposure : 0;
  const shrunk = (observed * n + SHRINKAGE_PSEUDO_COUNT * prior) / (n + SHRINKAGE_PSEUDO_COUNT);
  const p = Math.pow(1 - Math.min(Math.max(shrunk, 0), 1), SURVIVAL_HORIZON_QUARTERS);
  return {
    probability: Math.min(Math.max(p, 0), 1),
    shrunkRatePct: Number((shrunk * 100).toFixed(4)),
  };
}

/**
 * Commercial-AI- 의 매출 예측은 "점포당 · 다음 분기" 값이다(target = 다음분기매출 ÷ 다음분기점포수).
 * 정적 폴백(옛 모델)의 "상권 전체 점포 합산"과 의미가 정반대이므로 문구를 분리한다.
 * 여기서 합산 문구를 재사용하면 점포당 금액에 "합산"이라고 거짓 라벨이 붙는다.
 */
const REVENUE_SCALE_NOTE_PER_STORE =
  "동일 업종 점포 1곳의 평균 규모 예측값입니다 (상권 전체 합산 아님). " +
  "기간 기준은 원천 데이터의 '당월' 정의를 따르며 확정되지 않았습니다. " +
  "프랜차이즈와 독립 점포를 모두 포함한 평균이므로, " +
  "프랜차이즈 비중이 큰 업종에서는 독립 점포의 실제 매출과 다를 수 있습니다.";
/** KPI 타일·요약용 짧은 라벨 — 위 scaleNote 와 항상 같은 의미를 유지할 것 */
const REVENUE_SCALE_LABEL_PER_STORE = "점포당 평균";

const CONFIDENCE_LEVELS = new Set(["high", "medium", "low"]);

/**
 * 점포 수 · 프랜차이즈 비율 읽기 (라이브 경로)
 *
 * 과거에는 여기서 역산 보정을 했다. 모델 서버가 `competition.storeCount` 로
 * `STOR_CO`(=일반/비프랜차이즈 점포 수)를 주고 `franchiseRatio` 를 프랜차이즈/일반
 * 으로 계산해서, 비율이 1.0 을 넘었기 때문이다 (실측 최대 1400%).
 *
 * **상류에서 고쳐졌으므로 보정을 제거했다** (2026-08-04, 모델 저장소 cbaab3d):
 *   - `api/server.py:208` → `storeCount = 전체_점포_수` (독립 + 프랜차이즈)
 *   - `src/features/build.py:113` → `프랜차이즈_비율 = 프랜차이즈/전체` (0~1 보장)
 * 서빙 테이블 21,452행 검증: 비율 최대 1.0 · 1.0 초과 0건 ·
 * `전체_점포_수 == 점포_수 + 프랜차이즈_점포_수` 불일치 0건.
 *
 * 여기서 역산을 유지하면 이미 전체인 값에 (1+비율)을 또 곱하는 **이중 보정**이 된다.
 * 보정을 되살려야 할 상황이면 상류가 되돌아간 것이므로 서버 쪽을 먼저 확인할 것.
 */
function readStoreCounts(rawStoreCount: unknown, rawRatio: unknown) {
  const storeCount =
    rawStoreCount != null && Number.isFinite(Number(rawStoreCount)) ? Number(rawStoreCount) : null;
  const franchiseRatio =
    rawRatio != null && Number.isFinite(Number(rawRatio)) ? Number(rawRatio) : null;
  return { storeCount, franchiseRatio, correction: null as string | null };
}

/* eslint-disable @typescript-eslint/no-explicit-any */

/** 업종명은 /reports/summary 응답에 없어 메타에서 조회한다 (부가정보 — 실패해도 분석은 진행) */
let _industryNameCache: Map<string, string> | null = null;
async function lookupIndustryName(code: string): Promise<string | null> {
  if (!_industryNameCache) {
    try {
      const arr = (await fetchModel("/meta/industries")) as any[];
      _industryNameCache = new Map(
        (Array.isArray(arr) ? arr : []).map((i: any) => [
          String(i.industryCode),
          String(i.industryName),
        ])
      );
    } catch {
      return null;
    }
  }
  return _industryNameCache.get(code) ?? null;
}

// ------------------------------------------------------------------
// POST /reports/summary 정규화 (Commercial-AI- 외부 계약)
//
// 조합이 없으면 서버가 HTTP 404 를 준다 → fetchModelTraced 가 throw → route 가
// 정적 폴백으로 내려간다. 404 를 insufficient_data 로 바꾸지 말 것:
// 실데이터가 서빙 테이블에 다 들어오기 전까지는 정적 산출물이 더 좋은 응답이다.
// ------------------------------------------------------------------
export async function analyzeViaModel(req: AnalyzeRequest): Promise<AnalyzeResult> {
  const externalRequest = {
    districtCode: req.sangwonCode, // 외부 계약은 districtCode (내부는 sangwonCode)
    industryCode: req.industryCode,
  };
  const { raw, trace } = (await fetchModelTraced("/reports/summary", externalRequest, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(externalRequest),
  })) as { raw: any; trace: import("./contracts").DebugTrace };
  const [indName, priors] = await Promise.all([
    lookupIndustryName(req.industryCode),
    loadClosurePriors(),
  ]);
  const prior = priors.get(req.industryCode) ?? FALLBACK_CLOSURE_PRIOR;
  return normalizeSummary(raw, req, indName, prior, trace);
}

function normalizeSummary(
  raw: any,
  req: AnalyzeRequest,
  indName: string | null,
  closurePrior: number,
  trace: import("./contracts").DebugTrace
): AnalyzeResult {
  const sangwon = {
    code: Number(raw?.selection?.districtCode ?? req.sangwonCode),
    name: raw?.overview?.districtName ?? null,
    gu: raw?.overview?.gu ?? null,
    dong: raw?.overview?.dong ?? null,
    // /reports/summary 는 좌표를 주지 않는다 (지도 핀은 /api/meta 의 상권 목록에서 온다)
    lat: null,
    lon: null,
  };
  const industry = {
    code: String(raw?.selection?.industryCode ?? req.industryCode),
    name: indName,
  };
  const meta = {
    confidence: (CONFIDENCE_LEVELS.has(raw?.meta?.confidence)
      ? raw.meta.confidence
      : "low") as "high" | "medium" | "low",
    // 외부는 availableQuarterCount, 내부 계약은 sampleSize
    sampleSize: Number(raw?.meta?.availableQuarterCount ?? raw?.availableQuarterCount ?? 0),
    dataAsOf: String(raw?.meta?.dataAsOf ?? "unknown"),
    sources: Array.isArray(raw?.meta?.sources) ? raw.meta.sources.map(String) : [],
  };

  if (raw?.status !== "ok") {
    return {
      status: raw?.status === "insufficient_data" ? "insufficient_data" : "error",
      sourceMode: "live",
      sangwon,
      industry,
      survival: null,
      revenue: null,
      context: null,
      narrative: null,
      detail: null,
      meta,
      debug: trace,
    };
  }

  const ageDist = raw?.customers?.ageDistribution;
  const predictedPerStore = raw?.sales?.predictedSalesPerStoreKRW;

  // 점포 수를 먼저 읽는다 — 전체 점포 수가 생존율 축소추정의 노출량이 된다
  const comp = readStoreCounts(raw?.competition?.storeCount, raw?.competition?.franchiseRatio);
  const surv = survivalFromClosure(raw?.competition?.closureRate, comp.storeCount, closurePrior);

  return {
    status: "ok",
    sourceMode: "live",
    sangwon,
    industry,
    survival:
      surv != null
        ? {
            probability: surv.probability,
            grade: gradeOf(surv.probability), // 신호등 판정은 플랫폼 책임
            horizonYears: SURVIVAL_HORIZON_YEARS,
            // 관측 폐업률을 업종 평균으로 축소추정한 값 — 소표본 100% 방지
            basis: "empirical_closure_rate_shrunk",
            granularity: "sangwon_industry", // 상권×업종 단위 (기존 seoul_industry 보다 세밀)
          }
        : null,
    revenue:
      predictedPerStore != null && Number.isFinite(Number(predictedPerStore))
        ? {
            monthlyEstimateKRW: Number(predictedPerStore),
            percentileInSangwon:
              raw?.sales?.salesPercentile != null ? Number(raw.sales.salesPercentile) : null,
            disclaimer: REVENUE_DISCLAIMER, // 모델 응답과 무관하게 강제 주입
            scaleNote: REVENUE_SCALE_NOTE_PER_STORE, // 점포당임을 정직하게 표기
            scaleLabel: REVENUE_SCALE_LABEL_PER_STORE,
          }
        : null,
    context: {
      footTraffic:
        raw?.customers?.totalFootTraffic != null
          ? {
              total: Number(raw.customers.totalFootTraffic),
              // 외부는 평일/주말 비율만 제공 — 요일별 절대값은 없음
              friday: null,
              saturday: null,
            }
          : null,
      competition: raw?.competition
        ? {
            // 점포 수·프랜차이즈 비율은 상류가 이미 올바르다 (근거는 readStoreCounts 주석)
            ...comp,
            granularity: "sangwon_industry",
          }
        : null,
      demographics:
        ageDist && typeof ageDist === "object"
          ? Object.entries(ageDist).map(([ageBand, ratio]) => ({
              ageBand: String(ageBand),
              ratio: Number(ratio) || 0,
            }))
          : [],
    },
    narrative: raw?.diagnosis?.recommendation
      ? { summary: String(raw.diagnosis.recommendation), generator: "rule_based" }
      : null,
    // Commercial-AI- 의 서빙 테이블은 최신 분기 스냅샷이라 추이/요일·시간대 분해가 없다.
    // detail=null 이면 UI 가 해당 섹션을 자동 생략한다 (차트는 정적 폴백에서만 나옴).
    detail: null,
    meta,
    debug: trace,
  };
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

  // 조합 데이터가 없을 때도 상권명·업종명·기준분기는 메타에서 채운다.
  // (안 채우면 "상권 #3081203 · CS100001 (기준 unknown)" 처럼 코드만 노출된다)
  let payload = rawFromFile;
  if (!payload) {
    const meta = await loadSangwonMeta().catch(() => null);
    const s = meta?.byCode.get(String(req.sangwonCode)) ?? null;
    payload = {
      status: "insufficient_data",
      sangwon: {
        code: req.sangwonCode,
        name: s?.name ?? null,
        gu: s?.gu ?? null,
        dong: s?.dong ?? null,
        lat: s?.lat ?? null,
        lon: s?.lon ?? null,
      },
      industry: {
        code: req.industryCode,
        name: meta?.industryName.get(req.industryCode) ?? null,
      },
      meta: { dataAsOf: meta?.dataAsOf ?? "unknown", sampleSize: 0 },
    };
  }
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
    safety: raw.safety
      ? {
          year: String(raw.safety.year ?? "unknown"),
          guName: raw.safety.guName ?? null,
          totalIncidents: num(raw.safety.totalIncidents),
          byType: Array.isArray(raw.safety.byType)
            ? raw.safety.byType.map((t: any) => ({
                label: String(t.label),
                count: Number(t.count ?? 0),
              }))
            : null,
          rankAmongGus: num(raw.safety.rankAmongGus),
          guCount: num(raw.safety.guCount),
          seoulAvgIncidents: num(raw.safety.seoulAvgIncidents),
          per100k: num(raw.safety.per100k),
          granularity: String(raw.safety.granularity ?? "gu"),
        }
      : null,
    // v2 신규 — 독립점포 관점 매출 (통계 추정). 구 번들엔 없으므로 optional 통과
    independent:
      raw.independent &&
      (raw.independent.kSource === "industry_fit" ||
        raw.independent.kSource === "scenario_only")
        ? {
            kSource: raw.independent.kSource,
            isPure:
              typeof raw.independent.isPure === "boolean"
                ? raw.independent.isPure
                : null,
            onlyPercentile: num(raw.independent.onlyPercentile),
            peerCount: num(raw.independent.peerCount),
            peerMedianSalesKRW: num(raw.independent.peerMedianSalesKRW),
            scenarios: Array.isArray(raw.independent.scenarios)
              ? raw.independent.scenarios.map((s: any) => ({
                  k: Number(s.k),
                  salesKRW: num(s.salesKRW),
                }))
              : null,
            kUsed: num(raw.independent.kUsed),
            kFitR2: num(raw.independent.kFitR2),
            kSampleSize: num(raw.independent.kSampleSize),
            estimatedSalesKRW: num(raw.independent.estimatedSalesKRW),
            basis: String(raw.independent.basis ?? "통계 추정"),
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
    // v2 신규 — 상권 유형 5종 (규칙 기반). 구 번들·라이브엔 없음
    type: typeof raw?.sangwon?.type === "string" ? raw.sangwon.type : null,
    typeBasis:
      typeof raw?.sangwon?.typeBasis === "string" ? raw.sangwon.typeBasis : null,
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
          // v2 신규 — 업종별 test 오차(채점 결과). 없으면 신뢰도 표기 생략
          accuracy:
            raw.revenue.accuracy &&
            Number.isFinite(Number(raw.revenue.accuracy.smapePct))
              ? {
                  smapePct: Number(raw.revenue.accuracy.smapePct),
                  sampleN:
                    raw.revenue.accuracy.sampleN != null
                      ? Number(raw.revenue.accuracy.sampleN)
                      : null,
                  lowSample: Boolean(raw.revenue.accuracy.lowSample),
                }
              : null,
          disclaimer: REVENUE_DISCLAIMER, // 모델 응답과 무관하게 강제 주입
          // 집계 수준은 산출물이 스스로 선언한다 (revenue.basis).
          // tools/export_web_static.py 로 새로 생성한 산출물은 "per_store_predicted"(점포당),
          // 구 산출물은 basis 가 없어 상권 합산으로 간주한다.
          ...(raw.revenue.basis === "per_store_predicted"
            ? {
                scaleNote: REVENUE_SCALE_NOTE_PER_STORE,
                scaleLabel: REVENUE_SCALE_LABEL_PER_STORE,
              }
            : { scaleNote: REVENUE_SCALE_NOTE, scaleLabel: REVENUE_SCALE_LABEL }),
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
                // 정적 산출물(구 모델)은 점포 수 정의가 다를 수 있어 보정하지 않는다
                correction: null,
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

/**
 * ⚠️ 라이브 경로 없음.
 *
 * Commercial-AI- 에는 "상권 하나를 주면 업종을 랭킹한다"에 대응하는 엔드포인트가 없다.
 * (/recommendations/{industryCode} 는 반대 방향 — 업종을 주면 상권을 랭킹한다.)
 * 62개 업종을 각각 호출하는 건 비현실적이므로, 지역 우선 플로우는 정적 사전계산
 * (by-sangwon.json.gz)으로만 동작한다. 모델 서버에 엔드포인트가 생기면 여기를 구현할 것.
 *
 * 없는 경로로 왕복해서 404 를 받는 대신 즉시 실패시켜 폴백을 앞당긴다.
 */
export async function topIndustriesViaModel(sangwonCode: number): Promise<TopIndustriesResult> {
  throw new Error(
    `상권별 업종 랭킹은 모델 서버에 대응 엔드포인트가 없음 (상권 ${sangwonCode}) — 정적 산출물 사용`
  );
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

/**
 * 랭킹 데이터가 없는 상권도 이름·자치구를 보여주기 위한 메타 조회 (모듈 캐시).
 * 지도 목록(meta/sangwons.json)과 랭킹(by-sangwon.json.gz)의 커버리지가 다르기 때문에 필요하다.
 */
let _sangwonMetaCache: {
  dataAsOf: string;
  byCode: Map<string, any>;
  industryName: Map<string, string>;
} | null = null;
async function loadSangwonMeta() {
  if (!_sangwonMetaCache) {
    const [sw, ind]: any[] = await Promise.all([
      fs
        .readFile(path.join(EXPORTS_DIR, "meta", "sangwons.json"), "utf-8")
        .then(JSON.parse),
      fs
        .readFile(path.join(EXPORTS_DIR, "meta", "industries.json"), "utf-8")
        .then(JSON.parse)
        .catch(() => null),
    ]);
    _sangwonMetaCache = {
      dataAsOf: String(sw?.dataAsOf ?? "unknown"),
      byCode: new Map((sw?.sangwons ?? []).map((s: any) => [String(s.code), s])),
      industryName: new Map(
        (ind?.industries ?? []).map((i: any) => [String(i.code), String(i.name)])
      ),
    };
  }
  return _sangwonMetaCache;
}

export async function topIndustriesViaFile(sangwonCode: number): Promise<TopIndustriesResult> {
  const started = Date.now();
  const table = await loadBySangwon();
  const raw = table[String(sangwonCode)];
  const durationMs = Date.now() - started;

  // ------------------------------------------------------------------
  // 랭킹 데이터 없음 → 502 대신 "빈 목록"으로 정직하게 응답한다.
  //
  // 지도 목록(1,645상권)이 랭킹 데이터(1,572상권)보다 넓어서 74개 상권은 클릭 가능하지만
  // 랭킹이 없다. 여기서 throw 하면 route 가 502 를 내고 지역 우선 플로우가 완전히 막혔다.
  // 목업으로 채우지 않는 이유: 없는 데이터를 그럴싸한 숫자로 메우지 않는다는 원칙
  // (insufficient_data 를 숫자 없이 처리하는 것과 같은 방식).
  //
  // 실데이터 전환 후에도 이 경로는 필요하다 — 서빙 테이블에도 데이터 부족 조합이 존재한다.
  // ------------------------------------------------------------------
  if (!raw) {
    const meta = await loadSangwonMeta().catch(() => null);
    const s = meta?.byCode.get(String(sangwonCode)) ?? null;
    return {
      sourceMode: "file",
      dataAsOf: meta?.dataAsOf ?? "unknown",
      survivalGranularity: "unknown",
      sangwon: {
        code: sangwonCode,
        name: s?.name ?? null,
        category: s?.category ?? null,
        gu: s?.gu ?? null,
        dong: s?.dong ?? null,
        lat: s?.lat ?? null,
        lon: s?.lon ?? null,
        footTraffic: null,
      },
      industries: [],
      debug: {
        externalUrl: `file://model-exports/by-sangwon.json.gz#${sangwonCode}`,
        externalRequest: { sangwonCode },
        externalResponse: {
          note: "이 상권은 업종별 랭킹 사전계산 데이터가 없음 (지도 목록에는 존재)",
          rankedSangwonCount: Object.keys(table).length,
        },
        externalStatus: 404,
        externalDurationMs: durationMs,
        error: null,
      },
    };
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
/**
 * Commercial-AI- 외부 계약:
 *  - GET /meta/industries → 배열 [{industryCode, industryName, dataPeriod}]
 *  - GET /meta/districts  → 배열 [{districtCode, districtName, districtType, gu, dong,
 *                                  centerLat, centerLon, polygonAvailable}]
 *  - dataAsOf 는 두 응답에 없으므로 /health 에서 가져온다.
 *
 * ⚠️ 옛 계약(/meta/sangwons, {industries:[...]} 래핑)과 달리 **둘 다 bare 배열**이다.
 *    래핑을 가정하면 빈 배열이 되어 업종 드롭다운이 조용히 비므로 주의.
 */
export async function metaViaModel(): Promise<MetaResult> {
  const [ind, dist, health]: any[] = await Promise.all([
    fetchModel("/meta/industries"),
    fetchModel("/meta/districts"),
    fetchModel("/health").catch(() => null),
  ]);
  const industries = Array.isArray(ind) ? ind : [];
  const districts = Array.isArray(dist) ? dist : [];
  if (!industries.length || !districts.length) {
    throw new Error("model server meta 응답이 비어 있음 (서빙 테이블 미로드 가능)");
  }
  return {
    sourceMode: "live",
    dataAsOf: String(health?.dataAsOf ?? "unknown"),
    industries: industries.map((i: any) => ({
      code: String(i.industryCode),
      name: String(i.industryName),
    })),
    sangwons: districts.map((s: any) => ({
      code: Number(s.districtCode),
      name: s.districtName ?? null,
      category: s.districtType ?? null,
      gu: s.gu ?? null,
      dong: s.dong ?? null,
      lat: s.centerLat ?? null,
      lon: s.centerLon ?? null,
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

// ------------------------------------------------------------------
// 자치구 안전 종합점수 — '치안 반영' 토글의 데이터 소스
//
// 1차: model-exports/meta/safety-scores.json (실측 — tools/build_safety_scores.py 산출)
// 2차: 결정적 목업 (자치구명 시드) — sourceMode:"mock" 으로 정직하게 표시
// 산식·가중치는 모델 정본(Commercial-AI- config/scoring_weights.yaml)과 동일하게 유지.
// ------------------------------------------------------------------
/**
 * 목업 경로 전용 문구·가중치.
 *
 * ⚠️ 실데이터 경로는 이 상수를 쓰지 않는다 — `meta/safety-scores.json` 이 자신이 사용한
 *    가중치와 설명을 함께 기록하므로 그 값을 그대로 노출한다(산식이 갈라지는 것을 막는 장치).
 *    산식 정본은 `Commercial-AI-/config/scoring_weights.yaml`, 산출은
 *    `tools/build_safety_scores.py`. 가중치를 바꾸려면 그 두 곳과 아래를 함께 고칠 것.
 */
const SAFETY_WEIGHTS_NOTE_MOCK =
  "안전점수 = 범죄율(10만명당, 낮을수록↑) 50% + 검거 비율 25% + CCTV밀도 25% — " +
  "자치구 간 백분위 가중합(0~100). 가중치는 서비스 정책값이며 통계적으로 검증된 사실이 아닙니다.";

/** 자치구명 시드 결정적 난수 (lib/mockExtras 와 동일 방식 — 서버 전용 복제) */
function guSeedRandom(name: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let a = h >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 자치구 간 백분위(0~1) — 정본 compute_safety_score 의 percentile_score 와 동일 개념 */
function percentileAmong(values: number[], v: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const below = sorted.filter((x) => x < v).length;
  const equal = sorted.filter((x) => x === v).length;
  return (below + equal * 0.5) / sorted.length;
}

function computeSafetyScores(
  raw: Record<string, { crimeRatePer100k: number | null; arrestRate: number | null; cctvPerKm2: number | null }>
): Record<string, { score: number; crimeRatePer100k: number | null; arrestRate: number | null; cctvPerKm2: number | null }> {
  const gus = Object.keys(raw);
  const cols = [
    { key: "crimeRatePer100k" as const, weight: 0.5, higherBetter: false },
    { key: "arrestRate" as const, weight: 0.25, higherBetter: true },
    { key: "cctvPerKm2" as const, weight: 0.25, higherBetter: true },
  ];
  const out: Record<string, { score: number; crimeRatePer100k: number | null; arrestRate: number | null; cctvPerKm2: number | null }> = {};
  for (const gu of gus) {
    let acc = 0;
    let wsum = 0;
    let components = 0;
    for (const c of cols) {
      const v = raw[gu][c.key];
      if (v == null) continue;
      const vals = gus.map((g) => raw[g][c.key]).filter((x): x is number => x != null);
      if (vals.length < 2) continue;
      let p = percentileAmong(vals, v);
      if (!c.higherBetter) p = 1 - p;
      acc += p * c.weight;
      wsum += c.weight;
      components += 1;
    }
    // 정본 min_components=2 — 성분 부족 시 점수 미산출 대신 중립(50) 부여하지 않고 제외
    if (components >= 2 && wsum > 0) {
      out[gu] = { ...raw[gu], score: Math.round((acc / wsum) * 1000) / 10 };
    }
  }
  return out;
}

// ------------------------------------------------------------------
// 배후지 실측 — 리포트 ⑦ (meta/hinterland.json.gz, tools/build_hinterland.py 산출)
//
// 파일이 없으면 sourceMode:"mock" 으로 응답하고 UI 가 예시 데이터 배지를 붙인다
// (safety-scores 와 같은 패턴). 상권 수가 많아 한 번 읽고 모듈 메모리에 캐시한다.
// ------------------------------------------------------------------
let _hinterlandCache: {
  asOf: Record<string, string>;
  sources: string[];
  unavailable: { item: string; reason: string }[];
  bySangwon: Record<string, any>;
} | null = null;

async function loadHinterland() {
  if (_hinterlandCache) return _hinterlandCache;
  const file = path.join(EXPORTS_DIR, "meta", "hinterland.json.gz");
  const buf = await fs.readFile(file);
  _hinterlandCache = JSON.parse(zlib.gunzipSync(buf).toString("utf-8"));
  return _hinterlandCache!;
}

export async function hinterland(sangwonCode: number): Promise<HinterlandResult> {
  const started = Date.now();
  try {
    const table = await loadHinterland();
    const raw = table.bySangwon[String(sangwonCode)] ?? null;
    const slices = (arr: any) =>
      Array.isArray(arr) && arr.length
        ? arr.map((s: any) => ({ label: String(s.label), ratio: Number(s.ratio ?? 0) }))
        : null;
    const n = (v: any) => (v != null && Number.isFinite(Number(v)) ? Number(v) : null);

    return {
      sourceMode: "file",
      hinterland: raw
        ? {
            resident: raw.resident
              ? {
                  total: n(raw.resident.total),
                  byGender: slices(raw.resident.byGender),
                  byAge: slices(raw.resident.byAge),
                  asOf: String(raw.resident.asOf ?? "unknown"),
                }
              : null,
            worker: raw.worker
              ? {
                  total: n(raw.worker.total),
                  byAge: slices(raw.worker.byAge),
                  asOf: String(raw.worker.asOf ?? "unknown"),
                }
              : null,
            apartment: raw.apartment
              ? {
                  complexes: n(raw.apartment.complexes),
                  households: n(raw.apartment.households),
                  avgPriceKRW: n(raw.apartment.avgPriceKRW),
                  avgAreaM2: n(raw.apartment.avgAreaM2),
                  asOf: String(raw.apartment.asOf ?? "unknown"),
                }
              : null,
            facility: raw.facility
              ? {
                  total: n(raw.facility.total),
                  items: Array.isArray(raw.facility.items)
                    ? raw.facility.items.map((x: any) => ({
                        label: String(x.label),
                        count: Number(x.count ?? 0),
                      }))
                    : null,
                  asOf: String(raw.facility.asOf ?? "unknown"),
                }
              : null,
            spending: raw.spending
              ? {
                  totalKRW: n(raw.spending.totalKRW),
                  byCategory: slices(raw.spending.byCategory),
                  asOf: String(raw.spending.asOf ?? "unknown"),
                }
              : null,
          }
        : null,
      unavailable: table.unavailable ?? [],
      sources: table.sources ?? [],
      debug: {
        externalUrl: `file://model-exports/meta/hinterland.json.gz#${sangwonCode}`,
        externalRequest: { sangwonCode },
        externalResponse: raw
          ? { asOf: table.asOf, blocks: Object.keys(raw) }
          : { note: "이 상권은 배후지 데이터가 없습니다" },
        externalStatus: 200,
        externalDurationMs: Date.now() - started,
        error: null,
      },
    };
  } catch {
    // 산출물 미보유 → 목업 폴백 (UI 가 예시 데이터 배지)
    return {
      sourceMode: "mock",
      hinterland: null,
      unavailable: [],
      sources: [],
      debug: {
        externalUrl: "mock://hinterland",
        externalRequest: { sangwonCode },
        externalResponse: {
          note: "hinterland.json.gz 없음 — tools/build_hinterland.py 로 생성 가능",
        },
        externalStatus: null,
        externalDurationMs: Date.now() - started,
        error: "배후지 산출물 없음 → 예시 데이터 폴백",
      },
    };
  }
}

export async function safetyScores(): Promise<SafetyScoresResult> {
  const file = path.join(EXPORTS_DIR, "meta", "safety-scores.json");
  const started = Date.now();

  // ---- 1차: 실측 파일 ----
  try {
    const raw: any = JSON.parse(await fs.readFile(file, "utf-8"));
    const byGu = raw.byGu ?? {};
    return {
      sourceMode: "file",
      year: String(raw.year ?? "unknown"),
      cctvYear: raw.cctvYear ?? null,
      byGu,
      // 산출 스크립트가 기록한 문구를 그대로 — 웹에서 산식을 다시 적지 않는다
      weightsNote: String(raw.weightsNote ?? SAFETY_WEIGHTS_NOTE_MOCK),
      sources: Array.isArray(raw.sources) ? raw.sources.map(String) : null,
      debug: {
        externalUrl: `file://model-exports/meta/safety-scores.json`,
        externalRequest: null,
        externalResponse: {
          guCount: Object.keys(byGu).length,
          year: raw.year,
          cctvYear: raw.cctvYear ?? null,
          weights: raw.weights ?? null,
          sources: raw.sources ?? null,
        },
        externalStatus: 200,
        externalDurationMs: Date.now() - started,
        error: null,
      },
    };
  } catch {
    // ---- 2차: 결정적 목업 (자치구 목록은 실제 메타에서) ----
    const meta = await metaViaFile();
    const gus = [...new Set(meta.sangwons.map((s) => s.gu).filter((g): g is string => !!g))];
    const rawByGu: Record<string, { crimeRatePer100k: number | null; arrestRate: number | null; cctvPerKm2: number | null }> = {};
    for (const gu of gus) {
      const rand = guSeedRandom(gu);
      rawByGu[gu] = {
        crimeRatePer100k: Math.round(600 + rand() * 900),   // 자치구 그럴듯한 범위의 가상값
        arrestRate: Math.round((0.6 + rand() * 0.3) * 1000) / 1000,
        cctvPerKm2: Math.round((20 + rand() * 140) * 10) / 10,
      };
    }
    return {
      sourceMode: "mock",
      year: "예시",
      cctvYear: null,
      byGu: computeSafetyScores(rawByGu),
      weightsNote: SAFETY_WEIGHTS_NOTE_MOCK,
      sources: null,
      debug: {
        externalUrl: "mock://safety-scores (자치구명 시드 결정적 생성)",
        externalRequest: null,
        externalResponse: {
          note: "범죄·CCTV 실데이터 미보유 — 예시 값. tools/build_safety_scores.py 로 교체 가능",
          guCount: gus.length,
        },
        externalStatus: null,
        externalDurationMs: Date.now() - started,
        error: "safety-scores.json 없음 → 예시 데이터 폴백",
      },
    };
  }
}

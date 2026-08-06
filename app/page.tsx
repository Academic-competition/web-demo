"use client";
/**
 * 메인 화면 — 지도(좌) / 컨트롤·결과 패널(우) 단일 분할 (PRD §5)
 *
 * 두 진입 모드가 하나의 결과 카드로 수렴한다:
 *  - 위치 먼저(UC-001): 지도 클릭 → 상권 확정 → 업종 선택 → 분석
 *  - 업종 먼저(UC-002): 업종 선택 → 히트맵 → 상권 클릭 → 분석
 *  - 재탐색(UC-003): 결과 이후 조건 변경 시 자동 재질의
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import InspectorConsole from "@/components/InspectorConsole";
import MapView, { type HeatmapMetric } from "@/components/MapView";
import ResultPanel, {
  ErrorState,
  IdleState,
  LoadingState,
  OnboardingCard,
} from "@/components/ResultPanel";
import RecentHistory from "@/components/RecentHistory";
import ComparePanel from "@/components/ComparePanel";
import TopIndustriesPanel from "@/components/TopIndustriesPanel";
import TopSangwonsPanel from "@/components/TopSangwonsPanel";
import {
  clearHistory,
  getHistoryServerSnapshot,
  getHistorySnapshot,
  pushHistory,
  subscribeHistory,
  type HistoryEntry,
} from "@/lib/history";
import { nearestSangwon, MAX_SNAP_METERS } from "@/lib/geo";
import {
  useAnalyze,
  useCompare,
  useHeatmap,
  useHinterland,
  useMeta,
  useSafetyScores,
  useTopIndustries,
} from "@/lib/hooks";
import { inspect } from "@/lib/inspector";

type Mode = "location" | "industry";

export default function Home() {
  const meta = useMeta();
  const analyze = useAnalyze();

  const [mode, setMode] = useState<Mode>("location");
  /** 질문형 온보딩에 응답했는지 — 응답 전까지만 시작 카드를 보여준다 */
  const [onboarded, setOnboarded] = useState(false);
  const [industryCode, setIndustryCode] = useState<string>("");
  const [selectedCode, setSelectedCode] = useState<number | null>(null);
  const [pickedPoint, setPickedPoint] = useState<{ lat: number; lng: number } | null>(null);
  const [boundaryNotice, setBoundaryNotice] = useState<{
    message: string;
    suggestion: { code: number; name: string | null; distance: number } | null;
  } | null>(null);
  const [heatmapMetric, setHeatmapMetric] = useState<HeatmapMetric>("sales");
  /** 추천 상권 리스트 hover ↔ 지도 원 강조 (TopSangwonsPanel → MapView) */
  const [highlightCode, setHighlightCode] = useState<number | null>(null);
  /** 최근 분석 이력 — 외부 스토어(localStorage) 구독. 서버 스냅샷은 빈 배열이라 SSR 안전 */
  const history = useSyncExternalStore(
    subscribeHistory,
    getHistorySnapshot,
    getHistoryServerSnapshot
  );

  // 분석이 성공할 때마다 이력에 기록 (같은 상권×업종은 최신 1건으로 갱신).
  // pushHistory 는 외부 스토어 액션이라 effect 안에서 setState 를 부르지 않는다.
  const analyzeData = analyze.data;
  useEffect(() => {
    if (!analyzeData || analyzeData.status !== "ok") return;
    pushHistory({
      sangwonCode: analyzeData.sangwon.code,
      industryCode: analyzeData.industry.code,
      sangwonName: analyzeData.sangwon.name,
      industryName: analyzeData.industry.name,
      grade: analyzeData.survival?.grade ?? null,
      ts: Date.now(),
    });
  }, [analyzeData]);
  /** 종합점수에 자치구 안전점수 5%를 반영할지 — 사용자가 선택한다 (기본 미반영) */
  const [safetyOn, setSafetyOn] = useState(false);

  /** 첫 분석 이후에는 조건 변경 시 자동 재질의 (재탐색 루프) */
  const hasAnalyzedRef = useRef(false);

  // 히트맵: 업종 먼저 모드 + (리포트가 열려 있으면) 종합점수·순위 비교용으로도 로드
  const heatmap = useHeatmap(industryCode || null, mode === "industry" || !!analyze.data);
  const safety = useSafetyScores();
  // 상권 업종 랭킹 — 위치 먼저 모드의 중간 단계이자, 리포트의 '상권 내 기회 순위' 소스.
  // 업종 먼저 모드에서도 상권이 정해지면 순위 맥락을 위해 로드한다 (파일 캐시라 가벼움).
  const topIndustries = useTopIndustries(selectedCode);
  // 배후지 실측 — 리포트 ⑦ (분석이 열렸을 때만 로드)
  const hinterlandQ = useHinterland(analyze.data ? analyze.data.sangwon.code : null);

  // ── 상권 비교 바스켓 (golmok '비교담기' 벤치마크) ────────────────────
  // 담는 단위는 (상권 × 업종) 조합 — 같은 업종 다른 상권도, 같은 상권 다른 업종도 담긴다.
  // 비교 화면은 담긴 조합의 분석 응답을 그대로 나란히 놓기만 한다 (useCompare 주석 참조).
  const COMPARE_MAX = 3;
  const [compareItems, setCompareItems] = useState<{ sangwonCode: number; industryCode: string }[]>([]);
  const compareQueries = useCompare(compareItems);
  const compareResults = compareQueries
    .map((q) => q.data)
    .filter((d): d is NonNullable<typeof d> => !!d);
  const compareLoading = compareQueries.filter((q) => q.isPending).length;

  const isInCompare = useCallback(
    (sangwonCode: number, industryCode: string) =>
      compareItems.some((i) => i.sangwonCode === sangwonCode && i.industryCode === industryCode),
    [compareItems]
  );
  const toggleCompare = useCallback(
    (sangwonCode: number, industryCode: string) => {
      // ⚠️ inspect() 는 setState 업데이터 **밖에서** 호출한다.
      //    업데이터는 렌더 중에 실행될 수 있어서, 그 안에서 인스펙터 스토어를 건드리면
      //    "Cannot update a component while rendering a different component" 경고가 난다.
      const hit = compareItems.some(
        (i) => i.sangwonCode === sangwonCode && i.industryCode === industryCode
      );
      if (hit) {
        inspect("res", `비교에서 제외 — 상권 ${sangwonCode} × ${industryCode}`);
        setCompareItems((prev) =>
          prev.filter((i) => !(i.sangwonCode === sangwonCode && i.industryCode === industryCode))
        );
        return;
      }
      if (compareItems.length >= COMPARE_MAX) {
        inspect("err", `비교는 최대 ${COMPARE_MAX}개까지입니다 — 먼저 하나를 빼주세요`);
        return;
      }
      inspect(
        "req",
        `비교에 담기 — 상권 ${sangwonCode} × ${industryCode} (${compareItems.length + 1}/${COMPARE_MAX})`
      );
      setCompareItems((prev) => [...prev, { sangwonCode, industryCode }]);
    },
    [compareItems]
  );

  // golmok '나의 등수' 패턴: 선택 업종이 이 상권의 업종 중 기회점수 몇 위인지
  const rankingContext = useMemo(() => {
    const ranking = topIndustries.data;
    const res = analyze.data;
    if (!ranking || !res || ranking.sangwon.code !== res.sangwon.code) return null;
    const sorted = [...ranking.industries].sort((a, b) => b.opportunityScore - a.opportunityScore);
    const idx = sorted.findIndex((i) => i.code === res.industry.code);
    if (idx < 0) return null;
    return {
      rank: idx + 1,
      total: sorted.length,
      opportunityScore: sorted[idx].opportunityScore,
    };
  }, [topIndustries.data, analyze.data]);

  /** 실측을 쓴 경우에만 그 출처를 리포트 ⑨ 목록에 덧붙인다 (목업이면 붙이지 않음) */
  const extraSources = useMemo(() => {
    const out: string[] = [];
    if (safety.data?.sourceMode === "file") out.push(...(safety.data.sources ?? []));
    if (hinterlandQ.data?.sourceMode === "file") out.push(...(hinterlandQ.data.sources ?? []));
    return [...new Set(out)];
  }, [safety.data, hinterlandQ.data]);

  // ---- 종합점수 (상권 간, 이 업종) — 치안 미반영/반영 두 버전을 미리 계산 ----
  // base = 매출 백분위 60% + 생존율(셀 간 백분위) 40%  ← 가중치는 화면에 명시되는 정책값
  // withSafety = base×95% + 자치구 안전점수×5%       ← 모델 정본(overall_diagnosis)과 동일 비중
  const compositeScores = useMemo(() => {
    const cells = heatmap.data?.cells;
    if (!cells || !cells.length) return null;
    const survVals = cells
      .map((c) => c.survivalProbability)
      .filter((v): v is number => v != null)
      .sort((a, b) => a - b);
    const survPct = (v: number): number | null => {
      if (!survVals.length) return null;
      let below = 0;
      let equal = 0;
      for (const x of survVals) {
        if (x < v) below += 1;
        else if (x === v) equal += 1;
      }
      return ((below + equal * 0.5) / survVals.length) * 100;
    };
    const base: Record<number, number> = {};
    const withSafety: Record<number, number> = {};
    for (const c of cells) {
      const parts: { v: number; w: number }[] = [];
      if (c.salesPercentile != null) parts.push({ v: c.salesPercentile, w: 0.6 });
      const sp = c.survivalProbability != null ? survPct(c.survivalProbability) : null;
      if (sp != null) parts.push({ v: sp, w: 0.4 });
      if (!parts.length) continue;
      const wsum = parts.reduce((a, p) => a + p.w, 0);
      const b = parts.reduce((a, p) => a + p.v * p.w, 0) / wsum;
      base[c.sangwonCode] = Math.round(b * 10) / 10;
      const guScore = c.gu ? safety.data?.byGu[c.gu]?.score : undefined;
      withSafety[c.sangwonCode] =
        guScore != null ? Math.round((b * 0.95 + guScore * 0.05) * 10) / 10 : base[c.sangwonCode];
    }
    return { base, withSafety };
  }, [heatmap.data, safety.data]);

  const safetyIsMock = safety.data?.sourceMode === "mock";

  /**
   * 리포트 ⑥ 치안 타일용 — /api/safety 실데이터를 SafetyDetail 형태로 변환.
   * 서빙(detail.safety)이 채워지면 그쪽이 우선이고, 이건 그 다음 순위다.
   * 목업일 때는 null 을 주어 ResultPanel 의 예시 데이터 경로가 그대로 동작하게 한다.
   */
  const safetyFromScores = useMemo(() => {
    const res = analyze.data;
    const gu = res?.sangwon.gu;
    const s = gu ? safety.data?.byGu[gu] : undefined;
    if (!s || safetyIsMock || s.totalIncidents == null) return null;
    return {
      year: safety.data?.year ?? "unknown",
      guName: gu ?? null,
      totalIncidents: s.totalIncidents,
      byType: s.byType ?? null,
      rankAmongGus: s.rankAmongGus ?? null,
      guCount: s.guCount ?? null,
      seoulAvgIncidents: s.seoulAvgIncidents ?? null,
      per100k: s.crimeRatePer100k,
      granularity: "gu",
    };
  }, [analyze.data, safety.data, safetyIsMock]);

  // 리포트 ⑥ 치안 섹션의 이중 점수 카드 — 이 상권의 미반영/반영 점수·순위 비교
  const scoreComparison = useMemo(() => {
    const res = analyze.data;
    const cs = compositeScores;
    if (!res || res.status !== "ok" || !cs) return null;
    if (heatmap.data?.industryCode !== res.industry.code) return null;
    const code = res.sangwon.code;
    const base = cs.base[code];
    const adjusted = cs.withSafety[code];
    if (base == null || adjusted == null) return null;
    const rankOf = (map: Record<number, number>, v: number) =>
      Object.values(map).filter((x) => x > v).length + 1;
    const guInfo = res.sangwon.gu ? safety.data?.byGu[res.sangwon.gu] : undefined;
    return {
      base,
      adjusted,
      baseRank: rankOf(cs.base, base),
      adjustedRank: rankOf(cs.withSafety, adjusted),
      total: Object.keys(cs.base).length,
      safetyScore: guInfo?.score ?? null,
      guName: res.sangwon.gu ?? null,
      isMock: safetyIsMock,
      weightsNote: safety.data?.weightsNote ?? "",
    };
  }, [analyze.data, compositeScores, heatmap.data, safety.data, safetyIsMock]);

  const sangwons = meta.data?.sangwons ?? [];
  const industries = meta.data?.industries ?? [];
  const selectedSangwon = sangwons.find((s) => s.code === selectedCode) ?? null;

  /**
   * 지역 우선 모드인데 이 상권에 업종 순위 데이터가 없는 경우.
   * 지도 목록이 랭킹 사전계산보다 넓어서 발생한다(현재 74개 상권).
   * 이때 업종 셀렉트를 열어주지 않으면 다음 단계로 갈 방법이 없어 완전히 막힌다.
   */
  const rankingUnavailable =
    mode === "location" &&
    selectedCode != null &&
    !!topIndustries.data &&
    topIndustries.data.sangwon.code === selectedCode &&
    topIndustries.data.industries.length === 0;

  const runAnalyze = useCallback(
    (sangwonCode: number, industry: string) => {
      hasAnalyzedRef.current = true;
      analyze.mutate({ sangwonCode, industryCode: industry });
    },
    [analyze]
  );

  // ---- 위치 먼저: 지도 클릭 → 최근접 상권 매핑 (UC-001 / UC-005) ----
  const handlePickPoint = useCallback(
    (lat: number, lng: number) => {
      inspect("map", `지도 클릭 — (${lat.toFixed(6)}, ${lng.toFixed(6)})`, { lat, lng });
      setPickedPoint({ lat, lng });
      const found = nearestSangwon(sangwons, lat, lng);
      if (!found) return;

      if (!found.withinBoundary) {
        inspect(
          "geo",
          `경계 밖 — 최근접 ${found.sangwon.name} ${found.distanceMeters}m (허용 ${MAX_SNAP_METERS}m 초과)`,
          { nearest: found.sangwon, distanceMeters: found.distanceMeters }
        );
        setSelectedCode(null);
        setBoundaryNotice({
          message: `클릭한 지점 반경 ${MAX_SNAP_METERS}m 안에 분석 대상 상권이 없습니다.`,
          suggestion: {
            code: found.sangwon.code,
            name: found.sangwon.name,
            distance: found.distanceMeters,
          },
        });
        return;
      }

      inspect(
        "geo",
        `좌표→상권 매핑 — ${found.sangwon.name} (${found.distanceMeters}m, 후보 ${sangwons.length}개 중 최근접)`,
        { matched: found.sangwon, distanceMeters: found.distanceMeters }
      );
      setBoundaryNotice(null);
      setSelectedCode(found.sangwon.code);
      // 지역 우선 플로우: 새 위치를 고르면 이전 분석은 접고 그 상권의 업종 랭킹부터 보여준다.
      analyze.reset();
    },
    [sangwons, analyze]
  );

  // ---- 업종 먼저: 히트맵 셀/리스트에서 상권 선택 → 즉시 분석 (UC-002) ----
  const handleSelectSangwon = useCallback(
    (code: number) => {
      const s = sangwons.find((x) => x.code === code);
      inspect("map", `상권 선택 — ${s?.name ?? code} (코드 ${code})`, s);
      setBoundaryNotice(null);
      setSelectedCode(code);
      if (industryCode) {
        runAnalyze(code, industryCode);
      }
    },
    [industryCode, runAnalyze, sangwons]
  );

  const handleIndustryChange = (code: string) => {
    setIndustryCode(code);
    // 지역 우선 모드는 상권이 이미 확정된 상태이므로 첫 선택에도 바로 분석한다.
    // (업종 순위가 없는 상권에서 업종을 직접 고르는 경로 — 안 그러면 아무 반응이 없다)
    if (selectedCode != null && code && (hasAnalyzedRef.current || mode === "location")) {
      runAnalyze(selectedCode, code);
    }
  };

  const switchMode = (m: Mode) => {
    setMode(m);
    setBoundaryNotice(null);
  };

  /** 이력 클릭 → 해당 상권×업종 재조회 (스냅샷 재생이 아니라 최신 데이터로 다시 분석) */
  const handlePickHistory = useCallback(
    (e: HistoryEntry) => {
      setBoundaryNotice(null);
      setIndustryCode(e.industryCode);
      setSelectedCode(e.sangwonCode);
      runAnalyze(e.sangwonCode, e.industryCode);
    },
    [runAnalyze]
  );

  return (
    <div className="flex h-full flex-col lg:flex-row">
      {/* ── 좌: 지도 ─────────────────────────────────────── */}
      <main className="relative min-h-[38vh] min-w-0 flex-1 lg:min-h-0">
        <MapView
          mode={mode}
          sangwons={sangwons}
          heatmap={heatmap.data ?? null}
          heatmapMetric={heatmapMetric}
          composite={
            heatmapMetric === "composite" && compositeScores
              ? {
                  byCode: safetyOn ? compositeScores.withSafety : compositeScores.base,
                  safetyOn,
                  safetyIsMock: safetyIsMock,
                }
              : null
          }
          selectedCode={selectedCode}
          highlightCode={highlightCode}
          pickedPoint={pickedPoint}
          onPickPoint={handlePickPoint}
          onSelectSangwon={handleSelectSangwon}
        />
        <InspectorConsole />
      </main>

      {/* ── 우: 컨트롤 + 결과 패널 ──────────────────────── */}
      <aside className="panel-texture flex min-h-0 w-full flex-1 shrink-0 flex-col border-t border-line/70 bg-ink-900 lg:w-[440px] lg:flex-none lg:border-l lg:border-t-0">
        {/* 브랜드 */}
        <header className="border-b border-line/60 px-6 pb-4 pt-5">
          <div className="flex items-baseline justify-between">
            <h1 className="font-[family-name:var(--font-display)] text-xl font-semibold tracking-tight text-fg">
              상권 <span className="text-gold">인사이트</span>
            </h1>
            <span className="text-[10px] uppercase tracking-[0.2em] text-faint">
              AI Research · Demo
            </span>
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-muted">
            &ldquo;이 자리에 이 업종, 들어가도 될까?&rdquo; — 실측 생존율과 AI 매출 예측으로 답합니다
          </p>
        </header>

        {/* 모드 토글 */}
        <div className="px-6 pt-4">
          <div className="grid grid-cols-2 gap-1 rounded-xl border border-line/70 bg-ink-800/70 p-1">
            {(
              [
                ["location", "자리부터 찾기", "이 자리 어때?"],
                ["industry", "업종부터 찾기", "어디가 좋아?"],
              ] as const
            ).map(([m, label, sub]) => (
              <button
                key={m}
                onClick={() => switchMode(m)}
                className={`rounded-lg px-3 py-2 text-left transition ${
                  mode === m
                    ? "bg-ink-600 shadow-inner"
                    : "opacity-55 hover:opacity-90"
                }`}
              >
                <div className={`text-[13px] font-semibold ${mode === m ? "text-gold-soft" : "text-fg"}`}>
                  {label}
                </div>
                <div className="text-[10px] text-faint">{sub}</div>
              </button>
            ))}
          </div>
        </div>

        {/* 조건 입력 */}
        <div className="space-y-3 px-6 py-4">
          {(mode === "industry" || rankingUnavailable) && (
            <div>
              <label className="mb-1.5 block text-[11px] font-medium text-muted">
                업종{" "}
                <span className="text-gold">
                  {rankingUnavailable
                    ? "— 선택하면 이 상권의 보고서가 열립니다"
                    : "— 선택하면 히트맵이 그려집니다"}
                </span>
              </label>
              <select
                value={industryCode}
                onChange={(e) => handleIndustryChange(e.target.value)}
                className="w-full appearance-none rounded-lg border border-line bg-ink-800 px-3.5 py-2.5 text-sm text-fg outline-none focus:border-gold/60"
              >
                <option value="">업종을 선택하세요</option>
                {industries.map((i) => (
                  <option key={i.code} value={i.code}>
                    {i.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* 히트맵 색 기준 토글 (업종 먼저 모드) */}
          {mode === "industry" && industryCode && (
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2 text-[11px]">
                <span className="text-faint">히트맵 기준</span>
                {(
                  [
                    ["sales", "매출 백분위"],
                    ["survival", "생존율"],
                    ["composite", "종합점수"],
                  ] as const
                ).map(([k, label]) => (
                  <button
                    key={k}
                    onClick={() => setHeatmapMetric(k)}
                    className={`rounded-full border px-2.5 py-1 transition ${
                      heatmapMetric === k
                        ? "border-gold/60 bg-gold/10 text-gold-soft"
                        : "border-line text-muted hover:border-gold/30"
                    }`}
                  >
                    {label}
                  </button>
                ))}
                {heatmapMetric === "survival" &&
                  heatmap.data?.survivalGranularity === "seoul_industry" && (
                    <span className="text-faint">※ 업종 단위 통계 — 상권 간 동일</span>
                  )}
              </div>
              {/* 치안 반영 토글 — 종합점수에서만 의미 (자치구 안전점수 5%) */}
              {heatmapMetric === "composite" && (
                <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted">
                  <input
                    type="checkbox"
                    checked={safetyOn}
                    onChange={(e) => setSafetyOn(e.target.checked)}
                    className="h-3.5 w-3.5 accent-[#4ad6c0]"
                  />
                  치안 반영 <span className="text-faint">(자치구 안전점수 5% 가중)</span>
                  {safetyIsMock ? (
                    <span className="rounded border border-caution/40 bg-caution/10 px-1 py-px text-[9px] text-caution">
                      예시 데이터
                    </span>
                  ) : (
                    safety.data && (
                      <span className="rounded border border-line bg-ink-700/60 px-1 py-px text-[9px] text-muted">
                        실측 {safety.data.year}
                        {safety.data.cctvYear ? ` · CCTV ${safety.data.cctvYear}` : ""}
                      </span>
                    )
                  )}
                </label>
              )}
            </div>
          )}

          {/* 선택된 상권 표시 */}
          {selectedSangwon && (
            <div className="flex items-center justify-between rounded-lg border border-gold/25 bg-gold/5 px-3.5 py-2.5">
              <div>
                <div className="text-[10px] text-faint">선택한 곳</div>
                <div className="text-sm font-medium text-fg">
                  {selectedSangwon.name}
                  <span className="ml-2 text-[11px] text-muted">
                    {[selectedSangwon.gu, selectedSangwon.dong].filter(Boolean).join(" ")}
                  </span>
                </div>
              </div>
              <button
                onClick={() => setSelectedCode(null)}
                className="text-xs text-faint transition hover:text-fg"
                aria-label="상권 선택 해제"
              >
                ✕
              </button>
            </div>
          )}

          {/* 상권 경계 밖 안내 (UC-005) */}
          {boundaryNotice && (
            <div className="rounded-lg border border-caution/30 bg-caution/5 px-3.5 py-3 text-xs leading-relaxed text-muted">
              {boundaryNotice.message}
              {boundaryNotice.suggestion && (
                <button
                  onClick={() => handleSelectSangwon(boundaryNotice.suggestion!.code)}
                  className="mt-2 block w-full rounded-md border border-line bg-ink-700/70 px-3 py-2 text-left text-fg transition hover:border-gold/50"
                >
                  가장 가까운 상권 사용:{" "}
                  <b>{boundaryNotice.suggestion.name}</b>
                  <span className="ml-1 text-faint">
                    ({boundaryNotice.suggestion.distance}m)
                  </span>
                </button>
              )}
            </div>
          )}

          {/* 위치 먼저 모드: 상권을 고르면 우측에 업종 랭킹이 뜨고, 업종을 누르면 분석됩니다 */}
          {mode === "location" && selectedSangwon && !rankingUnavailable && (
            <p className="rounded-lg border border-line/50 bg-ink-800/40 px-3.5 py-2 text-[11px] leading-relaxed text-muted">
              아래에서 이 상권의 <span className="text-gold-soft">업종별 기회</span>를 확인하고 업종을 선택하세요.
            </p>
          )}
        </div>

        {/* 결과 영역 */}
        <div className="panel-scroll flex-1 space-y-3.5 overflow-y-auto px-6 pb-4">
          {/* 비교 바스켓 — 담긴 게 있으면 리포트 위에 항상 보인다 (golmok compare_analysis) */}
          <ComparePanel
            results={compareResults}
            loadingCount={compareLoading}
            onRemove={(s, i) => toggleCompare(s, i)}
            onClear={() => {
              inspect("res", "비교 목록 비움");
              setCompareItems([]);
            }}
          />
          {analyze.isPending ? (
            <LoadingState />
          ) : analyze.isError ? (
            <ErrorState
              message={analyze.error.message}
              onRetry={() =>
                selectedCode != null &&
                industryCode &&
                runAnalyze(selectedCode, industryCode)
              }
            />
          ) : analyze.data ? (
            <ResultPanel
              result={analyze.data}
              rankingContext={rankingContext}
              scoreComparison={scoreComparison}
              safetyFromScores={safetyFromScores}
              hinterland={hinterlandQ.data ?? null}
              extraSources={extraSources}
              inCompare={isInCompare(analyze.data.sangwon.code, analyze.data.industry.code)}
              compareCount={compareItems.length}
              onToggleCompare={() =>
                toggleCompare(analyze.data!.sangwon.code, analyze.data!.industry.code)
              }
              onChangeIndustry={() => {
                if (mode === "location") {
                  /* 위치 고정 — 업종 랭킹으로 되돌아가 다른 업종 선택 */
                  analyze.reset();
                } else {
                  /* 업종 셀렉트로 유도 (변경 시 자동 재질의) */
                  document.querySelector<HTMLSelectElement>("aside select")?.focus();
                }
              }}
              onChangeLocation={() => {
                /* 다른 위치 — 선택 해제 후 지도 클릭 대기 */
                setSelectedCode(null);
                setPickedPoint(null);
                analyze.reset();
              }}
            />
          ) : mode === "location" && selectedCode != null ? (
            <TopIndustriesPanel
              state={topIndustries}
              onPick={(code) => {
                setIndustryCode(code);
                runAnalyze(selectedCode!, code);
              }}
            />
          ) : mode === "industry" && industryCode && heatmap.data ? (
            /* 업종 먼저: 색칠만으로는 "어디가 좋은데?"에 답이 안 된다 — 상위 10곳을 순위로 (golmok Top-10 패턴) */
            <TopSangwonsPanel
              heatmap={heatmap.data}
              metric={heatmapMetric}
              compositeByCode={
                heatmapMetric === "composite" && compositeScores
                  ? (safetyOn ? compositeScores.withSafety : compositeScores.base)
                  : null
              }
              safetyOn={safetyOn}
              industryName={industries.find((i) => i.code === industryCode)?.name ?? null}
              onHover={setHighlightCode}
              onPick={(code) => {
                setHighlightCode(null);
                handleSelectSangwon(code);
              }}
            />
          ) : !onboarded && selectedCode == null && !industryCode && !pickedPoint && !hasAnalyzedRef.current ? (
            /* 첫 진입: 기능 나열 대신 질문으로 시작 (golmok 온보딩 패턴) + 재방문자용 이력 */
            <>
              <OnboardingCard
                onPickLocation={() => {
                  setOnboarded(true);
                  switchMode("location");
                }}
                onPickIndustry={() => {
                  setOnboarded(true);
                  switchMode("industry");
                  setTimeout(
                    () => document.querySelector<HTMLSelectElement>("aside select")?.focus(),
                    80
                  );
                }}
              />
              <RecentHistory
                entries={history}
                onPick={handlePickHistory}
                onClear={clearHistory}
              />
            </>
          ) : (
            <>
              <IdleState mode={mode} />
              <RecentHistory
                entries={history}
                onPick={handlePickHistory}
                onClear={clearHistory}
              />
            </>
          )}
        </div>

        {/* 전역 면책 */}
        <footer className="border-t border-line/60 px-6 py-2.5 text-center text-[10px] leading-relaxed text-faint">
          본 데모의 모든 수치는 공공데이터 기반 추정·통계 참고 지표이며, 투자·창업 결정의 근거가 아닌 탐색 도구입니다.
        </footer>
      </aside>
    </div>
  );
}

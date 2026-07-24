"use client";
/**
 * 메인 화면 — 지도(좌) / 컨트롤·결과 패널(우) 단일 분할 (PRD §5)
 *
 * 두 진입 모드가 하나의 결과 카드로 수렴한다:
 *  - 위치 먼저(UC-001): 지도 클릭 → 상권 확정 → 업종 선택 → 분석
 *  - 업종 먼저(UC-002): 업종 선택 → 히트맵 → 상권 클릭 → 분석
 *  - 재탐색(UC-003): 결과 이후 조건 변경 시 자동 재질의
 */
import { useCallback, useMemo, useRef, useState } from "react";

import InspectorConsole from "@/components/InspectorConsole";
import MapView, { type HeatmapMetric } from "@/components/MapView";
import ResultPanel, {
  ErrorState,
  IdleState,
  LoadingState,
  OnboardingCard,
} from "@/components/ResultPanel";
import TopIndustriesPanel from "@/components/TopIndustriesPanel";
import { nearestSangwon, MAX_SNAP_METERS } from "@/lib/geo";
import { useAnalyze, useHeatmap, useMeta, useTopIndustries } from "@/lib/hooks";
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

  /** 첫 분석 이후에는 조건 변경 시 자동 재질의 (재탐색 루프) */
  const hasAnalyzedRef = useRef(false);

  const heatmap = useHeatmap(industryCode || null, mode === "industry");
  // 상권 업종 랭킹 — 위치 먼저 모드의 중간 단계이자, 리포트의 '상권 내 기회 순위' 소스.
  // 업종 먼저 모드에서도 상권이 정해지면 순위 맥락을 위해 로드한다 (파일 캐시라 가벼움).
  const topIndustries = useTopIndustries(selectedCode);

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

  const sangwons = meta.data?.sangwons ?? [];
  const industries = meta.data?.industries ?? [];
  const selectedSangwon = sangwons.find((s) => s.code === selectedCode) ?? null;

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
    if (hasAnalyzedRef.current && selectedCode != null && code) {
      runAnalyze(selectedCode, code);
    }
  };

  const switchMode = (m: Mode) => {
    setMode(m);
    setBoundaryNotice(null);
  };

  return (
    <div className="flex h-full flex-col lg:flex-row">
      {/* ── 좌: 지도 ─────────────────────────────────────── */}
      <main className="relative min-h-[38vh] min-w-0 flex-1 lg:min-h-0">
        <MapView
          mode={mode}
          sangwons={sangwons}
          heatmap={heatmap.data ?? null}
          heatmapMetric={heatmapMetric}
          selectedCode={selectedCode}
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
          {mode === "industry" && (
            <div>
              <label className="mb-1.5 block text-[11px] font-medium text-muted">
                업종 <span className="text-gold">— 선택하면 히트맵이 그려집니다</span>
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
            <div className="flex items-center gap-2 text-[11px]">
              <span className="text-faint">히트맵 기준</span>
              {(
                [
                  ["sales", "매출 백분위"],
                  ["survival", "생존율"],
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
          {mode === "location" && selectedSangwon && (
            <p className="rounded-lg border border-line/50 bg-ink-800/40 px-3.5 py-2 text-[11px] leading-relaxed text-muted">
              아래에서 이 상권의 <span className="text-gold-soft">업종별 기회</span>를 확인하고 업종을 선택하세요.
            </p>
          )}
        </div>

        {/* 결과 영역 */}
        <div className="panel-scroll flex-1 overflow-y-auto px-6 pb-4">
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
          ) : !onboarded && selectedCode == null && !industryCode && !pickedPoint && !hasAnalyzedRef.current ? (
            /* 첫 진입: 기능 나열 대신 질문으로 시작 (golmok 온보딩 패턴) */
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
          ) : (
            <IdleState mode={mode} />
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

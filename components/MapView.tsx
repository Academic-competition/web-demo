"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * MapView — 좌측 지도 영역
 *
 * - 카카오맵 SDK 동적 로드 (NEXT_PUBLIC_KAKAO_MAP_KEY)
 * - 위치 먼저 모드: 클릭 → 좌표 전달(상위에서 최근접 상권 매핑)
 * - 업종 먼저 모드: 히트맵 셀(원형 오버레이) 렌더 + 클릭 선택
 * - 키가 없으면 상권 검색 리스트 폴백 → 지도 없이도 데모가 끊기지 않음 (UC-006 철학)
 */
import { useEffect, useMemo, useRef, useState } from "react";

import type { HeatmapResult, MetaResult } from "@/lib/contracts";

declare global {
  interface Window {
    kakao: any;
  }
}

type Sangwon = MetaResult["sangwons"][number];

export type HeatmapMetric = "sales" | "survival";

const SEOUL_CENTER = { lat: 37.5665, lng: 126.978 };
const KAKAO_KEY = process.env.NEXT_PUBLIC_KAKAO_MAP_KEY;

// ------------------------------------------------------------------
// 색 스케일
// ------------------------------------------------------------------
function lerpColor(a: string, b: string, t: number): string {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  const c = pa.map((v, i) => Math.round(v + (pb[i] - v) * t));
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

function cellColor(cell: HeatmapResult["cells"][number], metric: HeatmapMetric): string {
  if (metric === "survival") {
    if (cell.grade === "safe") return "#3ddc97";
    if (cell.grade === "caution") return "#f5b84b";
    if (cell.grade === "risk") return "#f0655d";
    return "#5b6683";
  }
  const t = Math.min(Math.max((cell.salesPercentile ?? 0) / 100, 0), 1);
  return lerpColor("#3a486e", "#e3b65a", t);
}

// ------------------------------------------------------------------
// 카카오 SDK 로더
// ------------------------------------------------------------------
function useKakaoLoaded(): "loading" | "ready" | "unavailable" {
  const [state, setState] = useState<"loading" | "ready" | "unavailable">(
    KAKAO_KEY ? "loading" : "unavailable"
  );

  useEffect(() => {
    if (!KAKAO_KEY) return;
    if (window.kakao?.maps) {
      setState("ready");
      return;
    }
    const script = document.createElement("script");
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${KAKAO_KEY}&autoload=false`;
    script.async = true;
    script.onload = () => window.kakao.maps.load(() => setState("ready"));
    script.onerror = () => setState("unavailable");
    document.head.appendChild(script);
  }, []);

  return state;
}

// ------------------------------------------------------------------
// 메인 컴포넌트
// ------------------------------------------------------------------
export default function MapView({
  mode,
  sangwons,
  heatmap,
  heatmapMetric,
  selectedCode,
  pickedPoint,
  onPickPoint,
  onSelectSangwon,
}: {
  mode: "location" | "industry";
  sangwons: Sangwon[];
  heatmap: HeatmapResult | null;
  heatmapMetric: HeatmapMetric;
  selectedCode: number | null;
  pickedPoint: { lat: number; lng: number } | null;
  onPickPoint: (lat: number, lng: number) => void;
  onSelectSangwon: (code: number) => void;
}) {
  const sdkState = useKakaoLoaded();

  if (sdkState === "unavailable") {
    return (
      <FallbackPicker
        mode={mode}
        sangwons={sangwons}
        heatmap={heatmap}
        heatmapMetric={heatmapMetric}
        selectedCode={selectedCode}
        onSelectSangwon={onSelectSangwon}
        reason={
          KAKAO_KEY
            ? "지도 SDK 로드 실패 — 네트워크 또는 카카오 콘솔(도메인 등록/서비스 활성화)을 확인하세요"
            : "지도 키 미설정 — NEXT_PUBLIC_KAKAO_MAP_KEY 설정 시 지도 표시"
        }
      />
    );
  }

  if (sdkState === "loading") {
    return (
      <div className="flex h-full items-center justify-center bg-ink-900 text-sm text-muted">
        지도를 불러오는 중…
      </div>
    );
  }

  return (
    <KakaoMap
      mode={mode}
      heatmap={heatmap}
      heatmapMetric={heatmapMetric}
      sangwons={sangwons}
      selectedCode={selectedCode}
      pickedPoint={pickedPoint}
      onPickPoint={onPickPoint}
      onSelectSangwon={onSelectSangwon}
    />
  );
}

// ------------------------------------------------------------------
// 실제 카카오맵
// ------------------------------------------------------------------
function KakaoMap({
  mode,
  heatmap,
  heatmapMetric,
  sangwons,
  selectedCode,
  pickedPoint,
  onPickPoint,
  onSelectSangwon,
}: {
  mode: "location" | "industry";
  heatmap: HeatmapResult | null;
  heatmapMetric: HeatmapMetric;
  sangwons: Sangwon[];
  selectedCode: number | null;
  pickedPoint: { lat: number; lng: number } | null;
  onPickPoint: (lat: number, lng: number) => void;
  onSelectSangwon: (code: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const circlesRef = useRef<any[]>([]);
  const selectedOverlayRef = useRef<any>(null);
  const pickedMarkerRef = useRef<any>(null);
  const clickHandlerRef = useRef(onPickPoint);
  clickHandlerRef.current = onPickPoint;
  const modeRef = useRef(mode);
  modeRef.current = mode;

  // 지도 생성 (1회)
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const kakao = window.kakao;
    const map = new kakao.maps.Map(containerRef.current, {
      center: new kakao.maps.LatLng(SEOUL_CENTER.lat, SEOUL_CENTER.lng),
      level: 8,
    });
    kakao.maps.event.addListener(map, "click", (e: any) => {
      if (modeRef.current !== "location") return;
      clickHandlerRef.current(e.latLng.getLat(), e.latLng.getLng());
    });
    mapRef.current = map;
  }, []);

  // 히트맵 셀 렌더 (업종 먼저 모드)
  useEffect(() => {
    const kakao = window.kakao;
    const map = mapRef.current;
    if (!map) return;

    circlesRef.current.forEach((c) => c.setMap(null));
    circlesRef.current = [];

    if (mode !== "industry" || !heatmap) return;

    for (const cell of heatmap.cells) {
      if (cell.lat == null || cell.lon == null) continue;
      const color = cellColor(cell, heatmapMetric);
      const circle = new kakao.maps.Circle({
        center: new kakao.maps.LatLng(cell.lat, cell.lon),
        radius: 110,
        strokeWeight: 0,
        fillColor: color,
        fillOpacity: 0.62,
      });
      circle.setMap(map);
      kakao.maps.event.addListener(circle, "click", () =>
        onSelectSangwon(cell.sangwonCode)
      );
      circlesRef.current.push(circle);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, heatmap, heatmapMetric]);

  // 선택 상권 하이라이트 + 이동
  useEffect(() => {
    const kakao = window.kakao;
    const map = mapRef.current;
    if (!map) return;

    selectedOverlayRef.current?.setMap(null);
    selectedOverlayRef.current = null;

    if (selectedCode == null) return;
    const s = sangwons.find((x) => x.code === selectedCode);
    if (!s || s.lat == null || s.lon == null) return;

    const pos = new kakao.maps.LatLng(s.lat, s.lon);
    const overlay = new kakao.maps.CustomOverlay({
      position: pos,
      yAnchor: 1.25,
      content: `
        <div style="display:flex;flex-direction:column;align-items:center;pointer-events:none;">
          <div style="background:#0e1526;color:#e9edf6;border:1px solid #e3b65a;
                      border-radius:8px;padding:4px 10px;font-size:12px;font-weight:600;
                      box-shadow:0 4px 14px rgba(0,0,0,.45);white-space:nowrap;">
            ${s.name ?? s.code}
          </div>
          <div style="width:2px;height:10px;background:#e3b65a;"></div>
          <div style="width:10px;height:10px;border-radius:50%;background:#e3b65a;
                      border:2px solid #0e1526;box-shadow:0 0 0 4px rgba(227,182,90,.25);"></div>
        </div>`,
    });
    overlay.setMap(map);
    selectedOverlayRef.current = overlay;
    map.panTo(pos);
    if (map.getLevel() > 6) map.setLevel(6, { anchor: pos });
  }, [selectedCode, sangwons]);

  // 클릭 지점 마커 (위치 먼저 모드)
  useEffect(() => {
    const kakao = window.kakao;
    const map = mapRef.current;
    if (!map) return;
    pickedMarkerRef.current?.setMap(null);
    pickedMarkerRef.current = null;
    if (!pickedPoint || mode !== "location") return;
    const marker = new kakao.maps.Marker({
      position: new kakao.maps.LatLng(pickedPoint.lat, pickedPoint.lng),
    });
    marker.setMap(map);
    pickedMarkerRef.current = marker;
  }, [pickedPoint, mode]);

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      {/* 범례 */}
      {mode === "industry" && heatmap && (
        <div className="absolute bottom-4 left-4 z-10 rounded-lg border border-line/70 bg-ink-900/90 px-3.5 py-2.5 text-[11px] text-muted backdrop-blur">
          {heatmapMetric === "sales" ? (
            <div className="flex items-center gap-2">
              <span>매출 백분위</span>
              <span className="inline-block h-2 w-16 rounded-full bg-gradient-to-r from-[#3a486e] to-gold" />
              <span className="text-faint">낮음 → 높음</span>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-safe" />양호</span>
              <span className="flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-caution" />주의</span>
              <span className="flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-risk" />위험</span>
            </div>
          )}
        </div>
      )}
      {mode === "location" && (
        <div className="absolute left-4 top-4 z-10 rounded-lg border border-line/70 bg-ink-900/90 px-3.5 py-2 text-[11px] text-muted backdrop-blur">
          지도를 클릭하면 가장 가까운 상권을 찾아드립니다
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------
// 지도 키가 없을 때의 폴백: 상권 검색/랭킹 리스트
// ------------------------------------------------------------------
function FallbackPicker({
  mode,
  sangwons,
  heatmap,
  heatmapMetric,
  selectedCode,
  onSelectSangwon,
  reason,
}: {
  mode: "location" | "industry";
  sangwons: Sangwon[];
  heatmap: HeatmapResult | null;
  heatmapMetric: HeatmapMetric;
  selectedCode: number | null;
  onSelectSangwon: (code: number) => void;
  reason: string;
}) {
  const [query, setQuery] = useState("");

  const rows = useMemo(() => {
    if (mode === "industry" && heatmap) {
      const sorted = [...heatmap.cells].sort((a, b) =>
        heatmapMetric === "sales"
          ? (b.salesPercentile ?? 0) - (a.salesPercentile ?? 0)
          : (b.survivalProbability ?? 0) - (a.survivalProbability ?? 0)
      );
      return sorted
        .filter(
          (c) =>
            !query ||
            (c.sangwonName ?? "").includes(query) ||
            (c.gu ?? "").includes(query)
        )
        .slice(0, 60)
        .map((c) => ({
          code: c.sangwonCode,
          name: c.sangwonName,
          sub: c.gu,
          chip:
            heatmapMetric === "sales"
              ? `상위 ${(100 - (c.salesPercentile ?? 0)).toFixed(0)}%`
              : `${(((c.survivalProbability ?? 0) * 100)).toFixed(0)}%`,
          color: cellColor(c, heatmapMetric),
        }));
    }
    return sangwons
      .filter(
        (s) =>
          !query ||
          (s.name ?? "").includes(query) ||
          (s.gu ?? "").includes(query) ||
          (s.dong ?? "").includes(query)
      )
      .slice(0, 60)
      .map((s) => ({
        code: s.code,
        name: s.name,
        sub: [s.gu, s.dong].filter(Boolean).join(" "),
        chip: s.category ?? "",
        color: "#3a486e",
      }));
  }, [mode, sangwons, heatmap, heatmapMetric, query]);

  return (
    <div className="flex h-full flex-col bg-ink-900">
      <div className="border-b border-line/60 px-5 py-4">
        <div className="mb-1 text-[11px] font-medium text-caution">
          ● 검색 모드로 동작 중 · {reason}
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="상권명 · 자치구 · 행정동 검색"
          className="mt-2 w-full rounded-lg border border-line bg-ink-800 px-3.5 py-2.5 text-sm text-fg outline-none placeholder:text-faint focus:border-gold/60"
        />
        {mode === "industry" && heatmap && (
          <div className="mt-2 text-[11px] text-muted">
            {heatmap.industryName ?? heatmap.industryCode} ·{" "}
            {heatmapMetric === "sales" ? "매출 백분위" : "생존율"} 순 정렬
          </div>
        )}
      </div>
      <div className="panel-scroll flex-1 overflow-y-auto px-3 py-2">
        {rows.map((r, i) => (
          <button
            key={r.code}
            onClick={() => onSelectSangwon(r.code)}
            className={`mb-1 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition ${
              selectedCode === r.code
                ? "border border-gold/60 bg-ink-700"
                : "border border-transparent hover:bg-ink-800"
            }`}
          >
            <span className="w-6 shrink-0 text-right text-[11px] text-faint" style={{ fontFamily: "var(--font-numeric)" }}>
              {i + 1}
            </span>
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: r.color }} />
            <span className="flex-1 truncate">
              <span className="text-sm text-fg">{r.name ?? r.code}</span>
              <span className="ml-2 text-[11px] text-faint">{r.sub}</span>
            </span>
            {r.chip && (
              <span className="shrink-0 text-[11px] text-muted" style={{ fontFamily: "var(--font-numeric)" }}>
                {r.chip}
              </span>
            )}
          </button>
        ))}
        {rows.length === 0 && (
          <div className="px-3 py-8 text-center text-sm text-faint">검색 결과가 없습니다</div>
        )}
      </div>
    </div>
  );
}

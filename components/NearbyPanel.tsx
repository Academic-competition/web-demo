"use client";
/**
 * NearbyPanel — 클릭/검색 지점 주변 상권 (golmok '나는 사장' 분석영역(반경) 대응)
 *
 * golmok 은 보행권역/보행시간/반경·다각형으로 영역을 잡아 **재집계**하지만,
 * 우리는 반경 안의 상권 **목록**을 보여주고 개별 리포트로 연결한다 —
 * 영역 합산 수치를 웹이 만들면 "웹은 수치를 만들지 않는다" 원칙이 깨진다.
 * (보행권역은 보행 네트워크 데이터가 없어 불가 — GOLMOK-PARITY ❌ 항목)
 *
 * 거리 계산(haversine)은 좌표 필터일 뿐 데이터 값을 만들지 않는다.
 */
import { useMemo, useState } from "react";

import type { MetaResult } from "@/lib/contracts";
import { sangwonsWithin } from "@/lib/geo";

const RADII = [300, 500, 1000] as const;

export default function NearbyPanel({
  sangwons,
  point,
  selectedCode,
  onPick,
}: {
  sangwons: MetaResult["sangwons"];
  point: { lat: number; lng: number };
  selectedCode: number | null;
  onPick: (code: number) => void;
}) {
  const [radius, setRadius] = useState<(typeof RADII)[number]>(500);
  const [open, setOpen] = useState(false);

  const rows = useMemo(
    () => sangwonsWithin(sangwons, point.lat, point.lng, radius),
    [sangwons, point, radius]
  );

  if (!rows.length) return null;

  return (
    <div className="rounded-xl border border-line/60 bg-ink-800/40 px-3 py-2">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between text-left"
      >
        <span className="text-[12px] text-muted">
          선택 지점 주변 상권 <b className="text-fg">{rows.length}개</b>
          <span className="text-faint"> · 반경 {radius >= 1000 ? "1km" : `${radius}m`}</span>
        </span>
        <span className="text-[11px] text-faint">{open ? "접기 ▴" : "펼치기 ▾"}</span>
      </button>

      {open && (
        <div className="mt-2 space-y-2">
          <div className="flex gap-1">
            {RADII.map((r) => (
              <button
                key={r}
                onClick={() => setRadius(r)}
                className={`rounded-md border px-2 py-0.5 text-[10px] transition ${
                  radius === r
                    ? "border-gold/60 bg-ink-700/70 text-gold-soft"
                    : "border-line/50 text-faint hover:text-muted"
                }`}
              >
                {r >= 1000 ? "1km" : `${r}m`}
              </button>
            ))}
          </div>
          <ul className="max-h-48 space-y-1 overflow-y-auto pr-1">
            {rows.map(({ sangwon, distanceMeters }) => (
              <li key={sangwon.code}>
                <button
                  onClick={() => onPick(sangwon.code)}
                  className={`group flex w-full items-center gap-2 rounded-md border px-2.5 py-1.5 text-left transition hover:border-gold/60 hover:bg-ink-700/60 ${
                    selectedCode === sangwon.code
                      ? "border-gold/60 bg-ink-700/60"
                      : "border-line/40 bg-ink-800/30"
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate text-[12px] text-fg transition group-hover:text-gold-soft">
                    {sangwon.name}
                  </span>
                  <span className="shrink-0 text-[10px] text-faint" style={{ fontFamily: "var(--font-numeric)" }}>
                    {distanceMeters}m
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <p className="text-[10px] leading-relaxed text-faint">
            지점 좌표 기준 직선거리입니다. 상권을 클릭하면 그 상권 분석으로 이동합니다
            (영역 합산이 아니라 상권 단위 리포트 — 집계 기준이 섞이지 않습니다).
          </p>
        </div>
      )}
    </div>
  );
}

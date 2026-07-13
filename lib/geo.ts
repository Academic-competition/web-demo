/**
 * geo.ts — 좌표→상권 매핑 (위치 먼저 모드, UC-001/UC-005)
 *
 * 지도 클릭 좌표에서 가장 가까운 상권을 찾는다.
 * MAX_SNAP_METERS 밖이면 "분석 대상 상권이 아님" + 최근접 제안 (UC-005).
 */
import type { MetaResult } from "./contracts";

export const MAX_SNAP_METERS = 500;

type Sangwon = MetaResult["sangwons"][number];

export function haversineMeters(
  lat1: number, lon1: number, lat2: number, lon2: number
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function nearestSangwon(
  sangwons: Sangwon[], lat: number, lon: number
): { sangwon: Sangwon; distanceMeters: number; withinBoundary: boolean } | null {
  let best: Sangwon | null = null;
  let bestDist = Infinity;
  for (const s of sangwons) {
    if (s.lat == null || s.lon == null) continue;
    const d = haversineMeters(lat, lon, s.lat, s.lon);
    if (d < bestDist) {
      bestDist = d;
      best = s;
    }
  }
  if (!best) return null;
  return {
    sangwon: best,
    distanceMeters: Math.round(bestDist),
    withinBoundary: bestDist <= MAX_SNAP_METERS,
  };
}

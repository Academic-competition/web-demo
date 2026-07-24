/** 공용 포맷터 — 리포트/차트에서 동일 표기 유지 */

export function formatKRW(v: number): string {
  if (v >= 1e8) return `${(v / 1e8).toFixed(1)}억 원`;
  if (v >= 1e4) return `${Math.round(v / 1e4).toLocaleString()}만 원`;
  return `${v.toLocaleString()}원`;
}

/** 축약형 (차트 라벨용) — "8.1억", "1,454만" */
export function formatKRWCompact(v: number): string {
  if (v >= 1e8) return `${(v / 1e8).toFixed(1)}억`;
  if (v >= 1e4) return `${Math.round(v / 1e4).toLocaleString()}만`;
  return `${Math.round(v).toLocaleString()}`;
}

/** 유동인구: 만 단위 이상은 "N만 명", 미만은 실수치 (0만으로 뭉개지 않게 — 정직성) */
export function formatPeople(v: number): string {
  if (v >= 1e4) return `${(v / 1e4).toFixed(0)}만 명`;
  return `${Math.round(v).toLocaleString()}명`;
}

/** 증감률(%) — base 대비 current. base가 0/None이면 null */
export function pctChange(current: number | null, base: number | null): number | null {
  if (current == null || base == null || base === 0) return null;
  return ((current - base) / Math.abs(base)) * 100;
}

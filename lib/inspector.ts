"use client";
/**
 * inspector.ts — 인스펙터 콘솔용 경량 이벤트 스토어
 *
 * 지도 상호작용 → 좌표→상권 매핑 → 내부 API 요청 → 모델 서버 외부 호출 →
 * 정규화 응답까지의 흐름을 시간순으로 기록한다. (데모 투명성/디버깅용)
 */
import { useSyncExternalStore } from "react";

export type InspectorKind =
  | "map" // 지도 상호작용 (클릭, 셀 선택)
  | "geo" // 좌표→상권 매핑 계산
  | "req" // 내부 API 요청 (브라우저 → Next 서버)
  | "model" // 외부 모델 서버 호출 (Next 서버 → FastAPI, debug 트레이스)
  | "res" // 정규화된 최종 응답
  | "file" // 사전계산 파일 로드 (히트맵)
  | "err"; // 오류/폴백

export type InspectorEntry = {
  id: number;
  at: string; // HH:MM:SS.mmm
  kind: InspectorKind;
  title: string;
  durationMs?: number;
  /** 펼쳐 볼 수 있는 JSON 페이로드 */
  detail?: unknown;
};

const MAX_ENTRIES = 200;

let entries: InspectorEntry[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function notify() {
  for (const l of listeners) l();
}

function timestamp(): string {
  const d = new Date();
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

export function inspect(
  kind: InspectorKind,
  title: string,
  detail?: unknown,
  durationMs?: number
) {
  entries = [
    ...entries.slice(-(MAX_ENTRIES - 1)),
    { id: nextId++, at: timestamp(), kind, title, detail, durationMs },
  ];
  notify();
}

export function clearInspector() {
  entries = [];
  notify();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useInspector(): InspectorEntry[] {
  return useSyncExternalStore(
    subscribe,
    () => entries,
    () => entries
  );
}

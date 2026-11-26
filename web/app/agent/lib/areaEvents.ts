import { track, type TelemetryKind } from "./telemetry";

const sentOnce = new Set<string>();

/** Tracks an area event; does nothing until the session exists. */
export function trackArea(
  kind: TelemetryKind,
  sessionId: string | null,
  areaId: string,
  payload?: Record<string, unknown>,
): void {
  if (!sessionId) return;
  track(kind, { sessionId, areaId, ...(payload ? { payload } : {}) });
}

/** Like trackArea, but at most once per area per session (impressions, sheet opens). */
export function trackAreaOnce(
  kind: TelemetryKind,
  sessionId: string | null,
  areaId: string,
  payload?: Record<string, unknown>,
): void {
  const key = `${kind}:${sessionId}:${areaId}`;
  if (!sessionId || sentOnce.has(key)) return;
  sentOnce.add(key);
  trackArea(kind, sessionId, areaId, payload);
}

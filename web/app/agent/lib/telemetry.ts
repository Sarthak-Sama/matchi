// Best-effort feedback events: queued, then sent in batches with sendBeacon
// when the browser is idle and when the page is hidden or closed.

export type TelemetryKind =
  | "impression"
  | "open"
  | "like"
  | "dislike"
  | "map_click"
  | "listing_click"
  | "share"
  | "chosen";

export interface TelemetryData {
  sessionId: string;
  areaId?: string;
  payload?: Record<string, unknown>;
}

// Same base URL rule as client.ts.
const DEFAULT_API_BASE_URL = "http://localhost:4000";
const MAX_BATCH = 50; // the API's limit
const IDLE_FLUSH_MS = 3_000;

const queue: (TelemetryData & { kind: TelemetryKind })[] = [];
let flushScheduled = false;

export function flush(): void {
  flushScheduled = false;
  const url = `${process.env.NEXT_PUBLIC_API_BASE_URL ?? DEFAULT_API_BASE_URL}/v1/agent/events`;
  while (queue.length > 0) {
    const items = queue.splice(0, MAX_BATCH);
    // text/plain keeps the beacon a simple request: no CORS preflight while the page closes.
    navigator.sendBeacon(url, new Blob([JSON.stringify({ items })], { type: "text/plain" }));
  }
}

export function track(kind: TelemetryKind, data: TelemetryData): void {
  queue.push({ kind, ...data });
  if (flushScheduled) return;
  flushScheduled = true;
  if (typeof requestIdleCallback === "function") requestIdleCallback(flush, { timeout: IDLE_FLUSH_MS });
  else setTimeout(flush, IDLE_FLUSH_MS);
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
}

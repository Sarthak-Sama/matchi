import type { AgentStreamEvent } from "./types";

export type TraceTone = "neutral" | "ok" | "bad";

export interface TraceEntry {
  id: number;
  at: number;
  source: "chat" | "engine";
  kind: string;
  summary: string;
  detail?: unknown;
  tone: TraceTone;
}

let nextId = 1;

export function engineEntry(summary: string, detail?: unknown, tone: TraceTone = "neutral"): TraceEntry {
  return { id: nextId++, at: Date.now(), source: "engine", kind: "engine", summary, detail, tone };
}

/** Text deltas are not traced one by one; the caller adds one entry per reply. */
export function entryFromEvent(event: AgentStreamEvent): TraceEntry | null {
  const base = { id: nextId++, at: Date.now(), source: "chat" as const };
  switch (event.type) {
    case "text":
      return null;
    case "tool_call":
      return { ...base, kind: "tool_call", summary: `call ${event.name}`, detail: event.input, tone: "neutral" };
    case "tool_result":
      return {
        ...base,
        kind: "tool_result",
        summary: `${event.name} ${event.ok ? "returned" : "failed"}`,
        detail: event.result,
        tone: event.ok ? "ok" : "bad",
      };
    case "state":
      return {
        ...base,
        kind: "state",
        summary: `state: ${event.state.evidence.length} evidence, ${event.state.recommendation?.shortlist.length ?? 0} shortlisted`,
        tone: "neutral",
      };
    case "grounding":
      return {
        ...base,
        kind: "grounding",
        summary: event.pass
          ? "grounding check: pass"
          : `grounding check: FAIL (${event.failures.length} figure${event.failures.length === 1 ? "" : "s"} not in a tool result)`,
        detail: event.failures.length > 0 ? event.failures : undefined,
        tone: event.pass ? "ok" : "bad",
      };
    case "done":
      return { ...base, kind: "done", summary: "turn done", tone: "neutral" };
    case "error":
      return {
        ...base,
        kind: "error",
        summary: `error${event.code ? ` (${event.code})` : ""}: ${event.message}`,
        tone: "bad",
      };
  }
}

const MAX_QUERY_LABEL = 40;

/** One plain line for what the guide is doing now, shown under the typing indicator. */
export function stepLabel(name: string, input?: unknown): string {
  switch (name) {
    case "lookup": {
      const query = (input as { query?: unknown } | null)?.query;
      return typeof query === "string" && query.trim() !== ""
        ? `Looking up ${query.trim().slice(0, MAX_QUERY_LABEL)}…`
        : "Looking up a place…";
    }
    case "set_profile":
      return "Updating your brief…";
    case "observe":
      return "Noting what you told me…";
    case "remove_evidence":
      return "Taking that out of your brief…";
    case "recommend":
      return "Re-ranking areas…";
    case "why_not":
      return "Checking why that area isn’t on the list…";
    case "relax":
      return "Testing looser limits…";
    case "compare":
      return "Comparing the two areas…";
    case "query_areas":
      return "Searching the area data…";
    case "grounding":
      return "Checking the figures…";
    default:
      return "Working on it…";
  }
}

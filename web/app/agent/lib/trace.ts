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

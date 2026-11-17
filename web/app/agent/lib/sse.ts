import type { AgentStreamEvent } from "./types";

const EVENT_TYPES = new Set(["text", "tool_call", "tool_result", "state", "grounding", "done", "error"]);

/**
 * Incremental SSE parser. Feed it decoded text chunks; it returns the events
 * completed so far and keeps the unfinished tail. Each SSE message's `data:`
 * lines are joined and parsed as one AgentStreamEvent JSON object. Messages
 * that are comments, empty, malformed or not an AgentStreamEvent are skipped.
 */
export class SseParser {
  private buffer = "";

  push(chunk: string): AgentStreamEvent[] {
    this.buffer += chunk.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const out: AgentStreamEvent[] = [];
    let boundary = this.buffer.indexOf("\n\n");
    while (boundary >= 0) {
      const raw = this.buffer.slice(0, boundary);
      this.buffer = this.buffer.slice(boundary + 2);
      const event = parseMessage(raw);
      if (event) out.push(event);
      boundary = this.buffer.indexOf("\n\n");
    }
    return out;
  }

  /** Call at end of stream: a final message without the blank line still counts. */
  flush(): AgentStreamEvent[] {
    const raw = this.buffer;
    this.buffer = "";
    if (raw.trim() === "") return [];
    const event = parseMessage(raw);
    return event ? [event] : [];
  }
}

function parseMessage(raw: string): AgentStreamEvent | null {
  const data: string[] = [];
  for (const line of raw.split("\n")) {
    if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
  }
  if (data.length === 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(data.join("\n"));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const type = (parsed as { type?: unknown }).type;
  if (typeof type !== "string" || !EVENT_TYPES.has(type)) return null;
  return parsed as AgentStreamEvent;
}

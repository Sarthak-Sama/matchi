import { ApiClientError } from "../../../lib/api";
import { SseParser } from "./sse";
import type {
  AgentStateView,
  AgentStreamEvent,
  Comparison,
  Evidence,
  ObserveResult,
  Profile,
  ProfileResult,
  RelaxOption,
  WhyNot,
} from "./types";

// Same base URL rule as web/lib/api.ts (NEXT_PUBLIC_API_BASE_URL, local default).
const DEFAULT_API_BASE_URL = "http://localhost:4000";
const REQUEST_TIMEOUT_MS = 30_000;

function apiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? DEFAULT_API_BASE_URL;
}

async function send<T>(method: string, path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl()}${path}`, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "TimeoutError") {
      throw new ApiClientError("TIMEOUT", "The API took too long to respond.");
    }
    throw new ApiClientError(
      "NETWORK_ERROR",
      "Could not reach the API. Check that the API server is running (and that CORS allows this method).",
    );
  }
  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    parsed = undefined;
  }
  if (!response.ok) {
    const err = (parsed as { error?: { code?: unknown; message?: unknown; details?: unknown } } | undefined)
      ?.error;
    if (err && typeof err.code === "string" && typeof err.message === "string") {
      throw new ApiClientError(err.code, err.message, err.details);
    }
    throw new ApiClientError("UNKNOWN_ERROR", `Request failed with status ${response.status}`);
  }
  return parsed as T;
}

export interface SessionResponse {
  sessionId: string;
  view: AgentStateView;
}
export interface ViewResponse {
  view: AgentStateView;
}

/**
 * The direct (engine-only) routes, as fixed in the P3/P5 briefs. The bodies of
 * why-not, compare and relax are not specified beyond their inputs; they are
 * assumed to be `{ result, view? }` like the profile route.
 */
export const agentApi = {
  createSession: () => send<SessionResponse>("POST", "/v1/agent/session", {}),
  getSession: (id: string) => send<ViewResponse>("GET", `/v1/agent/session/${encodeURIComponent(id)}`),
  putProfile: (id: string, profile: Profile) =>
    send<{ result: ProfileResult; view: AgentStateView }>(
      "PUT",
      `/v1/agent/session/${encodeURIComponent(id)}/profile`,
      profile,
    ),
  addEvidence: (id: string, items: Evidence[]) =>
    send<{ results: ObserveResult[]; view: AgentStateView }>(
      "POST",
      `/v1/agent/session/${encodeURIComponent(id)}/evidence`,
      { items },
    ),
  removeEvidence: (id: string, evidenceId: string) =>
    send<ViewResponse>(
      "DELETE",
      `/v1/agent/evidence/${encodeURIComponent(evidenceId)}?sessionId=${encodeURIComponent(id)}`,
    ),
  recommend: (id: string, k?: number) =>
    send<ViewResponse>(
      "POST",
      `/v1/agent/session/${encodeURIComponent(id)}/recommend`,
      k === undefined ? {} : { k },
    ),
  whyNot: (id: string, localityId: string) =>
    send<{ result: WhyNot; view?: AgentStateView }>(
      "POST",
      `/v1/agent/session/${encodeURIComponent(id)}/why-not`,
      { localityId },
    ),
  compare: (id: string, a: string, b: string) =>
    send<{ result: Comparison; view?: AgentStateView }>(
      "POST",
      `/v1/agent/session/${encodeURIComponent(id)}/compare`,
      { a, b },
    ),
  relax: (id: string) =>
    send<{ result: RelaxOption[]; view?: AgentStateView }>(
      "POST",
      `/v1/agent/session/${encodeURIComponent(id)}/relax`,
      {},
    ),
};

/**
 * POST /v1/agent/turn and yield the SSE events as they arrive. A non-2xx status,
 * a missing body or a dropped connection becomes a synthetic `error` event so
 * the caller has one path for "chat is not available".
 */
export async function* streamTurn(
  sessionId: string,
  message: string,
  signal?: AbortSignal,
): AsyncGenerator<AgentStreamEvent> {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl()}/v1/agent/turn`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify({ sessionId, message }),
      signal,
    });
  } catch {
    if (signal?.aborted) return;
    yield { type: "error", message: "Could not reach the API.", code: "NETWORK_ERROR" };
    return;
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!response.ok || !response.body || !contentType.includes("text/event-stream")) {
    let message = `Chat is not available (status ${response.status}).`;
    let code: string | undefined;
    try {
      const body = (await response.json()) as { error?: { code?: string; message?: string } };
      if (body.error?.message) message = body.error.message;
      code = body.error?.code;
    } catch {
      // keep the default message
    }
    yield { type: "error", message, code };
    return;
  }

  const parser = new SseParser();
  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      for (const event of parser.push(decoder.decode(value, { stream: true }))) yield event;
    }
    for (const event of parser.push(decoder.decode())) yield event;
    for (const event of parser.flush()) yield event;
  } catch {
    if (signal?.aborted) return;
    yield { type: "error", message: "The chat stream was interrupted.", code: "STREAM_INTERRUPTED" };
  } finally {
    reader.releaseLock();
  }
}

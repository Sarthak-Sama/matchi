/**
 * `fetch` wrapper for the Matchi API: `getJson`/`postJson` against
 * `NEXT_PUBLIC_API_BASE_URL`, throwing a typed `ApiClientError` carrying the
 * API's own `{ error: { code, message, details? } }` shape on HTTP errors,
 * network failures, and timeouts alike, so callers branch on `.code` only.
 */

const DEFAULT_API_BASE_URL = "http://localhost:4000";

/** `/v1/optimize` runs a full candidate scan plus a Dijkstra pass, so this is generous. */
const REQUEST_TIMEOUT_MS = 30_000;

function apiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? DEFAULT_API_BASE_URL;
}

interface ApiErrorBody {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly details?: unknown;
  };
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== "object" || value === null || !("error" in value)) return false;
  const err = (value as { error: unknown }).error;
  if (typeof err !== "object" || err === null) return false;
  const { code, message } = err as { code?: unknown; message?: unknown };
  return typeof code === "string" && typeof message === "string";
}

/** Thrown by `getJson`/`postJson` for both HTTP error responses and network failures. */
export class ApiClientError extends Error {
  readonly code: string;
  readonly details?: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ApiClientError";
    this.code = code;
    this.details = details;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl()}${path}`, {
      ...init,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "TimeoutError") {
      throw new ApiClientError("TIMEOUT", "The API took too long to respond. Please try again.");
    }
    throw new ApiClientError(
      "NETWORK_ERROR",
      "Could not reach the API. Check your connection and that the API server is running.",
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }

  if (!response.ok) {
    if (isApiErrorBody(body)) {
      throw new ApiClientError(body.error.code, body.error.message, body.error.details);
    }
    throw new ApiClientError("UNKNOWN_ERROR", `Request failed with status ${response.status}`);
  }

  return body as T;
}

export function getJson<T>(path: string): Promise<T> {
  return request<T>(path, { method: "GET" });
}

export function postJson<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

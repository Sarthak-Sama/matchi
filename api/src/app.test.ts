/**
 * Tests for the global error handler's public contract: every error
 * response is `{ error: { code, message, details? } }`, Zod validation
 * failures map to 400 `VALIDATION_ERROR` with flattened details, and no
 * response body ever leaks a stack trace — plus the security headers and
 * rate limits every response passes through.
 */

import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { buildApp } from "./app.js";
import type { DbPool } from "./db.js";
import { emptyGraphs, testConfig } from "./test-support/fixtures.js";

function testPool(): DbPool {
  return { query: vi.fn().mockResolvedValue({ rows: [] }) };
}

describe("error handler", () => {
  it("maps a Zod validation failure to 400 VALIDATION_ERROR with flattened details and no stack trace", async () => {
    const app = buildApp({ config: testConfig(), pool: testPool(), graphs: emptyGraphs() });
    // A real ZodError, thrown from a route handler exactly like a `/v1`
    // route validating a request body would.
    app.get("/__test/zod-error", async () => {
      z.object({ name: z.string() }).parse({ name: 42 });
    });

    const response = await app.inject({ method: "GET", url: "/__test/zod-error" });
    await app.close();

    expect(response.statusCode).toBe(400);
    const body = response.json() as {
      error: { code: string; message: string; details?: { fieldErrors: Record<string, string[]> } };
    };
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(typeof body.error.message).toBe("string");
    expect(body.error.details).toBeDefined();
    expect(body.error.details?.fieldErrors["name"]).toBeDefined();
    expect(Object.keys(body)).toEqual(["error"]);
    expect(Object.keys(body.error).sort()).toEqual(["code", "details", "message"]);
    const raw = JSON.stringify(body);
    expect(raw).not.toContain("stack");
    expect(raw).not.toMatch(/at .+:\d+:\d+/);
  });

  it("maps an unexpected error to 500 INTERNAL_ERROR without leaking the message or a stack trace", async () => {
    const app = buildApp({ config: testConfig(), pool: testPool(), graphs: emptyGraphs() });
    app.get("/__test/boom", async () => {
      throw new Error("boom: sensitive internal detail");
    });

    const response = await app.inject({ method: "GET", url: "/__test/boom" });
    await app.close();

    expect(response.statusCode).toBe(500);
    const body = response.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(body.error.message).toBe("An unexpected error occurred");
    expect(Object.keys(body)).toEqual(["error"]);
    expect(Object.keys(body.error).sort()).toEqual(["code", "message"]);
    const raw = JSON.stringify(body);
    expect(raw).not.toContain("boom: sensitive internal detail");
    expect(raw).not.toContain("stack");
    expect(raw).not.toMatch(/at .+:\d+:\d+/);
  });
});

describe("security headers", () => {
  it("sets helmet's headers, and a cross-origin CORP so a browser app on another origin can read responses", async () => {
    const app = buildApp({ config: testConfig(), pool: testPool(), graphs: emptyGraphs() });

    const response = await app.inject({ method: "GET", url: "/health" });
    await app.close();

    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["referrer-policy"]).toBe("no-referrer");
    expect(response.headers["strict-transport-security"]).toContain("max-age=");
    // `same-origin` (helmet's default) would break the web app entirely.
    expect(response.headers["cross-origin-resource-policy"]).toBe("cross-origin");
    // Disabled deliberately: this API serves only JSON.
    expect(response.headers["content-security-policy"]).toBeUndefined();
  });
});

describe("rate limiting", () => {
  it("returns 429 in the API's own error envelope once the limit is exceeded", async () => {
    const app = buildApp({
      config: testConfig({ RATE_LIMIT_MAX: 2 }),
      pool: testPool(),
      graphs: emptyGraphs(),
    });

    const ok = await Promise.all([1, 2].map(() => app.inject({ method: "GET", url: "/health" })));
    const limited = await app.inject({ method: "GET", url: "/health" });
    await app.close();

    expect(ok.map((r) => r.statusCode)).toEqual([200, 200]);
    expect(limited.statusCode).toBe(429);
    const body = limited.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe("RATE_LIMITED");
    expect(Object.keys(body)).toEqual(["error"]);
  });

  it("holds /v1/optimize to its own stricter budget than the global one", async () => {
    const app = buildApp({
      config: testConfig({ RATE_LIMIT_MAX: 100, RATE_LIMIT_OPTIMIZE_MAX: 1 }),
      pool: testPool(),
      graphs: emptyGraphs(),
    });

    const first = await app.inject({ method: "POST", url: "/v1/optimize", payload: {} });
    const second = await app.inject({ method: "POST", url: "/v1/optimize", payload: {} });
    // Well under the global 100, so this proves the per-route limit applies.
    const health = await app.inject({ method: "GET", url: "/health" });
    await app.close();

    expect(first.statusCode).not.toBe(429);
    expect(second.statusCode).toBe(429);
    expect((second.json() as { error: { code: string } }).error.code).toBe("RATE_LIMITED");
    expect(health.statusCode).toBe(200);
  });
});

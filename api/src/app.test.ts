/**
 * Tests for the global error handler's public contract: every error
 * response is `{ error: { code, message, details? } }`, Zod validation
 * failures map to 400 `VALIDATION_ERROR` with flattened details, and no
 * response body ever leaks a stack trace.
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

/**
 * `GET /health` tests. Uses `app.inject()` with an injected fake pool —
 * no real database involved, by design (see `buildApp`'s dependency
 * injection).
 */

import { describe, expect, it, vi } from "vitest";

import { buildApp } from "../app.js";
import type { DbPool } from "../db.js";
import { emptyGraphs, testConfig } from "../test-support/fixtures.js";

describe("GET /health", () => {
  it("returns 200 with status ok when the database responds", async () => {
    const pool: DbPool = { query: vi.fn().mockResolvedValue({ rows: [{ "?column?": 1 }] }) };
    const app = buildApp({ config: testConfig(), pool, graphs: emptyGraphs() });

    const response = await app.inject({ method: "GET", url: "/health" });
    await app.close();

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      status: string;
      uptimeSeconds: number;
      database: { reachable: boolean; latencyMs: number | null };
      version: string;
    };
    expect(body.status).toBe("ok");
    expect(body.database.reachable).toBe(true);
    expect(typeof body.database.latencyMs).toBe("number");
    expect(body.database.latencyMs).not.toBeNull();
    expect(typeof body.uptimeSeconds).toBe("number");
    expect(body.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(body.version).toBe("0.0.0");
    expect(pool.query).toHaveBeenCalledWith("select 1");
  });

  it("returns 503 with status degraded when the database query rejects", async () => {
    const pool: DbPool = { query: vi.fn().mockRejectedValue(new Error("connection refused")) };
    const app = buildApp({ config: testConfig(), pool, graphs: emptyGraphs() });

    const response = await app.inject({ method: "GET", url: "/health" });
    await app.close();

    expect(response.statusCode).toBe(503);
    const body = response.json() as {
      status: string;
      database: { reachable: boolean; latencyMs: number | null };
    };
    expect(body.status).toBe("degraded");
    expect(body.database.reachable).toBe(false);
    expect(body.database.latencyMs).toBeNull();
  });
});

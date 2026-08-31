import { describe, expect, it, vi } from "vitest";

import { buildApp } from "../app.js";
import type { DbPool } from "../db.js";
import { emptyGraphs, testConfig } from "../test-support/fixtures.js";

function fakePool(rows: unknown[] = []): DbPool {
  return { query: vi.fn().mockResolvedValue({ rows }) };
}

function buildTestApp(pool: DbPool) {
  return buildApp({ config: testConfig(), pool, graphs: emptyGraphs() });
}

const SHIBUYA_ROW = {
  stationGroupId: "sg-shibuya",
  nameEn: "Shibuya",
  nameJa: "渋谷",
  aliases: [],
  lat: 35.658,
  lon: 139.7016,
  lines: ["JR Yamanote Line", "Tokyu Toyoko Line"],
};

describe("GET /v1/stations", () => {
  it("requires a query parameter", async () => {
    const app = buildTestApp(fakePool());
    const response = await app.inject({ method: "GET", url: "/v1/stations" });
    await app.close();

    expect(response.statusCode).toBe(400);
    const body = response.json() as { error: { code: string; details: { path: string }[] } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.details.some((d) => d.path === "query")).toBe(true);
  });

  it("rejects an empty query string", async () => {
    const app = buildTestApp(fakePool());
    const response = await app.inject({ method: "GET", url: "/v1/stations?query=" });
    await app.close();

    expect(response.statusCode).toBe(400);
    const body = response.json() as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns results matching the shared schema for a valid query", async () => {
    const pool = fakePool([SHIBUYA_ROW]);
    const app = buildTestApp(pool);

    const response = await app.inject({ method: "GET", url: "/v1/stations?query=shibuya" });
    await app.close();

    expect(response.statusCode).toBe(200);
    const body = response.json() as { results: { stationGroupId: string; nameEn: string }[] };
    expect(body.results).toHaveLength(1);
    expect(body.results[0]?.stationGroupId).toBe("sg-shibuya");
    expect(body.results[0]?.nameEn).toBe("Shibuya");
  });

  it("passes the default limit (10) through to the query when not specified", async () => {
    const pool = fakePool([]);
    const app = buildTestApp(pool);

    await app.inject({ method: "GET", url: "/v1/stations?query=shibuya" });
    await app.close();

    expect(pool.query).toHaveBeenCalledWith(expect.any(String), ["shibuya", 10]);
  });

  it("respects an explicit limit", async () => {
    const pool = fakePool([]);
    const app = buildTestApp(pool);

    await app.inject({ method: "GET", url: "/v1/stations?query=shibuya&limit=3" });
    await app.close();

    expect(pool.query).toHaveBeenCalledWith(expect.any(String), ["shibuya", 3]);
  });

  it("caps a limit above 50 at exactly 50 rather than rejecting the request", async () => {
    const pool = fakePool([]);
    const app = buildTestApp(pool);

    const response = await app.inject({
      method: "GET",
      url: "/v1/stations?query=shibuya&limit=500",
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(pool.query).toHaveBeenCalledWith(expect.any(String), ["shibuya", 50]);
  });

  it("rejects a non-positive limit", async () => {
    const app = buildTestApp(fakePool());
    const response = await app.inject({ method: "GET", url: "/v1/stations?query=shibuya&limit=0" });
    await app.close();

    expect(response.statusCode).toBe(400);
  });

  it("escapes LIKE wildcards so a typed % is matched literally, not as `match everything`", async () => {
    const pool = fakePool();
    const app = buildTestApp(pool);
    await app.inject({ method: "GET", url: "/v1/stations?query=%25" });
    await app.close();

    expect(pool.query).toHaveBeenCalledWith(expect.any(String), ["\\%", 10]);
  });

  it("a bare % returns nothing, not the whole station table", async () => {
    const pool = fakePool([]);
    const app = buildTestApp(pool);

    const response = await app.inject({ method: "GET", url: "/v1/stations?query=%25" });
    await app.close();

    expect(response.statusCode).toBe(200);
    const body = response.json() as { results: unknown[] };
    expect(body.results).toHaveLength(0);
  });

  it("rejects a query longer than the 100-character cap", async () => {
    const app = buildTestApp(fakePool());
    const response = await app.inject({
      method: "GET",
      url: `/v1/stations?query=${"a".repeat(101)}`,
    });
    await app.close();

    expect(response.statusCode).toBe(400);
  });
});

/**
 * `GET /v1/places` tests.
 *
 * Query-shape and response-mapping tests use `app.inject()` against a fake
 * pool; the ranking itself — the part that actually decides whether a user
 * finds their office — is tested against the real seeded database, since a
 * fake pool cannot tell you that a station outranks the forty POIs whose
 * names contain the same word.
 */

import { PLACES_LIMIT, placesResponseSchema } from "@tokyo/shared";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { buildApp } from "../app.js";
import type { DbPool } from "../db.js";
import { emptyGraphs, testConfig } from "../test-support/fixtures.js";

function fakePool(rows: unknown[] = []): DbPool {
  return { query: vi.fn().mockResolvedValue({ rows }) };
}

function buildTestApp(pool: DbPool) {
  return buildApp({ config: testConfig(), pool, graphs: emptyGraphs() });
}

const STATION_ROW = {
  kind: "station",
  id: "sg-shibuya",
  name: "Shibuya",
  nameJa: "渋谷",
  category: null,
  lat: 35.658,
  lon: 139.7016,
};

const POI_ROW = {
  kind: "poi",
  id: "poi:42",
  name: "Shibuya Cafe 1",
  nameJa: null,
  category: "cafe",
  lat: 35.6585,
  lon: 139.702,
};

describe("GET /v1/places", () => {
  it("requires a query parameter", async () => {
    const app = buildTestApp(fakePool());
    const response = await app.inject({ method: "GET", url: "/v1/places" });
    await app.close();

    expect(response.statusCode).toBe(400);
    const body = response.json() as { error: { code: string; details: { path: string }[] } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.details.some((d) => d.path === "query")).toBe(true);
  });

  it("rejects an empty query string", async () => {
    const app = buildTestApp(fakePool());
    const response = await app.inject({ method: "GET", url: "/v1/places?query=" });
    await app.close();

    expect(response.statusCode).toBe(400);
  });

  it("returns stations and POIs in one list, matching the shared schema", async () => {
    const app = buildTestApp(fakePool([STATION_ROW, POI_ROW]));
    const response = await app.inject({ method: "GET", url: "/v1/places?query=shibuya" });
    await app.close();

    expect(response.statusCode).toBe(200);
    const body = placesResponseSchema.parse(response.json());
    expect(body.results).toHaveLength(2);
    expect(body.results[0]).toEqual({
      kind: "station",
      id: "sg-shibuya",
      name: "Shibuya",
      nameJa: "渋谷",
      category: null,
      lat: 35.658,
      lon: 139.7016,
    });
    expect(body.results[1]?.kind).toBe("poi");
    expect(body.results[1]?.category).toBe("cafe");
  });

  it("binds the user's query as a parameter and caps the list at PLACES_LIMIT", async () => {
    const pool = fakePool();
    const app = buildTestApp(pool);
    await app.inject({ method: "GET", url: "/v1/places?query=shibuya" });
    await app.close();

    expect(pool.query).toHaveBeenCalledWith(expect.any(String), ["shibuya", PLACES_LIMIT]);
    // The query text itself must never contain the user's input.
    const sql = (pool.query as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(sql).not.toContain("shibuya");
  });

  it("escapes LIKE wildcards so a typed % is matched literally, not as `match everything`", async () => {
    const pool = fakePool();
    const app = buildTestApp(pool);
    await app.inject({ method: "GET", url: "/v1/places?query=%25" });
    await app.close();

    expect(pool.query).toHaveBeenCalledWith(expect.any(String), ["\\%", PLACES_LIMIT]);
  });

  it("rejects a query longer than the 100-character cap", async () => {
    const app = buildTestApp(fakePool());
    const response = await app.inject({
      method: "GET",
      url: `/v1/places?query=${"a".repeat(101)}`,
    });
    await app.close();

    expect(response.statusCode).toBe(400);
    const body = response.json() as { error: { code: string; details: { path: string }[] } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.details.some((d) => d.path === "query")).toBe(true);
  });

  it("accepts a query at exactly the cap", async () => {
    const app = buildTestApp(fakePool());
    const response = await app.inject({
      method: "GET",
      url: `/v1/places?query=${"a".repeat(100)}`,
    });
    await app.close();

    expect(response.statusCode).toBe(200);
  });

  it("rejects an unknown query parameter rather than ignoring it", async () => {
    const app = buildTestApp(fakePool());
    const response = await app.inject({ method: "GET", url: "/v1/places?query=a&limit=5" });
    await app.close();

    expect(response.statusCode).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Integration — real PostGIS, real seeded pois + station_groups.
// ---------------------------------------------------------------------------

const databaseUrl = process.env["DATABASE_URL"];
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function runCli(script: string): void {
  execFileSync("npx", ["tsx", script], {
    cwd: REPO_ROOT,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: "pipe",
  });
}

describe.runIf(Boolean(databaseUrl))("GET /v1/places (integration)", () => {
  let pool: Pool;

  beforeAll(() => {
    if (!databaseUrl) return;
    runCli("scripts/src/migrate.ts");
    runCli("scripts/src/seed.ts");
    pool = new Pool({ connectionString: databaseUrl });
  }, 60_000);

  afterAll(async () => {
    if (!databaseUrl) return;
    await pool.end();
  });

  it("returns BOTH a station and a POI for a query that matches both tables", async () => {
    const app = buildApp({ config: testConfig(), pool, graphs: emptyGraphs() });
    const response = await app.inject({ method: "GET", url: "/v1/places?query=shibuya" });
    await app.close();

    expect(response.statusCode).toBe(200);
    const body = placesResponseSchema.parse(response.json());

    const station = body.results.find((r) => r.kind === "station");
    const poi = body.results.find((r) => r.kind === "poi");
    expect(station).toBeDefined();
    expect(poi).toBeDefined();

    // The station's id is directly usable as destinationStationGroupId;
    // the POI's is opaque and its lat/lon are what a caller sends instead.
    expect(station?.id).toBe("sg-shibuya");
    expect(station?.nameJa).toBe("渋谷");
    expect(poi?.id).toMatch(/^poi:\d+$/);
    expect(poi?.category).not.toBeNull();
    expect(poi?.lat).toBeGreaterThan(0);
  });

  it("ranks the exact station-name match above the POIs that merely contain the word", async () => {
    const app = buildApp({ config: testConfig(), pool, graphs: emptyGraphs() });
    const response = await app.inject({ method: "GET", url: "/v1/places?query=shibuya" });
    await app.close();

    const body = placesResponseSchema.parse(response.json());
    expect(body.results[0]?.id).toBe("sg-shibuya");
  });

  it("matches a station by its Japanese name and by an alias", async () => {
    const app = buildApp({ config: testConfig(), pool, graphs: emptyGraphs() });
    const byJa = await app.inject({ method: "GET", url: "/v1/places?query=渋谷" });
    const byAlias = await app.inject({ method: "GET", url: "/v1/places?query=しぶや" });
    await app.close();

    expect(
      placesResponseSchema.parse(byJa.json()).results.some((r) => r.id === "sg-shibuya"),
    ).toBe(true);
    expect(
      placesResponseSchema.parse(byAlias.json()).results.some((r) => r.id === "sg-shibuya"),
    ).toBe(true);
  });

  it("never returns more than PLACES_LIMIT suggestions", async () => {
    const app = buildApp({ config: testConfig(), pool, graphs: emptyGraphs() });
    // "Shibuya" prefixes ~40 seeded POI names, well past the cap.
    const response = await app.inject({ method: "GET", url: "/v1/places?query=shibuya" });
    await app.close();

    expect(placesResponseSchema.parse(response.json()).results.length).toBe(PLACES_LIMIT);
  });

  it("a bare % returns nothing, not the whole table", async () => {
    // The abuse case the escaping exists for: unescaped, this is
    // `ILIKE '%' || '%' || '%'` — every named POI in the database.
    const app = buildApp({ config: testConfig(), pool, graphs: emptyGraphs() });
    const response = await app.inject({ method: "GET", url: "/v1/places?query=%25" });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(placesResponseSchema.parse(response.json()).results).toEqual([]);
  });

  it("returns an empty list, not an error, for a query that matches nothing", async () => {
    const app = buildApp({ config: testConfig(), pool, graphs: emptyGraphs() });
    const response = await app.inject({ method: "GET", url: "/v1/places?query=zzzzzznotaplace" });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(placesResponseSchema.parse(response.json()).results).toEqual([]);
  });
});

describe("GET /v1/places (integration)", () => {
  it.skipIf(Boolean(databaseUrl))(
    "SKIPPED integration tests above: DATABASE_URL is not set — set it to a PostGIS connection string to run them, e.g. DATABASE_URL=postgresql://tokyo:tokyo@localhost:5432/tokyo_test pnpm test",
    () => {
      console.warn("places.test.ts: DATABASE_URL is not set; skipping the /v1/places integration tests.");
    },
  );
});

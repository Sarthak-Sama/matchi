/**
 * `POST /v1/optimize` tests.
 *
 * Unit-level tests use `app.inject()` against a fake pool (dispatched by
 * matching a distinctive SQL substring in each query — see
 * `fakeOptimizePool` below) and a small hand-built `TransitGraphs` fixture
 * (`test-support/fixtures.ts`'s `graphsFromEdges`) — no real database
 * involved. One integration test at the bottom, guarded on `DATABASE_URL`,
 * runs against the real seeded + derived database (pattern mirrors
 * `scripts/src/seed.test.ts`).
 */

import type { OptimizationRequest } from "@tokyo/shared";
import { optimizeResponseSchema } from "@tokyo/shared";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { buildApp } from "../app.js";
import type { DbPool } from "../db.js";
import type { RailEdgeRow } from "../domain/transit/graph.js";
import { emptyGraphs, graphsFromEdges, testConfig } from "../test-support/fixtures.js";

// ---------------------------------------------------------------------------
// Fixture graph: sg-near --1 hop--> sg-dest, sg-far --2 hops--> sg-dest
// (via sg-mid), sg-isolated has no edges at all.
// ---------------------------------------------------------------------------

function edge(overrides: Partial<RailEdgeRow> & Pick<RailEdgeRow, "fromStationGroupId" | "toStationGroupId">): RailEdgeRow {
  return {
    railLineId: "rl-1",
    railLineName: "Test Line",
    edgeType: "ride",
    peakTravelMinutes: 10,
    offpeakTravelMinutes: 8,
    peakWaitMinutes: 3,
    offpeakWaitMinutes: 5,
    confidence: "high",
    ...overrides,
  };
}

const FIXTURE_EDGES: RailEdgeRow[] = [
  edge({ fromStationGroupId: "sg-near", toStationGroupId: "sg-dest" }),
  edge({ fromStationGroupId: "sg-far", toStationGroupId: "sg-mid" }),
  edge({ fromStationGroupId: "sg-mid", toStationGroupId: "sg-dest" }),
];

const FIXTURE_GRAPHS = graphsFromEdges(FIXTURE_EDGES);

const STATION_NAME_ROWS = [
  { stationGroupId: "sg-dest", nameEn: "Destination", nameJa: "目的地" },
  { stationGroupId: "sg-near", nameEn: "Near Station", nameJa: "近い駅" },
  { stationGroupId: "sg-mid", nameEn: "Mid Station", nameJa: "中間駅" },
  { stationGroupId: "sg-far", nameEn: "Far Station", nameJa: "遠い駅" },
  { stationGroupId: "sg-isolated", nameEn: "Isolated Station", nameJa: "孤立駅" },
];

const RAIL_LINE_NAME_ROWS = [{ railLineId: "rl-1", nameEn: "Test Line" }];

function makeCandidateRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const currentYear = new Date().getFullYear();
  return {
    stationGroupId: "sg-near",
    nameEn: "Near Station",
    nameJa: "近い駅",
    wardCode: "13100",
    wardNameEn: "Test Ward",
    wardNameJa: "テスト区",
    lat: 35.6,
    lon: 139.7,
    rentPerSqmYen: 3500,
    managementFeeYen: 5000,
    landPriceMultiplier: 1.0,
    landPricePointCount: 5,
    landPriceUsedFallback: false,
    rentSource: "reins",
    rentSourcePeriod: `${currentYear}Q1`,
    normFloodSafety: 80,
    normAmenitySupermarket: 70,
    normAmenityRestaurant: 60,
    normQuietness: 50,
    supermarketCount: 5,
    restaurantCount: 20,
    cafeCount: 5,
    derivedAt: new Date("2026-08-01T00:00:00Z"),
    ...overrides,
  };
}

const CANDIDATE_ROWS = [
  makeCandidateRow({ stationGroupId: "sg-near", nameEn: "Near Station", nameJa: "近い駅" }),
  makeCandidateRow({
    stationGroupId: "sg-far",
    nameEn: "Far Station",
    nameJa: "遠い駅",
    normFloodSafety: 30,
    normAmenitySupermarket: 20,
    normAmenityRestaurant: 20,
    normQuietness: 90,
  }),
  makeCandidateRow({ stationGroupId: "sg-isolated", nameEn: "Isolated Station", nameJa: "孤立駅" }),
];

function fakeOptimizePool(overrides: { candidates?: unknown[]; importRuns?: unknown[] } = {}): DbPool {
  const candidates = overrides.candidates ?? CANDIDATE_ROWS;
  const importRuns = overrides.importRuns ?? [];

  return {
    query: vi.fn((text: string) => {
      if (text.includes("FROM neighborhood_metrics nm")) {
        return Promise.resolve({ rows: candidates });
      }
      if (text.includes("FROM rail_lines")) {
        return Promise.resolve({ rows: RAIL_LINE_NAME_ROWS });
      }
      if (text.includes("FROM station_groups")) {
        return Promise.resolve({ rows: STATION_NAME_ROWS });
      }
      if (text.includes("FROM import_runs")) {
        return Promise.resolve({ rows: importRuns });
      }
      throw new Error(`fakeOptimizePool: unrecognized query text: ${text}`);
    }),
  };
}

function baseRequest(overrides: Partial<OptimizationRequest> = {}): OptimizationRequest {
  return {
    destinationStationGroupId: "sg-dest",
    arrivalTime: "09:00",
    monthlyBudgetYen: 300_000,
    layout: "1LDK",
    maxCommuteMinutes: 60,
    preferences: {
      floodSafety: "medium",
      supermarkets: "medium",
      restaurants: "medium",
      quietness: "medium",
    },
    ...overrides,
  };
}

function buildTestApp(pool: DbPool, graphs = FIXTURE_GRAPHS) {
  return buildApp({ config: testConfig(), pool, graphs });
}

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------

describe("POST /v1/optimize", () => {
  it("happy path: 200, results sorted by overallScore desc, every result validates against optimizeResponseSchema", async () => {
    const app = buildTestApp(fakeOptimizePool());
    const response = await app.inject({
      method: "POST",
      url: "/v1/optimize",
      payload: baseRequest(),
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    const body: unknown = response.json();
    expect(() => optimizeResponseSchema.parse(body)).not.toThrow();

    const parsed = optimizeResponseSchema.parse(body);
    expect(parsed.results.length).toBeGreaterThan(0);
    for (let i = 1; i < parsed.results.length; i++) {
      const prev = parsed.results[i - 1];
      const cur = parsed.results[i];
      expect(prev).toBeDefined();
      expect(cur).toBeDefined();
      if (prev && cur) {
        expect(prev.overallScore).toBeGreaterThanOrEqual(cur.overallScore);
      }
    }
    // The destination itself must never appear among the results.
    expect(parsed.results.some((r) => r.stationGroupId === "sg-dest")).toBe(false);
    // sg-isolated has no rail_edges at all — must be absent from results and
    // counted under excludedByDisconnected.
    expect(parsed.results.some((r) => r.stationGroupId === "sg-isolated")).toBe(false);
    expect(parsed.diagnostics.excludedByDisconnected).toBe(1);
    expect(parsed.diagnostics.candidatesConsidered).toBe(3);
  });

  it("replaces placeholder path hop names/lines with real display names, never raw ids", async () => {
    const app = buildTestApp(fakeOptimizePool());
    const response = await app.inject({
      method: "POST",
      url: "/v1/optimize",
      payload: baseRequest(),
    });
    await app.close();

    const body = optimizeResponseSchema.parse(response.json());
    const near = body.results.find((r) => r.stationGroupId === "sg-near");
    expect(near).toBeDefined();
    for (const hop of near?.commute.path ?? []) {
      expect(hop.nameEn).not.toBe(hop.stationGroupId);
      expect(hop.nameJa).not.toMatch(/^sg-/);
      if (hop.lineName !== null) {
        expect(hop.lineName).not.toMatch(/^rl-/);
      }
    }
    // Explicitly assert the real names/line appear somewhere in the path.
    const names = (near?.commute.path ?? []).map((h) => h.nameEn);
    expect(names).toContain("Destination");
    expect(names).toContain("Near Station");
  });

  it("every rent value carries the RENT_LABEL, never forbidden rent language", async () => {
    const app = buildTestApp(fakeOptimizePool());
    const response = await app.inject({
      method: "POST",
      url: "/v1/optimize",
      payload: baseRequest(),
    });
    await app.close();

    const body = optimizeResponseSchema.parse(response.json());
    for (const result of body.results) {
      expect(result.rent.label).toBe("modeled area rent");
    }
    const raw = JSON.stringify(response.json());
    expect(raw.toLowerCase()).not.toContain("available rent");
    expect(raw.toLowerCase()).not.toContain("listing");
    expect(raw.toLowerCase()).not.toContain("for rent");
  });

  it("recomputes rent for the requested layout rather than reusing the 1LDK baseline blindly", async () => {
    const app = buildTestApp(fakeOptimizePool());
    const response = await app.inject({
      method: "POST",
      url: "/v1/optimize",
      payload: baseRequest({ layout: "3LDK" }),
    });
    await app.close();

    const body = optimizeResponseSchema.parse(response.json());
    for (const result of body.results) {
      expect(result.rent.layout).toBe("3LDK");
      expect(result.rent.assumedSizeSqmMid).toBe(70);
    }
  });

  describe("validation errors", () => {
    const cases: { name: string; overrides: Record<string, unknown>; expectedPath: string }[] = [
      {
        name: "missing destinationStationGroupId",
        overrides: { destinationStationGroupId: undefined },
        expectedPath: "destinationStationGroupId",
      },
      {
        name: "arrivalTime 25:00",
        overrides: { arrivalTime: "25:00" },
        expectedPath: "arrivalTime",
      },
      {
        name: "negative budget",
        overrides: { monthlyBudgetYen: -1000 },
        expectedPath: "monthlyBudgetYen",
      },
      {
        name: "maxCommuteMinutes 200",
        overrides: { maxCommuteMinutes: 200 },
        expectedPath: "maxCommuteMinutes",
      },
      {
        name: "unknown layout",
        overrides: { layout: "not-a-layout" },
        expectedPath: "layout",
      },
      {
        name: "unknown importance",
        overrides: {
          preferences: {
            floodSafety: "extreme",
            supermarkets: "medium",
            restaurants: "medium",
            quietness: "medium",
          },
        },
        expectedPath: "preferences.floodSafety",
      },
    ];

    for (const testCase of cases) {
      it(`${testCase.name} -> 400 VALIDATION_ERROR naming "${testCase.expectedPath}"`, async () => {
        const app = buildTestApp(fakeOptimizePool());
        const payload = { ...baseRequest(), ...testCase.overrides } as Record<string, unknown>;
        if (payload["destinationStationGroupId"] === undefined) {
          delete payload["destinationStationGroupId"];
        }

        const response = await app.inject({ method: "POST", url: "/v1/optimize", payload });
        await app.close();

        expect(response.statusCode).toBe(400);
        const body = response.json() as {
          error: { code: string; details: { path: string }[] };
        };
        expect(body.error.code).toBe("VALIDATION_ERROR");
        expect(body.error.details.some((d) => d.path === testCase.expectedPath)).toBe(true);
      });
    }
  });

  it("unknown destination -> 404 STATION_NOT_FOUND", async () => {
    const app = buildTestApp(fakeOptimizePool());
    const response = await app.inject({
      method: "POST",
      url: "/v1/optimize",
      payload: baseRequest({ destinationStationGroupId: "sg-does-not-exist" }),
    });
    await app.close();

    expect(response.statusCode).toBe(404);
    const body = response.json() as { error: { code: string } };
    expect(body.error.code).toBe("STATION_NOT_FOUND");
  });

  it("empty feasible set -> 200 with results: [] and a non-null diagnostics.suggestion", async () => {
    const app = buildTestApp(fakeOptimizePool());
    const response = await app.inject({
      method: "POST",
      url: "/v1/optimize",
      // maxCommuteMinutes at the schema's own minimum (5) — ACCESS_WALK_MINUTES
      // alone (8) already exceeds this for every reachable candidate.
      payload: baseRequest({ maxCommuteMinutes: 5 }),
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    const body = optimizeResponseSchema.parse(response.json());
    expect(body.results).toEqual([]);
    expect(body.diagnostics.feasibleCount).toBe(0);
    expect(body.diagnostics.suggestion).not.toBeNull();
    expect(typeof body.diagnostics.suggestion).toBe("string");
  });

  it("returns 503 GRAPH_UNAVAILABLE when the transit graph has no edges", async () => {
    const app = buildTestApp(fakeOptimizePool(), emptyGraphs());
    const response = await app.inject({
      method: "POST",
      url: "/v1/optimize",
      payload: baseRequest(),
    });
    await app.close();

    expect(response.statusCode).toBe(503);
    const body = response.json() as { error: { code: string } };
    expect(body.error.code).toBe("GRAPH_UNAVAILABLE");
  });
});

// ---------------------------------------------------------------------------
// Integration test — guarded on DATABASE_URL, runs against the real seeded
// + derived database. Mirrors scripts/src/seed.test.ts's / derive.test.ts's
// pattern of making its own `beforeAll` fully self-sufficient.
//
// This test's precondition is a POPULATED `neighborhood_metrics` table (the
// `derive` step's output), which `scripts/src/seed.test.ts`'s own suite
// (run later in the SAME `pnpm test` invocation, since `api`'s test files
// run before `scripts`'s per `vitest.config.ts`'s project order) does NOT
// preserve: `seed.ts` reinserts `station_groups` rows, which — via
// `neighborhood_metrics`'s `ON DELETE CASCADE` FK — wipes any
// previously-derived metrics. That wipe happens AFTER this test runs within
// one invocation, but PERSISTS in the database for the NEXT `pnpm test`
// invocation, silently leaving `neighborhood_metrics` empty the next time
// this file runs (this was caught for real: candidatesConsidered came back
// `0` the second time this suite ran back-to-back). Re-running
// `db:migrate && db:seed && derive` here — exactly the recovery command
// task-10-brief.md itself documents — makes this test's precondition true
// regardless of what any other suite left behind, on every run.
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

describe.runIf(Boolean(databaseUrl))("POST /v1/optimize (integration)", () => {
  let pool: Pool;

  beforeAll(() => {
    if (!databaseUrl) return;
    runCli("scripts/src/migrate.ts");
    runCli("scripts/src/seed.ts");
    runCli("scripts/src/derive.ts");
    pool = new Pool({ connectionString: databaseUrl });
  }, 60_000);

  afterAll(async () => {
    if (!databaseUrl) return;
    await pool.end();
  });

  it("returns a non-empty ranked list, excludes sg-isolated-test under excludedByDisconnected, and labels every rent value", async () => {
    const { loadRailEdges } = await import("../domain/transit/loader.js");
    const { buildGraphs } = await import("../domain/transit/graph.js");
    const edges = await loadRailEdges(pool);
    const graphs = buildGraphs(edges);

    const app = buildApp({ config: testConfig(), pool, graphs });

    const response = await app.inject({
      method: "POST",
      url: "/v1/optimize",
      payload: {
        destinationStationGroupId: "sg-shibuya",
        arrivalTime: "09:00",
        monthlyBudgetYen: 200_000,
        layout: "1LDK",
        maxCommuteMinutes: 45,
        preferences: {
          floodSafety: "high",
          supermarkets: "medium",
          restaurants: "low",
          quietness: "essential",
        },
      } satisfies OptimizationRequest,
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    const body = optimizeResponseSchema.parse(response.json());

    expect(body.results.length).toBeGreaterThan(0);
    expect(body.results.some((r) => r.stationGroupId === "sg-isolated-test")).toBe(false);
    expect(body.diagnostics.excludedByDisconnected).toBeGreaterThanOrEqual(1);

    for (const result of body.results) {
      expect(result.rent.label).toBe("modeled area rent");
    }
  });
});

describe("POST /v1/optimize (integration)", () => {
  it.skipIf(Boolean(databaseUrl))(
    "SKIPPED integration test above: DATABASE_URL is not set — set it to a PostGIS connection string to run it, e.g. DATABASE_URL=postgresql://tokyo:tokyo@localhost:5432/tokyo_test pnpm test",
    () => {
      console.warn(
        "optimize.test.ts: DATABASE_URL is not set; skipping the /v1/optimize integration test. " +
          "Run with DATABASE_URL=postgresql://tokyo:tokyo@localhost:5432/tokyo_test pnpm test",
      );
    },
  );
});

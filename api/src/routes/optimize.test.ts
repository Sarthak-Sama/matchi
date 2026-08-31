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

function edge(
  overrides: Partial<RailEdgeRow> & Pick<RailEdgeRow, "fromStationGroupId" | "toStationGroupId">,
): RailEdgeRow {
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
  const stationGroupId = (overrides.stationGroupId as string | undefined) ?? "sg-near";
  return {
    localityId: `locality-${stationGroupId}`,
    nameEn: "Near Station",
    nameJa: "近い駅",
    wardCode: "13100",
    wardNameEn: "Test Ward",
    wardNameJa: "テスト区",
    lat: 35.6,
    lon: 139.7,
    samples: [
      {
        sampleNumber: 1,
        lat: 35.6,
        lon: 139.7,
        stations: [{ stationGroupId, walkMinutes: 0, rank: 1 }],
      },
    ],
    rentPerSqmYen: 3500,
    managementFeeYen: 5000,
    landPriceMultiplier: 1.0,
    landPricePointCount: 5,
    landPriceUsedFallback: false,
    rentSource: "reins",
    rentSourcePeriod: `${currentYear}Q1`,
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
    normAmenitySupermarket: 20,
    normAmenityRestaurant: 20,
    normQuietness: 90,
  }),
  makeCandidateRow({ stationGroupId: "sg-isolated", nameEn: "Isolated Station", nameJa: "孤立駅" }),

  makeCandidateRow({ stationGroupId: "sg-dest", nameEn: "Destination", nameJa: "目的地" }),
];

function fakeOptimizePool(
  overrides: {
    candidates?: unknown[];
    importRuns?: unknown[];

    accessStations?: { stationGroupId: string; distanceM: number }[];
  } = {},
): DbPool {
  const candidates = overrides.candidates ?? CANDIDATE_ROWS;
  const importRuns = overrides.importRuns ?? [];
  const accessStations = overrides.accessStations ?? [{ stationGroupId: "sg-dest", distanceM: 0 }];

  return {
    query: vi.fn((text: string) => {
      if (text.includes("localities l")) {
        return Promise.resolve({ rows: candidates });
      }
      if (text.includes("FROM rail_lines")) {
        return Promise.resolve({ rows: RAIL_LINE_NAME_ROWS });
      }

      if (text.includes("ST_DWithin")) {
        return Promise.resolve({ rows: accessStations });
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

    expect(parsed.results.some((r) => r.localityId === "locality-sg-isolated")).toBe(false);
    expect(parsed.diagnostics.excludedByDisconnected).toBe(1);
    expect(parsed.diagnostics.candidatesConsidered).toBe(4);
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
    const near = body.results.find((r) => r.localityId === "locality-sg-near");
    expect(near).toBeDefined();
    for (const hop of near?.commute.path ?? []) {
      expect(hop.nameEn).not.toBe(hop.stationGroupId);
      expect(hop.nameJa).not.toMatch(/^sg-/);
      if (hop.lineName !== null) {
        expect(hop.lineName).not.toMatch(/^rl-/);
      }
    }

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
    const app = buildTestApp(
      fakeOptimizePool({
        candidates: CANDIDATE_ROWS.filter((row) => row.localityId !== "locality-sg-dest"),
      }),
    );
    const response = await app.inject({
      method: "POST",
      url: "/v1/optimize",

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

  describe("destinationPoint", () => {
    function pointRequest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
      const payload: Record<string, unknown> = {
        ...baseRequest(),
        destinationPoint: { lat: 35.6555, lon: 139.7055, label: "The Office" },
        ...overrides,
      };
      delete payload["destinationStationGroupId"];
      return payload;
    }

    it("resolves a point to seeds and itemizes a NON-ZERO destination walk in every commute", async () => {
      const app = buildTestApp(
        fakeOptimizePool({ accessStations: [{ stationGroupId: "sg-dest", distanceM: 400 }] }),
      );
      const response = await app.inject({
        method: "POST",
        url: "/v1/optimize",
        payload: pointRequest(),
      });
      await app.close();

      expect(response.statusCode).toBe(200);
      const body = optimizeResponseSchema.parse(response.json());
      expect(body.results.length).toBeGreaterThan(0);

      for (const result of body.results) {
        expect(result.commute.destinationWalkMinutes).toBe(7);

        expect(result.commute.totalMinutes).toBe(
          result.commute.accessWalkMinutes +
            result.commute.railMinutes +
            result.commute.waitMinutes +
            result.commute.transferPenaltyMinutes +
            result.commute.destinationWalkMinutes,
        );
      }
    });

    it("keeps the destination's own locality in the list", async () => {
      const app = buildTestApp(
        fakeOptimizePool({ accessStations: [{ stationGroupId: "sg-dest", distanceM: 400 }] }),
      );
      const response = await app.inject({
        method: "POST",
        url: "/v1/optimize",
        payload: pointRequest(),
      });
      await app.close();

      const body = optimizeResponseSchema.parse(response.json());
      const destination = body.results.find((r) => r.localityId === "locality-sg-dest");
      expect(destination).toBeDefined();

      expect(destination?.commute.railMinutes).toBe(0);
      expect(destination?.commute.totalMinutes).toBeGreaterThan(0);
    });

    it("keeps localities that can use any destination access station", async () => {
      const app = buildTestApp(
        fakeOptimizePool({
          accessStations: [
            { stationGroupId: "sg-dest", distanceM: 400 },
            { stationGroupId: "sg-near", distanceM: 800 },
          ],
        }),
      );
      const response = await app.inject({
        method: "POST",
        url: "/v1/optimize",
        payload: pointRequest(),
      });
      await app.close();

      const body = optimizeResponseSchema.parse(response.json());
      expect(body.results.map((r) => r.localityId)).toContain("locality-sg-dest");
      expect(body.results.map((r) => r.localityId)).toContain("locality-sg-near");
    });

    it("lets the search pick the cheaper access station per origin, not the nearest to the office", async () => {
      const app = buildTestApp(
        fakeOptimizePool({
          accessStations: [
            { stationGroupId: "sg-dest", distanceM: 60 },
            { stationGroupId: "sg-near", distanceM: 1200 },
          ],
        }),
      );
      const response = await app.inject({
        method: "POST",
        url: "/v1/optimize",
        payload: pointRequest(),
      });
      await app.close();

      const body = optimizeResponseSchema.parse(response.json());

      const near = body.results.find((r) => r.localityId === "locality-sg-near");
      expect(near?.commute.destinationWalkMinutes).toBe(1);
      expect(near?.commute.railMinutes).toBe(10);

      expect(near?.commute.totalMinutes).toBe(14);

    });

    it("a point with no station in range -> 400 NO_ACCESS_STATIONS, not a 500 and not an empty ranked list", async () => {
      const app = buildTestApp(fakeOptimizePool({ accessStations: [] }));
      const response = await app.inject({
        method: "POST",
        url: "/v1/optimize",
        payload: pointRequest({ destinationPoint: { lat: 35.0, lon: 145.0 } }),
      });
      await app.close();

      expect(response.statusCode).toBe(400);
      const body = response.json() as { error: { code: string; message: string } };
      expect(body.error.code).toBe("NO_ACCESS_STATIONS");
      expect(body.error.code).not.toBe("INTERNAL_ERROR");
      expect(body.error.message).toContain("1500");
    });

    it("rejects supplying both destination forms", async () => {
      const app = buildTestApp(fakeOptimizePool());
      const response = await app.inject({
        method: "POST",
        url: "/v1/optimize",
        payload: { ...baseRequest(), destinationPoint: { lat: 35.6, lon: 139.7 } },
      });
      await app.close();

      expect(response.statusCode).toBe(400);
      const body = response.json() as { error: { code: string; details: { path: string }[] } };
      expect(body.error.code).toBe("VALIDATION_ERROR");
      expect(body.error.details.some((d) => d.path === "destinationStationGroupId")).toBe(true);
    });

    it("rejects an out-of-range coordinate at the schema boundary", async () => {
      const app = buildTestApp(fakeOptimizePool());
      const response = await app.inject({
        method: "POST",
        url: "/v1/optimize",
        payload: pointRequest({ destinationPoint: { lat: 91, lon: 139.7 } }),
      });
      await app.close();

      expect(response.statusCode).toBe(400);
      const body = response.json() as { error: { code: string; details: { path: string }[] } };
      expect(body.error.code).toBe("VALIDATION_ERROR");
      expect(body.error.details.some((d) => d.path === "destinationPoint.lat")).toBe(true);
    });

    it("echoes the destinationPoint back in the response's request", async () => {
      const app = buildTestApp(fakeOptimizePool());
      const response = await app.inject({
        method: "POST",
        url: "/v1/optimize",
        payload: pointRequest(),
      });
      await app.close();

      const body = optimizeResponseSchema.parse(response.json());
      expect(body.request.destinationPoint).toEqual({
        lat: 35.6555,
        lon: 139.7055,
        label: "The Office",
      });
      expect(body.request.destinationStationGroupId).toBeUndefined();
    });
  });

  describe("diagnostics reconcile after the destination's own area rejoined the pool", () => {
    const cases: { name: string; payload: Record<string, unknown> }[] = [
      { name: "a station destination", payload: baseRequest() },
      {
        name: "a point destination",
        payload: (() => {
          const p: Record<string, unknown> = {
            ...baseRequest(),
            destinationPoint: { lat: 35.6555, lon: 139.7055 },
          };
          delete p["destinationStationGroupId"];
          return p;
        })(),
      },
      { name: "an infeasible commute cap", payload: baseRequest({ maxCommuteMinutes: 5 }) },
      { name: "an infeasible budget", payload: baseRequest({ monthlyBudgetYen: 1 }) },
    ];

    for (const testCase of cases) {
      it(`excludedBy* + feasibleCount === candidatesConsidered for ${testCase.name}`, async () => {
        const app = buildTestApp(fakeOptimizePool());
        const response = await app.inject({
          method: "POST",
          url: "/v1/optimize",
          payload: testCase.payload,
        });
        await app.close();

        expect(response.statusCode).toBe(200);
        const { diagnostics } = optimizeResponseSchema.parse(response.json());
        expect(
          diagnostics.excludedByRent +
            diagnostics.excludedByCommute +
            diagnostics.excludedByDisconnected +
            diagnostics.feasibleCount,
        ).toBe(diagnostics.candidatesConsidered);

        expect(diagnostics.candidatesConsidered).toBe(4);
      });
    }
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

  beforeAll(async () => {
    if (!databaseUrl) return;
    runCli("scripts/src/migrate.ts");
    runCli("scripts/src/seed.ts");
    pool = new Pool({ connectionString: databaseUrl });
    await pool.query(`
      INSERT INTO localities (locality_id, ward_code, name_ja, geom, centroid, source)
      SELECT 'test-locality-shibuya', sg.ward_code, '渋谷テスト町',
        ST_Multi(ST_CollectionExtract(ST_Intersection(
          ST_Buffer(sg.point::geography, 300)::geometry, w.geom
        ), 3)), sg.point, 'test'
      FROM station_groups sg JOIN wards w ON w.ward_code=sg.ward_code
      WHERE sg.station_group_id='sg-shibuya'
    `);
    runCli("scripts/src/derive.ts");
  }, 60_000);

  afterAll(async () => {
    if (!databaseUrl) return;
    await pool.end();
  });

  it("returns a non-empty locality-ranked list and labels every rent value", async () => {
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
    expect(body.results[0]?.localityId).toBe("test-locality-shibuya");

    for (const result of body.results) {
      expect(result.rent.label).toBe("modeled area rent");
    }
  });

  it("a destinationPoint near Shibuya produces real seeds and a non-zero itemized walk", async () => {
    const { loadRailEdges } = await import("../domain/transit/loader.js");
    const { buildGraphs } = await import("../domain/transit/graph.js");
    const graphs = buildGraphs(await loadRailEdges(pool));
    const app = buildApp({ config: testConfig(), pool, graphs });

    const response = await app.inject({
      method: "POST",
      url: "/v1/optimize",
      payload: {
        destinationPoint: { lat: 35.6555, lon: 139.7055, label: "Shibuya Office" },
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
      },
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    const body = optimizeResponseSchema.parse(response.json());
    expect(body.results.length).toBeGreaterThan(0);

    for (const result of body.results) {
      expect(result.commute.destinationWalkMinutes).toBeGreaterThan(0);
      expect(result.commute.totalMinutes).toBe(
        result.commute.accessWalkMinutes +
          result.commute.railMinutes +
          result.commute.waitMinutes +
          result.commute.transferPenaltyMinutes +
          result.commute.destinationWalkMinutes,
      );
    }

    expect(body.results[0]?.localityId).toBe("test-locality-shibuya");

    expect(
      body.diagnostics.excludedByRent +
        body.diagnostics.excludedByCommute +
        body.diagnostics.excludedByDisconnected +
        body.diagnostics.feasibleCount,
    ).toBe(body.diagnostics.candidatesConsidered);
  });

  it("a point in the middle of the ocean -> 400 NO_ACCESS_STATIONS, not a 500 and not an empty ranked list", async () => {
    const { loadRailEdges } = await import("../domain/transit/loader.js");
    const { buildGraphs } = await import("../domain/transit/graph.js");
    const graphs = buildGraphs(await loadRailEdges(pool));
    const app = buildApp({ config: testConfig(), pool, graphs });

    const response = await app.inject({
      method: "POST",
      url: "/v1/optimize",
      payload: {
        destinationPoint: { lat: 35.0, lon: 145.0 },
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
      },
    });
    await app.close();

    expect(response.statusCode).toBe(400);
    const body = response.json() as { error: { code: string } };
    expect(body.error.code).toBe("NO_ACCESS_STATIONS");
  });

  it("a destinationStationGroupId request still works unchanged, with a zero destination walk", async () => {
    const { loadRailEdges } = await import("../domain/transit/loader.js");
    const { buildGraphs } = await import("../domain/transit/graph.js");
    const graphs = buildGraphs(await loadRailEdges(pool));
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
      },
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    const body = optimizeResponseSchema.parse(response.json());
    expect(body.results.length).toBeGreaterThan(0);
    for (const result of body.results) {
      expect(result.commute.destinationWalkMinutes).toBe(0);
    }
    expect(body.results[0]?.localityId).toBe("test-locality-shibuya");
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

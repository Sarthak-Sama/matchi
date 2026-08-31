import { describe, expect, it, vi } from "vitest";

import { buildApp } from "../app.js";
import type { DbPool } from "../db.js";
import { emptyGraphs, testConfig } from "../test-support/fixtures.js";

function buildTestApp(pool: DbPool) {
  return buildApp({ config: testConfig(), pool, graphs: emptyGraphs() });
}

const FULL_ROW = {
  stationGroupId: "sg-shibuya",
  nameEn: "Shibuya",
  nameJa: "渋谷",
  aliases: ["shibuya-eki"],
  wardCode: "13113",
  wardNameEn: "Shibuya City",
  wardNameJa: "渋谷区",
  lat: 35.658,
  lon: 139.7016,
  rentPerSqmYen: 3800,
  managementFeeYen: 8000,
  landPriceMultiplier: 1.05,
  landPricePointCount: 5,
  landPriceUsedFallback: false,
  rentSource: "reins",
  rentSourcePeriod: "2026Q1",
  normAmenitySupermarket: 60,
  normAmenityRestaurant: 90,
  normQuietness: 40,
  normAmenityConvenience: 55,
  normAmenityCuisineVariety: 65,
  normGreenSpace: 45,
  normAmenityLateNight: 35,
  normAmenityHealth: 50,
  supermarketCount: 6,
  restaurantCount: 50,
  cafeCount: 10,
  convenienceCount: 12,
  cuisineVarietyCount: 8,
  greenSpaceShare: 0.15,
  lateNightCount: 4,
  healthCount: 3,
  derivedAt: new Date("2026-08-01T00:00:00Z"),
  sourceDates: { pois: "2026-01-01T00:00:00Z" },
  catchmentRadiusM: 800,
  catchmentGeoJson: JSON.stringify({
    type: "Polygon",
    coordinates: [
      [
        [139.7, 35.65],
        [139.71, 35.65],
        [139.71, 35.66],
        [139.7, 35.66],
        [139.7, 35.65],
      ],
    ],
  }),
};

describe("GET /v1/neighborhoods/:stationGroupId", () => {
  it("returns 404 NEIGHBORHOOD_NOT_FOUND for an unknown station", async () => {
    const pool: DbPool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    const app = buildTestApp(pool);

    const response = await app.inject({
      method: "GET",
      url: "/v1/neighborhoods/sg-does-not-exist",
    });
    await app.close();

    expect(response.statusCode).toBe(404);
    const body = response.json() as { error: { code: string } };
    expect(body.error.code).toBe("NEIGHBORHOOD_NOT_FOUND");
  });

  it("returns 404 NEIGHBORHOOD_NOT_FOUND when the station exists but has not been derived yet", async () => {
    const pool: DbPool = {
      query: vi.fn().mockResolvedValue({
        rows: [{ ...FULL_ROW, normQuietness: null, derivedAt: null }],
      }),
    };
    const app = buildTestApp(pool);

    const response = await app.inject({ method: "GET", url: "/v1/neighborhoods/sg-shibuya" });
    await app.close();

    expect(response.statusCode).toBe(404);
    expect((response.json() as { error: { code: string } }).error.code).toBe(
      "NEIGHBORHOOD_NOT_FOUND",
    );
  });

  it("returns full detail for a known, derived station, defaulting to 1LDK", async () => {
    const pool: DbPool = { query: vi.fn().mockResolvedValue({ rows: [FULL_ROW] }) };
    const app = buildTestApp(pool);

    const response = await app.inject({ method: "GET", url: "/v1/neighborhoods/sg-shibuya" });
    await app.close();

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      stationGroupId: string;
      ward: { wardCode: string } | null;
      rent: { layout: string; label: string; medianYen: number } | null;
      factors: { key: string }[];
      catchment: { geoJson: unknown };
      sourceDates: Record<string, string>;
    };
    expect(body.stationGroupId).toBe("sg-shibuya");
    expect(body.ward?.wardCode).toBe("13113");
    expect(body.rent?.layout).toBe("1LDK");
    expect(body.rent?.label).toBe("modeled area rent");
    expect(body.factors.map((f) => f.key).sort()).toEqual(
      [
        "quietness",
        "restaurants",
        "supermarkets",
        "konbini",
        "cuisineVariety",
        "greenSpace",
        "lateNight",
        "health",
      ].sort(),
    );
    expect(body.catchment.geoJson).toMatchObject({ type: "Polygon" });
    expect(body.sourceDates["pois"]).toBe("2026-01-01T00:00:00Z");
  });

  it("recomputes rent for an explicit layout query parameter", async () => {
    const pool: DbPool = { query: vi.fn().mockResolvedValue({ rows: [FULL_ROW] }) };
    const app = buildTestApp(pool);

    const response = await app.inject({
      method: "GET",
      url: "/v1/neighborhoods/sg-shibuya?layout=3LDK",
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    const body = response.json() as { rent: { layout: string; medianYen: number } | null };
    expect(body.rent?.layout).toBe("3LDK");
  });

  it("rejects an unknown layout with 400 VALIDATION_ERROR", async () => {
    const pool: DbPool = { query: vi.fn().mockResolvedValue({ rows: [FULL_ROW] }) };
    const app = buildTestApp(pool);

    const response = await app.inject({
      method: "GET",
      url: "/v1/neighborhoods/sg-shibuya?layout=not-a-layout",
    });
    await app.close();

    expect(response.statusCode).toBe(400);
    expect((response.json() as { error: { code: string } }).error.code).toBe("VALIDATION_ERROR");
  });

  it("returns rent: null when any rent_stats-backed input is missing", async () => {
    const pool: DbPool = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            ...FULL_ROW,
            rentSourcePeriod: null,
          },
        ],
      }),
    };
    const app = buildTestApp(pool);

    const response = await app.inject({ method: "GET", url: "/v1/neighborhoods/sg-shibuya" });
    await app.close();

    expect(response.statusCode).toBe(200);
    const body = response.json() as { rent: unknown };
    expect(body.rent).toBeNull();
  });
});

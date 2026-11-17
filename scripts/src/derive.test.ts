import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CATCHMENT_RADIUS_M, LIFESTYLE_AXES, LIFESTYLE_AXIS_IDS } from "@tokyo/shared";

import { runDerive } from "./derive.js";
import { runMigrations } from "./migrate.js";
import { runSeed } from "./seed.js";
import { destructiveTestDatabaseUrl } from "./test-support/database-url.js";

const databaseUrl = destructiveTestDatabaseUrl();

const EXPECTED_CATCHMENT_AREA_SQM = Math.PI * CATCHMENT_RADIUS_M * CATCHMENT_RADIUS_M;
const AREA_TOLERANCE_FRACTION = 0.01;

const CHECKSUM_QUERY = `
  SELECT md5(string_agg(row_to_json(x)::text, '|')) AS checksum FROM (
    SELECT
      station_group_id, ward_code, rent_low_yen, rent_median_yen, rent_high_yen,
      rent_confidence, rent_source, rent_source_period, rent_per_sqm_yen, management_fee_yen,
      land_price_multiplier, land_price_point_count, land_price_used_fallback, supermarket_count, grocery_count,
      convenience_count, amenity_supermarket_equiv, restaurant_count, cafe_count, nightlife_count,
      health_count, cuisine_variety_count, late_night_count, green_space_share,
      residential_zoning_share,
      road_rail_exposure_share, quietness_raw, norm_amenity_supermarket, norm_amenity_restaurant,
      norm_quietness, norm_amenity_convenience, norm_amenity_cuisine_variety,
      norm_green_space, norm_amenity_late_night, norm_amenity_health, source_dates
    FROM neighborhood_metrics
    ORDER BY station_group_id
  ) x
`;

describe.runIf(Boolean(databaseUrl))("derive", () => {
  let pool: Pool;

  beforeAll(async () => {
    if (!databaseUrl) return;
    await runMigrations({ dryRun: false });
    await runSeed();
    pool = new Pool({ connectionString: databaseUrl });
    await pool.query(`
      INSERT INTO localities (locality_id, ward_code, name_ja, geom, centroid, source)
      SELECT 'test-locality-shibuya', ward_code, 'テスト町', geom, ST_PointOnSurface(geom), 'test'
      FROM wards WHERE ward_code = '13113'
    `);
    await runDerive(pool);
  }, 60_000);

  afterAll(async () => {
    if (!databaseUrl) return;
    await pool.end();
  });

  it("prints a StepResult for every step and covers every station plus the locality fixture", async () => {
    const results = await runDerive(pool);
    expect(results.map((r) => r.name)).toEqual([
      "catchments",
      "amenities",
      "zoning",
      "quietness",
      "rent",
      "green-space",
      "normalization",
      "localities",
    ]);
    for (const r of results) {
      expect(r.rowsWritten, `rowsWritten for step "${r.name}"`).toBe(
        r.name === "localities" ? 1 : 21,
      );
      expect(r.durationMs, `durationMs for step "${r.name}"`).toBeGreaterThanOrEqual(0);
    }
  });

  it("every catchment's area_sqm is within 1% of π·800² (catches degrees-vs-metres bugs)", async () => {
    const { rows } = await pool.query<{ station_group_id: string; area_sqm: string }>(
      "SELECT station_group_id, area_sqm::text FROM station_areas",
    );
    expect(rows).toHaveLength(21);
    for (const row of rows) {
      const areaSqm = Number(row.area_sqm);
      const fractionOff =
        Math.abs(areaSqm - EXPECTED_CATCHMENT_AREA_SQM) / EXPECTED_CATCHMENT_AREA_SQM;
      expect(
        fractionOff,
        `${row.station_group_id}: area_sqm=${areaSqm}, expected ~${EXPECTED_CATCHMENT_AREA_SQM}`,
      ).toBeLessThan(AREA_TOLERANCE_FRACTION);
    }
  });

  it("hand-verified amenity counts: sg-shibuya=37, sg-yoga=5 (fixtures/seed/pois.ts)", async () => {
    const { rows } = await pool.query<{
      station_group_id: string;
      supermarket_count: number;
      grocery_count: number;
      convenience_count: number;
      restaurant_count: number;
      cafe_count: number;
      nightlife_count: number;
    }>(
      `SELECT station_group_id, supermarket_count, grocery_count, convenience_count,
              restaurant_count, cafe_count, nightlife_count
       FROM neighborhood_metrics WHERE station_group_id IN ('sg-shibuya', 'sg-yoga')`,
    );
    const byId = new Map(rows.map((r) => [r.station_group_id, r]));

    const shibuya = byId.get("sg-shibuya");
    expect(shibuya, "sg-shibuya row").toBeDefined();
    const shibuyaTotal =
      Number(shibuya?.supermarket_count) +
      Number(shibuya?.grocery_count) +
      Number(shibuya?.convenience_count) +
      Number(shibuya?.restaurant_count) +
      Number(shibuya?.cafe_count) +
      Number(shibuya?.nightlife_count);
    expect(shibuyaTotal, "sg-shibuya total amenity count").toBe(37);

    const yoga = byId.get("sg-yoga");
    expect(yoga, "sg-yoga row").toBeDefined();
    const yogaTotal =
      Number(yoga?.supermarket_count) +
      Number(yoga?.grocery_count) +
      Number(yoga?.convenience_count) +
      Number(yoga?.restaurant_count) +
      Number(yoga?.cafe_count) +
      Number(yoga?.nightlife_count);
    expect(yogaTotal, "sg-yoga total amenity count").toBe(5);
  });

  it("task-3 raw counts: sg-shibuya health/cuisine-variety/late-night match the hand-authored fixtures; sg-yoga is 0 on all three", async () => {
    const { rows } = await pool.query<{
      station_group_id: string;
      health_count: number;
      cuisine_variety_count: number;
      late_night_count: number;
    }>(
      `SELECT station_group_id, health_count, cuisine_variety_count, late_night_count
       FROM neighborhood_metrics WHERE station_group_id IN ('sg-shibuya', 'sg-yoga')`,
    );
    const byId = new Map(rows.map((r) => [r.station_group_id, r]));

    const shibuya = byId.get("sg-shibuya");
    expect(shibuya, "sg-shibuya row").toBeDefined();

    expect(Number(shibuya?.health_count), "sg-shibuya health_count").toBe(3);

    expect(Number(shibuya?.cuisine_variety_count), "sg-shibuya cuisine_variety_count").toBe(9);

    expect(Number(shibuya?.late_night_count), "sg-shibuya late_night_count").toBe(5);

    const yoga = byId.get("sg-yoga");
    expect(yoga, "sg-yoga row").toBeDefined();
    expect(Number(yoga?.health_count), "sg-yoga health_count").toBe(0);
    expect(Number(yoga?.cuisine_variety_count), "sg-yoga cuisine_variety_count").toBe(0);
    expect(Number(yoga?.late_night_count), "sg-yoga late_night_count").toBe(0);
  });

  it("green_space_share: sg-nakano is fully covered by the fixture park (~1), sg-shibuya touches none (0)", async () => {
    const { rows } = await pool.query<{ station_group_id: string; green_space_share: number }>(
      `SELECT station_group_id, green_space_share FROM neighborhood_metrics
       WHERE station_group_id IN ('sg-nakano', 'sg-shibuya')`,
    );
    const byId = new Map(rows.map((r) => [r.station_group_id, Number(r.green_space_share)]));

    expect(byId.get("sg-nakano"), "sg-nakano green_space_share").toBeGreaterThan(0.9);
    expect(byId.get("sg-shibuya"), "sg-shibuya green_space_share").toBe(0);
  });

  it("residential_zoning_share differs between sg-shibuya (~0) and sg-yoga (~1); all values in [0,1]", async () => {
    const { rows } = await pool.query<{
      station_group_id: string;
      residential_zoning_share: number;
    }>("SELECT station_group_id, residential_zoning_share FROM neighborhood_metrics");
    expect(rows).toHaveLength(21);
    for (const row of rows) {
      expect(row.residential_zoning_share, row.station_group_id).toBeGreaterThanOrEqual(0);
      expect(row.residential_zoning_share, row.station_group_id).toBeLessThanOrEqual(1);
    }

    const byId = new Map(rows.map((r) => [r.station_group_id, r.residential_zoning_share]));
    const shibuyaShare = byId.get("sg-shibuya");
    const yogaShare = byId.get("sg-yoga");
    expect(shibuyaShare, "sg-shibuya residential_zoning_share").toBeCloseTo(0, 3);
    expect(yogaShare, "sg-yoga residential_zoning_share").toBeCloseTo(1, 3);
    expect(shibuyaShare).not.toBe(yogaShare);
  });

  it("every norm_* column is within [0,100], with at least one 100 and one 0 per axis", async () => {
    const axes = LIFESTYLE_AXIS_IDS.map((id) => LIFESTYLE_AXES[id].normColumn);
    const { rows } = await pool.query<Record<(typeof axes)[number], number>>(
      `SELECT ${axes.join(", ")} FROM neighborhood_metrics`,
    );
    expect(rows).toHaveLength(21);

    for (const axis of axes) {
      const values = rows.map((r) => Number(r[axis]));
      for (const v of values) {
        expect(v, axis).toBeGreaterThanOrEqual(0);
        expect(v, axis).toBeLessThanOrEqual(100);
      }
      expect(Math.max(...values), `${axis} max`).toBe(100);
      expect(Math.min(...values), `${axis} min`).toBe(0);
    }
  });

  it("the two deliberately land-price-poor catchments (sg-isolated-test, sg-toritsudaigaku — not the only stations that can hit the fallback) get multiplier 1.0, land_price_used_fallback=true, and lowered confidence", async () => {
    const { rows } = await pool.query<{
      station_group_id: string;
      land_price_point_count: number;
      land_price_multiplier: number;
      land_price_used_fallback: boolean;
      rent_confidence: string;
    }>(
      `SELECT station_group_id, land_price_point_count, land_price_multiplier,
              land_price_used_fallback, rent_confidence
       FROM neighborhood_metrics
       WHERE station_group_id IN ('sg-isolated-test', 'sg-toritsudaigaku')`,
    );
    expect(rows).toHaveLength(2);

    for (const row of rows) {
      expect(row.land_price_point_count, row.station_group_id).toBeLessThan(3);
      expect(Number(row.land_price_multiplier), row.station_group_id).toBe(1.0);
      expect(row.land_price_used_fallback, row.station_group_id).toBe(true);

      expect(row.rent_confidence, row.station_group_id).toBe("low");
    }
  });

  it("land_price_used_fallback is false for a station with a genuinely computed (non-1.0) multiplier", async () => {
    const { rows } = await pool.query<{
      land_price_point_count: number;
      land_price_multiplier: number;
      land_price_used_fallback: boolean;
    }>(
      `SELECT land_price_point_count, land_price_multiplier, land_price_used_fallback
       FROM neighborhood_metrics WHERE station_group_id = 'sg-yoyogi'`,
    );
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row?.land_price_point_count).toBeGreaterThanOrEqual(3);
    expect(Number(row?.land_price_multiplier)).not.toBe(1.0);
    expect(row?.land_price_used_fallback).toBe(false);
  });

  it("is idempotent: running derive twice produces a byte-identical checksum of the sorted metric rows", async () => {
    await runDerive(pool);
    const { rows: firstRows } = await pool.query<{ checksum: string }>(CHECKSUM_QUERY);
    const firstChecksum = firstRows[0]?.checksum;
    expect(firstChecksum).toBeTruthy();

    await runDerive(pool);
    const { rows: secondRows } = await pool.query<{ checksum: string }>(CHECKSUM_QUERY);
    const secondChecksum = secondRows[0]?.checksum;

    expect(secondChecksum).toBe(firstChecksum);
  }, 30_000);

  it("--only=<step> runs a single step and fails clearly on an unmet prerequisite", async () => {
    await expect(runDerive(pool, { only: "not-a-real-step" })).rejects.toThrow(/unknown step/);

    const results = await runDerive(pool, { only: "amenities" });
    expect(results).toHaveLength(1);
    expect(results[0]?.name).toBe("amenities");
    expect(results[0]?.rowsWritten).toBe(21);
  });
});

describe("derive", () => {
  it.skipIf(Boolean(databaseUrl))(
    "SKIPPED integration tests above: DATABASE_URL is not set — set it to a PostGIS connection string to run them, e.g. DATABASE_URL=postgresql://tokyo:tokyo@localhost:5432/tokyo_test pnpm test",
    () => {
      console.warn(
        "derive.test.ts: DATABASE_URL is not set; skipping PostGIS integration tests. " +
          "Run with DATABASE_URL=postgresql://tokyo:tokyo@localhost:5432/tokyo_test pnpm test",
      );
    },
  );
});

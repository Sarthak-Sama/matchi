/**
 * Integration test for the migration runner. Requires a real PostGIS
 * database reachable via `DATABASE_URL` — skips with an explicit message
 * when unset, so a missing env var never reads as a silent pass.
 *
 * Run with:
 *   DATABASE_URL=postgresql://tokyo:tokyo@localhost:5432/tokyo_test pnpm test
 *
 * The test runs migrations inside a dedicated scratch Postgres schema
 * (created and dropped per run) so it never touches whatever tables
 * already exist in the target database's `public` schema.
 */

import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { runMigrations } from "./migrate.js";

const databaseUrl = process.env["DATABASE_URL"];

const EXPECTED_COLUMNS: Record<string, readonly string[]> = {
  import_runs: [
    "id",
    "source",
    "source_updated_at",
    "started_at",
    "finished_at",
    "status",
    "rows_imported",
    "error",
  ],
  wards: ["ward_code", "name_ja", "name_en", "geom", "source", "source_updated_at", "imported_at"],
  station_groups: [
    "station_group_id",
    "name_ja",
    "name_en",
    "aliases",
    "point",
    "ward_code",
    "source",
    "source_updated_at",
    "imported_at",
  ],
  station_source_refs: ["id", "station_group_id", "source", "source_id", "source_name"],
  rail_lines: [
    "rail_line_id",
    "operator",
    "name_ja",
    "name_en",
    "mode",
    "geom",
    "source",
    "source_updated_at",
    "imported_at",
  ],
  rail_edges: [
    "id",
    "from_station_group_id",
    "to_station_group_id",
    "rail_line_id",
    "edge_type",
    "peak_travel_minutes",
    "offpeak_travel_minutes",
    "peak_wait_minutes",
    "offpeak_wait_minutes",
    "confidence",
    "source",
    "source_updated_at",
    "imported_at",
  ],
  station_areas: ["station_group_id", "radius_m", "geom", "area_sqm", "derived_at"],
  rent_stats: [
    "id",
    "ward_code",
    "period",
    "source",
    "rent_per_sqm_yen",
    "management_fee_yen",
    "sample_count",
    "source_updated_at",
    "imported_at",
  ],
  land_prices: [
    "id",
    "point",
    "price_yen_per_sqm",
    "year",
    "use_category",
    "ward_code",
    "source",
    "source_updated_at",
    "imported_at",
  ],
  zoning_areas: [
    "id",
    "category",
    "is_residential",
    "geom",
    "source",
    "source_updated_at",
    "imported_at",
  ],
  flood_zones: [
    "id",
    "depth_category",
    "depth_rank",
    "geom",
    "source",
    "source_updated_at",
    "imported_at",
  ],
  pois: [
    "id",
    "category",
    "name",
    "osm_type",
    "osm_id",
    "point",
    "source",
    "source_updated_at",
    "imported_at",
  ],
  major_roads: ["id", "name", "road_class", "geom", "source", "source_updated_at", "imported_at"],
  neighborhood_metrics: [
    "station_group_id",
    "ward_code",
    "rent_low_yen",
    "rent_median_yen",
    "rent_high_yen",
    "rent_confidence",
    "rent_source",
    "rent_source_period",
    "rent_per_sqm_yen",
    "management_fee_yen",
    "land_price_multiplier",
    "land_price_point_count",
    "land_price_used_fallback",
    "supermarket_count",
    "grocery_count",
    "convenience_count",
    "amenity_supermarket_equiv",
    "restaurant_count",
    "cafe_count",
    "nightlife_count",
    "flood_share_by_category",
    "flood_exposure_score",
    "residential_zoning_share",
    "road_rail_exposure_share",
    "quietness_raw",
    "norm_amenity_supermarket",
    "norm_amenity_restaurant",
    "norm_flood_safety",
    "norm_quietness",
    "source_dates",
    "derived_at",
  ],
};

const EXPECTED_GIST_INDEXES = [
  "wards_geom_gist_idx",
  "station_groups_point_gist_idx",
  "rail_lines_geom_gist_idx",
  "station_areas_geom_gist_idx",
  "land_prices_point_gist_idx",
  "zoning_areas_geom_gist_idx",
  "flood_zones_geom_gist_idx",
  "pois_point_gist_idx",
  "major_roads_geom_gist_idx",
  // Added in 0002_geography_indexes.sql (Task 7): expression indexes on
  // `(point::geography)`, needed because a plain geometry GiST index isn't
  // used by the planner for a geography-cast ST_DWithin predicate.
  "pois_point_geog_gist_idx",
  "land_prices_point_geog_gist_idx",
];

describe.runIf(Boolean(databaseUrl))("migrate", () => {
  const scratchSchema = `migrate_test_${process.pid}_${Date.now()}`;
  let adminPool: Pool;
  let scratchDatabaseUrl: string;
  let originalDatabaseUrl: string | undefined;

  beforeAll(async () => {
    if (!databaseUrl) return;
    originalDatabaseUrl = process.env["DATABASE_URL"];
    adminPool = new Pool({ connectionString: databaseUrl });
    await adminPool.query(`CREATE SCHEMA "${scratchSchema}"`);

    // search_path lists the scratch schema first (so unqualified CREATE
    // TABLE lands there) and keeps `public` after it, since postgis and
    // pg_trgm are already installed into `public` and their types/operators
    // (e.g. `geometry`) must stay resolvable without schema-qualifying them.
    const url = new URL(databaseUrl);
    url.searchParams.set("options", `-c search_path=${scratchSchema},public`);
    scratchDatabaseUrl = url.toString();
  });

  afterAll(async () => {
    if (!databaseUrl) return;
    await adminPool.query(`DROP SCHEMA IF EXISTS "${scratchSchema}" CASCADE`);
    await adminPool.end();
  });

  it("applies 0001_init.sql: every table exists with the expected columns", async () => {
    process.env["DATABASE_URL"] = scratchDatabaseUrl;
    try {
      await runMigrations({ dryRun: false });
    } finally {
      process.env["DATABASE_URL"] = originalDatabaseUrl;
    }

    for (const [table, expectedColumns] of Object.entries(EXPECTED_COLUMNS)) {
      const { rows } = await adminPool.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = $1 AND table_name = $2`,
        [scratchSchema, table],
      );
      const actualColumns = rows.map((r) => r.column_name).sort();
      expect(actualColumns, `columns of ${table}`).toEqual([...expectedColumns].sort());
    }
  });

  it("records the migration filename in schema_migrations", async () => {
    const { rows } = await adminPool.query<{ filename: string }>(
      `SELECT filename FROM "${scratchSchema}".schema_migrations ORDER BY filename`,
    );
    expect(rows.map((r) => r.filename)).toEqual([
      "0001_init.sql",
      "0002_geography_indexes.sql",
      "0003_land_price_used_fallback.sql",
    ]);
  });

  it("has the postgis and pg_trgm extensions installed", async () => {
    const { rows } = await adminPool.query<{ extname: string }>(
      `SELECT extname FROM pg_extension WHERE extname IN ('postgis', 'pg_trgm') ORDER BY extname`,
    );
    expect(rows.map((r) => r.extname)).toEqual(["pg_trgm", "postgis"]);
  });

  it("has a GiST index on every geometry column", async () => {
    const { rows } = await adminPool.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes
       WHERE schemaname = $1 AND indexdef ILIKE '%USING gist%'`,
      [scratchSchema],
    );
    const actual = rows.map((r) => r.indexname).sort();
    expect(actual).toEqual([...EXPECTED_GIST_INDEXES].sort());
  });

  it("has a GIN trigram index on station_groups.name_en and name_ja", async () => {
    const { rows } = await adminPool.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes
       WHERE schemaname = $1 AND tablename = 'station_groups' AND indexdef ILIKE '%gin_trgm_ops%'`,
      [scratchSchema],
    );
    expect(rows.map((r) => r.indexname).sort()).toEqual([
      "station_groups_name_en_trgm_idx",
      "station_groups_name_ja_trgm_idx",
    ]);
  });

  it("prevents duplicate transfer edges (rail_line_id IS NULL) via a partial unique index", async () => {
    const { rows } = await adminPool.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes
       WHERE schemaname = $1 AND tablename = 'rail_edges' AND indexname = 'rail_edges_null_line_unique_idx'`,
      [scratchSchema],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.indexdef).toContain("WHERE (rail_line_id IS NULL)");
  });

  it("is idempotent: running a second time applies nothing", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    process.env["DATABASE_URL"] = scratchDatabaseUrl;
    try {
      await runMigrations({ dryRun: false });
    } finally {
      process.env["DATABASE_URL"] = originalDatabaseUrl;
    }

    // Assert on the recorded calls before restoring — `mockRestore()` also
    // clears the call history (it does everything `mockReset()` does), so
    // asserting after restoring would always see zero calls.
    expect(logSpy).toHaveBeenCalledWith("up to date");
    logSpy.mockRestore();

    const { rows } = await adminPool.query<{ filename: string }>(
      `SELECT filename FROM "${scratchSchema}".schema_migrations`,
    );
    expect(rows).toHaveLength(3);
  });
});

describe("migrate", () => {
  // Sentinel test: passes (with an explicit explanatory title) only when
  // DATABASE_URL is unset, so `pnpm test` output always makes clear *why*
  // the real integration tests above were skipped rather than silently
  // omitted. When DATABASE_URL is set, this sentinel itself is skipped.
  it.skipIf(Boolean(databaseUrl))(
    "SKIPPED integration tests above: DATABASE_URL is not set — set it to a PostGIS connection string to run them, e.g. DATABASE_URL=postgresql://tokyo:tokyo@localhost:5432/tokyo_test pnpm test",
    () => {
      console.warn(
        "migrate.test.ts: DATABASE_URL is not set; skipping PostGIS integration tests. " +
          "Run with DATABASE_URL=postgresql://tokyo:tokyo@localhost:5432/tokyo_test pnpm test",
      );
    },
  );
});

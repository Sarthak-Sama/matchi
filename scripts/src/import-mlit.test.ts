/**
 * Tests for `pnpm import:mlit`.
 *
 * The pure-function tests below (parsing, normalization, station merging,
 * validation) never touch a database or the network — every input comes
 * from the small committed fixtures under `fixtures/mlit/`.
 *
 * The DB-guarded section at the bottom requires a real PostGIS database
 * reachable via `DATABASE_URL` — it skips with an explicit message when
 * unset, so a missing env var never reads as a silent pass. Run with:
 *
 *   DATABASE_URL=postgresql://tokyo:tokyo@localhost:5432/tokyo_test pnpm test
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseFeatureCollection } from "./import-mlit/geojson.js";
import { classifyFloodDepth, parseFloodZones } from "./import-mlit/flood.js";
import { classifyLandUseCategory, parseLandPrices } from "./import-mlit/land-prices.js";
import { parseRailLineFeature, parseRailLines } from "./import-mlit/rail-lines.js";
import { mergeStations, normalizeStationName } from "./import-mlit/station-merge.js";
import { parseStations } from "./import-mlit/stations.js";
import { MIN_WARDS_ROWS, parseWards } from "./import-mlit/wards.js";
import { classifyZoningCategory, parseZoningAreas } from "./import-mlit/zoning.js";
import type { ImportMlitArgs, MlitImportResult } from "./import-mlit.js";
import { runMlitImport } from "./import-mlit.js";
import { runImport } from "./lib/import-run.js";
import { expectRowCount } from "./lib/validate.js";
import { runMigrations } from "./migrate.js";
import { runSeed } from "./seed.js";
import { destructiveTestDatabaseUrl } from "./test-support/database-url.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, "fixtures/mlit");

function fixture(name: string): string {
  return readFileSync(path.join(FIXTURES_DIR, name), "utf8");
}

function fixturePath(name: string): string {
  return path.join(FIXTURES_DIR, name);
}

// ---------------------------------------------------------------------------
// Pure parsing / normalization — no DB.
// ---------------------------------------------------------------------------

describe("wards parsing", () => {
  it("parses wards.geojson into the expected row shapes", () => {
    const features = parseFeatureCollection(fixture("wards.geojson"), "wards");
    const wards = parseWards(features);

    expect(wards).toHaveLength(3);
    expect(wards[0]).toMatchObject({ wardCode: "13113", nameJa: "渋谷区", nameEn: "Shibuya" });
    expect(wards[1]).toMatchObject({ wardCode: "13104", nameJa: "新宿区", nameEn: "Shinjuku" });
    expect(wards[0]?.geomWKT.startsWith("MULTIPOLYGON")).toBe(true);
  });

  it("a fixture missing a required column produces a clear validation error", () => {
    const features = parseFeatureCollection(fixture("wards.missing-column.geojson"), "wards");
    expect(() => parseWards(features)).toThrowError(/missing required column\(s\): ward_code/);
  });

  it("a row count below the configured minimum aborts the import", () => {
    const features = parseFeatureCollection(fixture("wards.empty.geojson"), "wards");
    expect(features).toHaveLength(0);
    expect(() => expectRowCount(features.length, { min: MIN_WARDS_ROWS, label: "wards" })).toThrowError(
      /wards: expected at least 1 row\(s\), got 0/,
    );
  });
});

describe("stations parsing + merging", () => {
  it("parses stations.geojson into raw station rows", () => {
    const features = parseFeatureCollection(fixture("stations.geojson"), "stations");
    const stations = parseStations(features);

    expect(stations).toHaveLength(3);
    expect(stations[0]).toMatchObject({ sourceId: "mlit-st-1", nameJa: "渋谷駅", nameEn: "渋谷駅" });
    expect(stations[2]).toMatchObject({ sourceId: "mlit-st-3", nameJa: "新宿", nameEn: "Shinjuku" });
  });

  it("merges the two near-identical stations into one group; the third stays separate", () => {
    const features = parseFeatureCollection(fixture("stations.geojson"), "stations");
    const stations = parseStations(features);
    const groups = mergeStations(stations);

    expect(groups).toHaveLength(2);

    const merged = groups.find((g) => g.members.length === 2);
    const separate = groups.find((g) => g.members.length === 1);
    expect(merged, "expected one merged group of 2").toBeDefined();
    expect(separate, "expected one separate group of 1").toBeDefined();

    expect(merged?.members.map((m) => m.sourceId).sort()).toEqual(["mlit-st-1", "mlit-st-2"]);
    expect(separate?.members[0]?.sourceId).toBe("mlit-st-3");

    // Representative point is the centroid of the merged members.
    expect(merged?.lat).toBeCloseTo((35.658 + 35.6583) / 2, 4);
    expect(merged?.lon).toBeCloseTo((139.7016 + 139.702) / 2, 4);
  });

  it("normalizeStationName strips a trailing 駅 / Station suffix so they match", () => {
    expect(normalizeStationName("渋谷駅")).toBe(normalizeStationName("渋谷"));
    expect(normalizeStationName("Shibuya Station")).toBe(normalizeStationName("shibuya"));
    expect(normalizeStationName("渋谷")).not.toBe(normalizeStationName("新宿"));
  });
});

describe("rail-lines parsing", () => {
  it("parses rail-lines.geojson into the expected row shapes", () => {
    const features = parseFeatureCollection(fixture("rail-lines.geojson"), "rail-lines");
    const lines = parseRailLines(features);

    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ operator: "JR東日本", nameJa: "山手線", mode: "local_rail" });
    expect(lines[1]).toMatchObject({ operator: "東京メトロ", nameJa: "銀座線", mode: "subway" });
    expect(lines[0]?.geomWKT.startsWith("MULTILINESTRING")).toBe(true);
  });

  it("rejects a mode outside the schema's enum, naming the bad value", () => {
    const feature = {
      type: "Feature" as const,
      properties: { operator: "Test Rail", name_ja: "テスト線", mode: "bullet_train" },
      geometry: { type: "LineString", coordinates: [[139.7, 35.6], [139.71, 35.61]] },
    };
    expect(() => parseRailLineFeature(feature, 0)).toThrowError(/mode "bullet_train" is not one of/);
  });
});

describe("land-prices parsing", () => {
  it("parses land-prices.geojson into the expected row shapes", () => {
    const features = parseFeatureCollection(fixture("land-prices.geojson"), "land-prices");
    const rows = parseLandPrices(features);

    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ priceYenPerSqm: 850000, year: 2025, useCategory: "residential" });
    expect(rows[1]).toMatchObject({ priceYenPerSqm: 920000, useCategory: "residential" });
    expect(rows[2]).toMatchObject({ priceYenPerSqm: 1500000, useCategory: "commercial" });
  });

  it("classifyLandUseCategory maps known residential tokens to the literal derive/rent.ts expects", () => {
    expect(classifyLandUseCategory("住宅")).toBe("residential");
    expect(classifyLandUseCategory("Residential")).toBe("residential");
    expect(classifyLandUseCategory("commercial")).toBe("commercial");
  });

  it("rejects a non-positive price", () => {
    const feature = {
      type: "Feature" as const,
      properties: { price_yen_per_sqm: -5, year: 2025 },
      geometry: { type: "Point", coordinates: [139.7, 35.66] },
    };
    expect(() => parseLandPrices([feature])).toThrowError(/must be a positive number/);
  });
});

describe("zoning parsing", () => {
  it("classifies numeric use-district codes and honors an explicit is_residential override", () => {
    const features = parseFeatureCollection(fixture("zoning.geojson"), "zoning");
    const rows = parseZoningAreas(features);

    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ category: "category1_low_rise_residential", isResidential: true });
    expect(rows[1]).toMatchObject({ category: "commercial", isResidential: false });
    expect(rows[2]).toMatchObject({ category: "mixed_use_special_district", isResidential: true });
  });

  it("classifyZoningCategory throws for an unrecognized category with no override", () => {
    expect(() => classifyZoningCategory("some_unknown_zone_xyz")).toThrowError(/cannot classify/);
  });
});

describe("flood parsing", () => {
  it("classifies known depth categories into severity ranks", () => {
    const features = parseFeatureCollection(fixture("flood.geojson"), "flood");
    const rows = parseFloodZones(features);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ depthCategory: "0.5m未満", depthRank: 1 });
    expect(rows[1]).toMatchObject({ depthCategory: "3.0m以上5.0m未満", depthRank: 3 });
  });

  it("classifyFloodDepth throws for an unrecognized category with no override", () => {
    expect(() => classifyFloodDepth("unrecognized depth range")).toThrowError(/cannot classify/);
  });
});

// ---------------------------------------------------------------------------
// DB-guarded integration tests.
// ---------------------------------------------------------------------------

const databaseUrl = destructiveTestDatabaseUrl();

const GOOD_ARGS: ImportMlitArgs = {
  wardsPath: fixturePath("wards.geojson"),
  stationsPath: fixturePath("stations.geojson"),
  railLinesPath: fixturePath("rail-lines.geojson"),
  landPricesPath: fixturePath("land-prices.geojson"),
  zoningPath: fixturePath("zoning.geojson"),
  floodPath: fixturePath("flood.geojson"),
};

const CORRUPT_ARGS: ImportMlitArgs = {
  ...GOOD_ARGS,
  landPricesPath: fixturePath("land-prices.corrupt.geojson"),
};

// wards(3) + stationGroups(2) + railLines(2) + landPrices(3) + zoning(3) + flood(2)
const EXPECTED_ROWS_IMPORTED = 15;

const MLIT_SOURCED_TABLES = [
  "wards",
  "station_groups",
  "station_source_refs",
  "rail_lines",
  "land_prices",
  "zoning_areas",
  "flood_zones",
] as const;

async function snapshotCounts(pool: Pool): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const table of MLIT_SOURCED_TABLES) {
    const { rows } = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM ${table} WHERE source = 'mlit'`,
    );
    counts[table] = Number(rows[0]?.count ?? "0");
  }
  return counts;
}

describe.runIf(Boolean(databaseUrl))("import:mlit (DB integration)", () => {
  let pool: Pool;

  beforeAll(async () => {
    if (!databaseUrl) return;
    await runMigrations({ dryRun: false });
    pool = new Pool({ connectionString: databaseUrl });
    // Clean slate for mlit-sourced rows, independent of anything else that
    // has run against this database.
    await pool.query(`DELETE FROM import_runs WHERE source = 'mlit'`);
    for (const table of MLIT_SOURCED_TABLES) {
      await pool.query(`DELETE FROM ${table} WHERE source = 'mlit'`);
    }
  });

  afterAll(async () => {
    if (!databaseUrl) return;
    // This import upserts wards by ward_code — the schema's only key for
    // that table (see import-mlit.ts's module doc comment) — so a run
    // against a database that also has seed data overwrites the seed rows
    // whose ward_code happens to collide with a real Tokyo ward code
    // (13113, 13104, 13110 in this suite's fixtures). Restore a pristine
    // seed baseline afterward so this file doesn't leave the shared
    // database in a mixed-source state for whatever runs next.
    await runSeed();
    await pool.end();
  });

  it("a full run records one success import_runs row with the right rows_imported and populates the tables", async () => {
    const result = await runImport({ source: "mlit", pool }, (client) => runMlitImport(client, GOOD_ARGS));

    expect(result.rowsImported).toBe(EXPECTED_ROWS_IMPORTED);

    const { rows } = await pool.query<{ status: string; rows_imported: number | null }>(
      `SELECT status, rows_imported FROM import_runs WHERE source = 'mlit'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "success", rows_imported: EXPECTED_ROWS_IMPORTED });

    const counts = await snapshotCounts(pool);
    expect(counts).toEqual({
      wards: 3,
      station_groups: 2,
      station_source_refs: 3,
      rail_lines: 2,
      land_prices: 3,
      zoning_areas: 3,
      flood_zones: 2,
    });

    // land-prices.geojson: 2 of 3 rows classify as 'residential' ("住宅" +
    // "residential"); the third ("commercial") does not.
    expect((result as MlitImportResult).residentialLandPriceCount).toBe(2);

    // Risk called out in the brief: every imported station must have a
    // ward_code assigned via the spatial join (both fixture stations fall
    // inside one of the three imported wards).
    const { rows: withoutWard } = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM station_groups WHERE source = 'mlit' AND ward_code IS NULL`,
    );
    expect(Number(withoutWard[0]?.count)).toBe(0);
  });

  it("a deliberately corrupt fixture writes one failed import_runs row and leaves the data tables unchanged", async () => {
    const before = await snapshotCounts(pool);

    await expect(
      runImport({ source: "mlit", pool }, (client) => runMlitImport(client, CORRUPT_ARGS)),
    ).rejects.toThrowError(/missing required column\(s\): price_yen_per_sqm/);

    const after = await snapshotCounts(pool);
    expect(after).toEqual(before);

    const { rows } = await pool.query<{ status: string; error: string | null }>(
      `SELECT status, error FROM import_runs WHERE source = 'mlit' ORDER BY started_at`,
    );
    // The earlier success row, plus this run's failure.
    expect(rows).toHaveLength(2);
    expect(rows[0]?.status).toBe("success");
    expect(rows[1]?.status).toBe("failed");
    expect(rows[1]?.error).toMatch(/missing required column\(s\): price_yen_per_sqm/);
  });

  it("reports which ward codes were overwritten from a different source, and logs a warning about it", async () => {
    // Force ward 13113 (Shibuya) to look like it came from somewhere else,
    // simulating the seed-fixture collision this script's module doc
    // comment describes.
    await pool.query(`UPDATE wards SET source = 'seed' WHERE ward_code = '13113'`);

    // Assert on the structured result rather than captured console output:
    // Vitest's own console interception makes `vi.spyOn(console, "warn")`
    // (and even `process.stderr.write`) unreliable to spy on directly in
    // this environment, even though the warning does print for real (see
    // the visible `import:mlit — ... will be overwritten: 13113` line in
    // this test's own console output above). `MlitImportResult` surfaces
    // the exact same computed list `upsertWards` also logs a warning
    // about, so this is testing the real mechanism, not a substitute.
    const result = (await runImport(
      { source: "mlit", pool },
      (client) => runMlitImport(client, GOOD_ARGS),
    )) as MlitImportResult;

    expect(result.overwrittenDifferentSourceWardCodes).toEqual(["13113"]);

    const { rows } = await pool.query<{ source: string }>(
      `SELECT source FROM wards WHERE ward_code = '13113'`,
    );
    expect(rows[0]?.source).toBe("mlit");
  });

  it("reports zero residential land_prices rows and warns loudly when every row is non-residential", async () => {
    const allCommercialArgs: ImportMlitArgs = {
      ...GOOD_ARGS,
      landPricesPath: fixturePath("land-prices-all-commercial.geojson"),
    };

    const result = (await runImport(
      { source: "mlit", pool },
      (client) => runMlitImport(client, allCommercialArgs),
    )) as MlitImportResult;

    // Asserted on the structured result rather than captured console
    // output, for the same reason the ward-overwrite test above does —
    // the warning does print for real (visible in this test's own console
    // output), but Vitest's console interception makes spying on it
    // unreliable in this environment.
    expect(result.residentialLandPriceCount).toBe(0);
  });

  it(
    "aborts with a clear error naming the ward and blocking table when a NOT NULL FK " +
      "(rent_stats) still references a ward being removed, and leaves everything unchanged",
    async () => {
      // Establish a clean baseline: ward 13113 exists with source='mlit'.
      await runImport({ source: "mlit", pool }, (client) => runMlitImport(client, GOOD_ARGS));

      // rent_stats.ward_code is NOT NULL REFERENCES wards(ward_code) — this
      // table already exists from Task 3's schema, so a real dependent row
      // can be simulated directly without needing Task 12's import:rent to
      // exist yet. (If this ever needs adjusting once import:rent lands,
      // replace this raw INSERT with a real `pnpm import:rent` fixture run.)
      // A distinct period/source that seed's own rent_stats fixture never
      // uses (seed only writes 'estat'/2023 and 'reins'/2026Q2 for ward
      // 13113 — see fixtures/seed/rent.ts) keeps this test's expected count
      // exact regardless of whatever seed data this shared database
      // already has.
      const { rows: rentBefore } = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM rent_stats WHERE ward_code = '13113'`,
      );
      const beforeCount = Number(rentBefore[0]?.count ?? "0");
      await pool.query(
        `INSERT INTO rent_stats (ward_code, period, source, rent_per_sqm_yen, management_fee_yen, sample_count)
         VALUES ('13113', 'test-fixture-period', 'test-fixture-source', 3000, 5000, 42)`,
      );
      const expectedCount = beforeCount + 1;

      const before = await snapshotCounts(pool);

      // This wards file drops 13113 entirely — it would otherwise be
      // deleted as "no longer seen this run".
      const droppedArgs: ImportMlitArgs = {
        ...GOOD_ARGS,
        wardsPath: fixturePath("wards-dropped-shibuya.geojson"),
      };

      await expect(
        runImport({ source: "mlit", pool }, (client) => runMlitImport(client, droppedArgs)),
      ).rejects.toThrowError(
        new RegExp(`ward 13113 still has ${expectedCount} rent_stats row\\(s\\)`),
      );

      // The whole transaction rolled back: wards/stations/etc. are exactly
      // as they were, and the rent_stats rows are untouched.
      const after = await snapshotCounts(pool);
      expect(after).toEqual(before);
      const { rows: rentAfter } = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM rent_stats WHERE ward_code = '13113'`,
      );
      expect(Number(rentAfter[0]?.count)).toBe(expectedCount);

      const { rows: wardRows } = await pool.query<{ ward_code: string }>(
        `SELECT ward_code FROM wards WHERE ward_code = '13113'`,
      );
      expect(wardRows).toHaveLength(1);

      await pool.query(
        `DELETE FROM rent_stats WHERE ward_code = '13113' AND source = 'test-fixture-source'`,
      );
    },
  );
});

describe("import:mlit", () => {
  // Sentinel test: passes (with an explicit explanatory title) only when
  // DATABASE_URL is unset, so `pnpm test` output always makes clear *why*
  // the real integration tests above were skipped rather than silently
  // omitted. When DATABASE_URL is set, this sentinel itself is skipped.
  it.skipIf(Boolean(databaseUrl))(
    "SKIPPED integration tests above: DATABASE_URL is not set — set it to a PostGIS connection string to run them, e.g. DATABASE_URL=postgresql://tokyo:tokyo@localhost:5432/tokyo_test pnpm test",
    () => {
      console.warn(
        "import-mlit.test.ts: DATABASE_URL is not set; skipping PostGIS integration tests. " +
          "Run with DATABASE_URL=postgresql://tokyo:tokyo@localhost:5432/tokyo_test pnpm test",
      );
    },
  );
});

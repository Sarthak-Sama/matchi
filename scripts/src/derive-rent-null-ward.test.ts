import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runDerive } from "./derive.js";
import { runMigrations } from "./migrate.js";
import { runSeed } from "./seed.js";
import { destructiveTestDatabaseUrl } from "./test-support/database-url.js";

const databaseUrl = destructiveTestDatabaseUrl();

const NULL_WARD_STATION_ID = "sg-outside-all-wards-test";

describe.runIf(Boolean(databaseUrl))(
  "derive — a station with a null ward_code does not abort the pipeline",
  () => {
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

      await pool.query(
        `INSERT INTO station_groups (station_group_id, name_en, name_ja, aliases, point, ward_code, source)
         VALUES ($1, 'Outside All Wards Test', 'テスト駅', '{}', ST_SetSRID(ST_MakePoint(139.702, 35.659), 4326), NULL, 'test')`,
        [NULL_WARD_STATION_ID],
      );
    }, 60_000);

    afterAll(async () => {
      if (!databaseUrl) return;
      await pool.query(`DELETE FROM station_groups WHERE station_group_id = $1`, [
        NULL_WARD_STATION_ID,
      ]);
      await pool.end();
    });

    it("a full derive run completes all eight steps without throwing", async () => {
      const results = await runDerive(pool);
      expect(results).toHaveLength(8);
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
    });

    it("the null-ward station has null rent-derived fields but populated norm_* fields", async () => {
      const { rows } = await pool.query<{
        ward_code: string | null;
        rent_source: string | null;
        rent_median_yen: string | null;
        norm_amenity_supermarket: number | null;
        norm_quietness: number | null;
      }>(
        `SELECT ward_code, rent_source, rent_median_yen::text, norm_amenity_supermarket,
                norm_quietness
         FROM neighborhood_metrics WHERE station_group_id = $1`,
        [NULL_WARD_STATION_ID],
      );
      expect(rows).toHaveLength(1);
      const row = rows[0]!;
      expect(row.ward_code).toBeNull();
      expect(row.rent_source).toBeNull();
      expect(row.rent_median_yen).toBeNull();

      expect(row.norm_amenity_supermarket).not.toBeNull();
      expect(row.norm_quietness).not.toBeNull();
    });

    it("every other (ward-having) station still gets a non-null rent_source", async () => {
      const { rows } = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM neighborhood_metrics
         WHERE ward_code IS NOT NULL AND rent_source IS NULL`,
      );
      expect(Number(rows[0]?.count ?? "1")).toBe(0);
    });

    it("re-running the full pipeline again (idempotence) still completes cleanly with the null-ward station present", async () => {
      await expect(runDerive(pool)).resolves.toHaveLength(8);
    });
  },
);

describe("derive — a station with a null ward_code does not abort the pipeline", () => {
  it.skipIf(Boolean(databaseUrl))(
    "SKIPPED integration tests above: DATABASE_URL is not set — set it to a PostGIS connection string to run them, e.g. DATABASE_URL=postgresql://tokyo:tokyo@localhost:5432/tokyo_test pnpm test",
    () => {
      console.warn(
        "derive-rent-null-ward.test.ts: DATABASE_URL is not set; skipping PostGIS integration tests. " +
          "Run with DATABASE_URL=postgresql://tokyo:tokyo@localhost:5432/tokyo_test pnpm test",
      );
    },
  );
});

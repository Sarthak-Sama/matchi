/**
 * Regression test for the final fix wave's fix #1: a station whose
 * `ward_code` is null (e.g. it fell outside every imported ward's polygon —
 * see `import-mlit.ts`'s module doc comment on `stationsWithoutWardCode`)
 * must not make a full `pnpm derive` abort.
 *
 * Before the fix, `normalization`'s prerequisite check
 * (`assertColumnsPopulated`) required EVERY `neighborhood_metrics` row to
 * have a non-null `rent_source` — but `derive/rent.ts`'s own loop
 * warn-and-skips exactly this case (no `ward_code`, or no `rent_stats` row
 * for the station's ward), leaving `rent_source` null there forever. So the
 * very first real import that produced even one out-of-ward station made a
 * full `pnpm derive` abort permanently at step 7, with a `--only=rent`
 * fix hint that re-running could never satisfy (rent would skip that same
 * station again). The seed fixture never triggers this — every seeded
 * station falls inside a seeded ward with `rent_stats` coverage — which is
 * why this needed its own test rather than being caught by
 * `derive.test.ts`'s existing suite.
 *
 * This seeds the normal fixture, adds ONE extra station with `ward_code =
 * NULL` directly (bypassing `import:mlit`, which is what actually produces
 * this case for real MLIT data — see that script's `assignWardCodes`), and
 * asserts a full derive completes without throwing, leaving that station's
 * rent-derived fields null while its ward-independent `norm_*` fields are
 * still populated. Requires a real PostGIS database reachable via
 * `DATABASE_URL` — skips with an explicit message when unset, mirroring
 * `derive.test.ts`'s own pattern.
 */

import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runDerive } from "./derive.js";
import { runMigrations } from "./migrate.js";
import { runSeed } from "./seed.js";

const databaseUrl = process.env["DATABASE_URL"];

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

      // Simulate exactly what import-mlit.ts's assignWardCodes produces
      // for a real station outside every imported ward's polygon: a
      // station_groups row with ward_code = NULL. Placed near Shibuya so
      // it still gets real amenity/flood/zoning data computed against its
      // catchment (this test is about ward_code being null, not about an
      // empty catchment — that's covered elsewhere).
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

    it("a full derive run completes all seven steps without throwing", async () => {
      const results = await runDerive(pool);
      expect(results).toHaveLength(7);
      expect(results.map((r) => r.name)).toEqual([
        "catchments",
        "amenities",
        "flood",
        "zoning",
        "quietness",
        "rent",
        "normalization",
      ]);
    });

    it("the null-ward station has null rent-derived fields but populated norm_* fields", async () => {
      const { rows } = await pool.query<{
        ward_code: string | null;
        rent_source: string | null;
        rent_median_yen: string | null;
        norm_amenity_supermarket: number | null;
        norm_flood_safety: number | null;
        norm_quietness: number | null;
      }>(
        `SELECT ward_code, rent_source, rent_median_yen::text, norm_amenity_supermarket,
                norm_flood_safety, norm_quietness
         FROM neighborhood_metrics WHERE station_group_id = $1`,
        [NULL_WARD_STATION_ID],
      );
      expect(rows).toHaveLength(1);
      const row = rows[0]!;
      expect(row.ward_code).toBeNull();
      expect(row.rent_source).toBeNull();
      expect(row.rent_median_yen).toBeNull();
      // norm_* is derived purely from the catchment geometry (amenities,
      // flood, zoning, quietness) — none of which depend on ward_code — so
      // these must still be populated even though rent could not be.
      expect(row.norm_amenity_supermarket).not.toBeNull();
      expect(row.norm_flood_safety).not.toBeNull();
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
      await expect(runDerive(pool)).resolves.toHaveLength(7);
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

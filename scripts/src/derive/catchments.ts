/**
 * Step 1 — station catchments -> `station_areas`.
 *
 * For every `station_groups` row, builds an 800m circular catchment via
 * `ST_Buffer(point::geography, CATCHMENT_RADIUS_M)::geometry` so the radius
 * is genuine metres, never raw degrees (a degrees-based buffer would be off
 * by orders of magnitude — see the `area_sqm` test in derive.test.ts).
 * `area_sqm` is computed with `ST_Area(geom::geography)` on the stored
 * SRID 4326 polygon, per the brief.
 *
 * Also upserts the base `neighborhood_metrics` row (station_group_id,
 * ward_code) for every station: every later step UPDATEs columns on an
 * existing row rather than inserting one, so this step is the one place
 * that guarantees a row exists to update. Deleting-and-rebuilding
 * `station_areas` (rather than upserting it) is safe and simpler because
 * nothing else in the schema references `station_areas` by foreign key.
 */

import type { Pool } from "pg";

import { CATCHMENT_RADIUS_M } from "@tokyo/shared";

import { withTransaction } from "../lib/db.js";
import type { StepResult } from "./types.js";

export async function runCatchmentsStep(pool: Pool): Promise<StepResult> {
  const start = Date.now();

  const rowsWritten = await withTransaction(pool, async (client) => {
    await client.query("DELETE FROM station_areas");

    const { rowCount } = await client.query(
      `
      WITH buffered AS (
        SELECT
          station_group_id,
          ST_Buffer(point::geography, $1)::geometry AS geom
        FROM station_groups
      )
      INSERT INTO station_areas (station_group_id, radius_m, geom, area_sqm)
      SELECT
        station_group_id,
        $1,
        geom,
        ST_Area(geom::geography)
      FROM buffered
      `,
      [CATCHMENT_RADIUS_M],
    );

    // Ensure every station has a neighborhood_metrics row for later steps
    // to UPDATE. ward_code is refreshed too, in case a station's ward
    // changed since the row was first created.
    await client.query(`
      INSERT INTO neighborhood_metrics (station_group_id, ward_code)
      SELECT station_group_id, ward_code FROM station_groups
      ON CONFLICT (station_group_id) DO UPDATE SET ward_code = EXCLUDED.ward_code
    `);

    return rowCount ?? 0;
  });

  return { name: "catchments", rowsWritten, durationMs: Date.now() - start };
}

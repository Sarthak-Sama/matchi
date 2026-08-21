/**
 * Step 2 — amenity counts.
 *
 * For each station, counts `pois` within `CATCHMENT_RADIUS_M` using
 * `ST_DWithin(point::geography, station.point::geography, 800)` — a
 * geography-cast distance check, so the 800m radius is genuine metres and
 * (per the brief) can use the GiST index on `pois.point`. See
 * derive.test.ts / the task report for the `EXPLAIN` plan.
 *
 * `amenity_supermarket_equiv` folds supermarket/grocery/convenience counts
 * into one "supermarket-equivalent" number via `AMENITY_WEIGHTS`.
 */

import type { Pool } from "pg";

import { AMENITY_WEIGHTS, CATCHMENT_RADIUS_M } from "@tokyo/shared";

import { withTransaction } from "../lib/db.js";
import { assertCatchmentsDerived } from "./prerequisites.js";
import type { StepResult } from "./types.js";

export async function runAmenitiesStep(pool: Pool): Promise<StepResult> {
  const start = Date.now();
  await assertCatchmentsDerived(pool);

  const rowsWritten = await withTransaction(pool, async (client) => {
    const { rowCount } = await client.query(
      `
      WITH counts AS (
        SELECT
          sg.station_group_id,
          COALESCE(SUM((p.category = 'supermarket')::int), 0) AS supermarket_count,
          COALESCE(SUM((p.category = 'grocery')::int), 0) AS grocery_count,
          COALESCE(SUM((p.category = 'convenience')::int), 0) AS convenience_count,
          COALESCE(SUM((p.category = 'restaurant')::int), 0) AS restaurant_count,
          COALESCE(SUM((p.category = 'cafe')::int), 0) AS cafe_count,
          COALESCE(SUM((p.category = 'bar')::int), 0) AS nightlife_count
        FROM station_groups sg
        LEFT JOIN pois p ON ST_DWithin(p.point::geography, sg.point::geography, $1)
        GROUP BY sg.station_group_id
      )
      UPDATE neighborhood_metrics nm
      SET
        supermarket_count = c.supermarket_count,
        grocery_count = c.grocery_count,
        convenience_count = c.convenience_count,
        restaurant_count = c.restaurant_count,
        cafe_count = c.cafe_count,
        nightlife_count = c.nightlife_count,
        amenity_supermarket_equiv =
          c.supermarket_count * $2::double precision
          + c.grocery_count * $3::double precision
          + c.convenience_count * $4::double precision
      FROM counts c
      WHERE nm.station_group_id = c.station_group_id
      `,
      [
        CATCHMENT_RADIUS_M,
        AMENITY_WEIGHTS.supermarket,
        AMENITY_WEIGHTS.grocery,
        AMENITY_WEIGHTS.convenience,
      ],
    );

    return rowCount ?? 0;
  });

  return { name: "amenities", rowsWritten, durationMs: Date.now() - start };
}

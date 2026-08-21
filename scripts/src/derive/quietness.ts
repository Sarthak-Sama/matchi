/**
 * Step 5 — quietness raw.
 *
 * `quietness_raw` is the `QUIETNESS_WEIGHTS`-weighted combination of:
 *   - `residential_zoning_share` (higher = quieter)
 *   - `1 - road_rail_exposure_share` (less road/rail exposure = quieter)
 *   - `1 - normalized nightlife density`, where nightlife density is
 *     `nightlife_count / (area_sqm / 1_000_000)` (count per catchment km²),
 *     min-max normalized to `[0, 1]` across all station areas.
 *
 * Depends on step 2 (`nightlife_count`) and step 4
 * (`residential_zoning_share`, `road_rail_exposure_share`).
 *
 * Min-max edge case: when nightlife density is identical across every
 * station (min == max), normalized density is defined as exactly `0.5` for
 * every station rather than dividing by zero / producing NaN. This mirrors
 * the same rule step 7 applies to the final 0-100 `norm_*` columns.
 */

import type { Pool } from "pg";

import { QUIETNESS_WEIGHTS } from "@tokyo/shared";

import { withTransaction } from "../lib/db.js";
import { assertColumnsPopulated } from "./prerequisites.js";
import type { StepResult } from "./types.js";

export async function runQuietnessStep(pool: Pool): Promise<StepResult> {
  const start = Date.now();
  await assertColumnsPopulated(
    pool,
    ["nightlife_count", "residential_zoning_share", "road_rail_exposure_share"],
    "quietness",
    "`pnpm derive --only=amenities` and `pnpm derive --only=zoning`",
  );

  const rowsWritten = await withTransaction(pool, async (client) => {
    const { rowCount } = await client.query(
      `
      WITH density AS (
        SELECT
          nm.station_group_id,
          nm.nightlife_count::double precision / (sa.area_sqm / 1000000.0) AS nightlife_density
        FROM neighborhood_metrics nm
        JOIN station_areas sa ON sa.station_group_id = nm.station_group_id
      ),
      bounds AS (
        SELECT MIN(nightlife_density) AS min_d, MAX(nightlife_density) AS max_d FROM density
      ),
      normalized AS (
        SELECT
          d.station_group_id,
          CASE
            WHEN b.max_d = b.min_d THEN 0.5
            ELSE (d.nightlife_density - b.min_d) / (b.max_d - b.min_d)
          END AS norm_nightlife_density
        FROM density d CROSS JOIN bounds b
      )
      UPDATE neighborhood_metrics nm
      SET quietness_raw =
        $1 * nm.residential_zoning_share
        + $2 * (1 - nm.road_rail_exposure_share)
        + $3 * (1 - n.norm_nightlife_density)
      FROM normalized n
      WHERE nm.station_group_id = n.station_group_id
      `,
      [
        QUIETNESS_WEIGHTS.residentialZoningShare,
        QUIETNESS_WEIGHTS.inverseRoadRailExposure,
        QUIETNESS_WEIGHTS.inverseNightlifeDensity,
      ],
    );

    return rowCount ?? 0;
  });

  return { name: "quietness", rowsWritten, durationMs: Date.now() - start };
}

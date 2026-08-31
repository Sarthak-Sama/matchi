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

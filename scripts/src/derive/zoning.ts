/**
 * Step 4 — zoning and road/rail exposure.
 *
 * `residential_zoning_share`: share of the catchment intersecting
 * `zoning_areas WHERE is_residential`, residential polygons unioned first
 * so overlaps can't push the share above 1.
 *
 * `road_rail_exposure_share`: share of the catchment within
 * `ROAD_RAIL_BUFFER_M` of a `major_roads` geometry or a `rail_lines`
 * geometry. Both layers are buffered via `::geography` casts (genuine
 * metres) and unioned together before measuring, so a catchment near both
 * a road and a rail line doesn't get double-counted. `rail_lines.geom` can
 * be NULL (no geometry imported yet for a line) — those rows are excluded
 * rather than erroring.
 *
 * Both shares are clamped to `[0, 1]` to absorb floating-point overshoot.
 */

import type { Pool } from "pg";

import { ROAD_RAIL_BUFFER_M } from "@tokyo/shared";

import { withTransaction } from "../lib/db.js";
import { assertCatchmentsDerived } from "./prerequisites.js";
import type { StepResult } from "./types.js";

export async function runZoningStep(pool: Pool): Promise<StepResult> {
  const start = Date.now();
  await assertCatchmentsDerived(pool);

  const rowsWritten = await withTransaction(pool, async (client) => {
    const { rowCount } = await client.query(
      `
      WITH residential_union AS (
        SELECT ST_Union(geom) AS geom FROM zoning_areas WHERE is_residential
      ),
      road_rail_buffers AS (
        SELECT ST_Buffer(geom::geography, $1)::geometry AS geom FROM major_roads
        UNION ALL
        SELECT ST_Buffer(geom::geography, $1)::geometry AS geom FROM rail_lines WHERE geom IS NOT NULL
      ),
      road_rail_union AS (
        SELECT ST_Union(geom) AS geom FROM road_rail_buffers
      ),
      per_station AS (
        SELECT
          sa.station_group_id,
          CASE
            WHEN ru.geom IS NOT NULL AND ST_Intersects(sa.geom, ru.geom)
              THEN LEAST(1.0, GREATEST(0.0,
                ST_Area(ST_Intersection(sa.geom, ru.geom)::geography) / sa.area_sqm))
            ELSE 0.0
          END AS residential_zoning_share,
          CASE
            WHEN rr.geom IS NOT NULL AND ST_Intersects(sa.geom, rr.geom)
              THEN LEAST(1.0, GREATEST(0.0,
                ST_Area(ST_Intersection(sa.geom, rr.geom)::geography) / sa.area_sqm))
            ELSE 0.0
          END AS road_rail_exposure_share
        FROM station_areas sa
        LEFT JOIN residential_union ru ON true
        LEFT JOIN road_rail_union rr ON true
      )
      UPDATE neighborhood_metrics nm
      SET
        residential_zoning_share = p.residential_zoning_share,
        road_rail_exposure_share = p.road_rail_exposure_share
      FROM per_station p
      WHERE nm.station_group_id = p.station_group_id
      `,
      [ROAD_RAIL_BUFFER_M],
    );

    return rowCount ?? 0;
  });

  return { name: "zoning", rowsWritten, durationMs: Date.now() - start };
}

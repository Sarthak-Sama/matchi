/**
 * Step 3 — flood exposure.
 *
 * For each catchment, computes the share of its area intersecting each
 * `flood_zones.depth_category`. `flood_zones` rows of the *same* category
 * are unioned first (`ST_Union` in the `category_union` CTE) so overlapping
 * polygons of one category can't be double-counted into a share > 1 — the
 * brief calls this out explicitly. Areas are computed via `::geography`
 * casts, never raw degrees.
 *
 * `flood_share_by_category` only includes categories with a nonzero share
 * (an empty `{}` for a station overlapping no flood zone). Shares are
 * clamped to `[0, 1]` to absorb floating-point overshoot from the
 * intersection/union arithmetic.
 *
 * `flood_exposure_score` is the area-weighted sum of `share * depth_rank`
 * across categories — normalized (and inverted into `norm_flood_safety`)
 * in step 7, not here.
 */

import type { Pool } from "pg";

import { withTransaction } from "../lib/db.js";
import { assertCatchmentsDerived } from "./prerequisites.js";
import type { StepResult } from "./types.js";

export async function runFloodStep(pool: Pool): Promise<StepResult> {
  const start = Date.now();
  await assertCatchmentsDerived(pool);

  const rowsWritten = await withTransaction(pool, async (client) => {
    const { rowCount } = await client.query(`
      WITH category_union AS (
        SELECT
          depth_category,
          MIN(depth_rank) AS depth_rank,
          ST_Union(geom) AS geom
        FROM flood_zones
        GROUP BY depth_category
      ),
      shares AS (
        SELECT
          sa.station_group_id,
          cu.depth_category,
          cu.depth_rank,
          CASE
            WHEN cu.geom IS NOT NULL AND ST_Intersects(sa.geom, cu.geom)
              THEN LEAST(1.0, GREATEST(0.0,
                ST_Area(ST_Intersection(sa.geom, cu.geom)::geography) / sa.area_sqm))
            ELSE 0.0
          END AS share
        FROM station_areas sa
        LEFT JOIN category_union cu ON true
      ),
      agg AS (
        SELECT
          station_group_id,
          COALESCE(
            jsonb_object_agg(depth_category, share) FILTER (WHERE share > 0),
            '{}'::jsonb
          ) AS flood_share_by_category,
          COALESCE(SUM(share * depth_rank), 0) AS flood_exposure_score
        FROM shares
        GROUP BY station_group_id
      )
      UPDATE neighborhood_metrics nm
      SET
        flood_share_by_category = a.flood_share_by_category,
        flood_exposure_score = a.flood_exposure_score
      FROM agg a
      WHERE nm.station_group_id = a.station_group_id
    `);

    return rowCount ?? 0;
  });

  return { name: "flood", rowsWritten, durationMs: Date.now() - start };
}

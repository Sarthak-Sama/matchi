/**
 * Step 7 — parks and green space.
 *
 * `green_space_share`: share of the catchment intersecting the union of
 * every `green_spaces` polygon (OSM `leisure=park|garden`). Mirrors
 * zoning.ts's `residential_zoning_share` exactly: union first (so
 * overlapping parks can't push the share above 1 before the final clamp),
 * an `ST_Intersects` guard in a `CASE` (so a catchment that touches no
 * green space at all gets an explicit `0.0` rather than a `NULL` from an
 * empty intersection), `ST_Area(ST_Intersection(...)::geography) /
 * sa.area_sqm` for the true metres-based share, and a `LEAST`/`GREATEST`
 * clamp to `[0, 1]` to absorb floating-point overshoot at/near full
 * coverage.
 *
 * No buffering (unlike zoning.ts's `road_rail_exposure_share`, which
 * buffers roads/rail before measuring) — a park's own polygon boundary is
 * the thing that matters; there is no "buffer zone" around a park the way
 * there is around a noise source.
 */

import type { Pool } from "pg";

import { withTransaction } from "../lib/db.js";
import { assertCatchmentsDerived } from "./prerequisites.js";
import type { StepResult } from "./types.js";

export async function runGreenSpaceStep(pool: Pool): Promise<StepResult> {
  const start = Date.now();
  await assertCatchmentsDerived(pool);

  const rowsWritten = await withTransaction(pool, async (client) => {
    const { rowCount } = await client.query(`
      WITH green_union AS (
        -- ST_MakeValid before unioning: real OSM park polygons are not all
        -- valid (35 of 9,868 in the live 23-ward extract self-intersect),
        -- and ST_Union aborts the whole step on the first one with
        -- "TopologyException: side location conflict". CollectionExtract(…, 3)
        -- keeps only the polygonal component, since MakeValid can hand back
        -- a GeometryCollection with stray lines/points for a degenerate
        -- input — those would otherwise contribute nothing to an area share
        -- but can still upset the union. Both are no-ops on valid input.
        SELECT ST_Union(ST_CollectionExtract(ST_MakeValid(geom), 3)) AS geom
        FROM green_spaces
      ),
      per_station AS (
        SELECT
          sa.station_group_id,
          CASE
            WHEN gu.geom IS NOT NULL AND ST_Intersects(sa.geom, gu.geom)
              THEN LEAST(1.0, GREATEST(0.0,
                ST_Area(ST_Intersection(sa.geom, gu.geom)::geography) / sa.area_sqm))
            ELSE 0.0
          END AS green_space_share
        FROM station_areas sa
        LEFT JOIN green_union gu ON true
      )
      UPDATE neighborhood_metrics nm
      SET green_space_share = p.green_space_share
      FROM per_station p
      WHERE nm.station_group_id = p.station_group_id
    `);

    return rowCount ?? 0;
  });

  return { name: "green-space", rowsWritten, durationMs: Date.now() - start };
}

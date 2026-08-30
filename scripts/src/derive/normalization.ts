/**
 * Step 8 — normalization (and `source_dates`).
 *
 * Min-max normalizes across ALL station areas to 0-100:
 *   - `norm_amenity_supermarket` from `amenity_supermarket_equiv`
 *   - `norm_amenity_restaurant` from `restaurant_count + cafe_count`
 *   - `norm_quietness` from `quietness_raw`
 *   - `norm_amenity_convenience` from `convenience_count` (raw column
 *     already populated by amenities.ts; this step's only new work for
 *     konbini is the min-max itself).
 *   - `norm_amenity_cuisine_variety` from `cuisine_variety_count`.
 *   - `norm_green_space` from `green_space_share` (written by the new
 *     green-space step, 7).
 *   - `norm_amenity_late_night` from `late_night_count`. Like the other
 *     four new axes, this is a plain (non-inverted) min-max — but see
 *     derive/amenities.ts's module doc for why `late_night_count` itself is
 *     only an approximation of real closing times, and note the tension
 *     below.
 *   - `norm_amenity_health` from `health_count`.
 *
 * All five new axes are plain min-max (higher raw -> higher score), the
 * same shape as `norm_amenity_supermarket`/`norm_amenity_restaurant` — none
 * of them are inverted.
 *
 * Tension a future reader will meet here, surfaced rather than hidden:
 * `norm_quietness` (just above) is computed from `quietness_raw`, which
 * factors in `nightlife_count` (bars) negatively (derive/quietness.ts). A
 * station with many late-closing bars/restaurants therefore tends to score
 * well on `norm_amenity_late_night` immediately below and *worse* on
 * `norm_quietness` — the same underlying venues pulling two axes in
 * opposite directions. That is a deliberate product tradeoff (late-night
 * food access and residential quiet genuinely compete), not a
 * double-count: the two axes measure different things that happen to share
 * a source.
 *
 * Min-max edge case (mandated by the brief): when every station has the
 * same value on an axis (min == max), that axis's `norm_*` is exactly `50`
 * for every station rather than dividing by zero / producing `NaN`. Values
 * are additionally clamped to `[0, 100]` to absorb floating-point overshoot
 * at the exact min/max stations.
 *
 * `source_dates` records, per contributing source table, the freshest
 * `source_updated_at` among rows that plausibly fed that station's metrics
 * (POIs/land prices within the catchment radius, zoning polygons
 * intersecting the catchment, roads/rail lines within the road/rail buffer
 * of the catchment, the station's own row, and the exact `rent_stats` row
 * `pickRentStat` chose in step 6). Keys with no known date are omitted
 * (`jsonb_strip_nulls`) rather than stored as an explicit `null`, since the
 * seed fixtures don't set `source_updated_at` anywhere yet — real imports
 * will. `green_spaces` is intentionally not added to this lookup here —
 * out of this task's scope (task-3-brief.md only asks for the five new
 * `norm_*` CASE blocks, the SET list, and assertColumnsPopulated).
 *
 * Depends on every earlier step: amenities, zoning, quietness, rent (for
 * the `source_dates` rent lookup), and green-space.
 */

import type { Pool } from "pg";

import { CATCHMENT_RADIUS_M, ROAD_RAIL_BUFFER_M } from "@tokyo/shared";

import { withTransaction } from "../lib/db.js";
import { assertColumnsPopulated, assertRentSourcePopulatedForRankableStations } from "./prerequisites.js";
import type { StepResult } from "./types.js";

export async function runNormalizationStep(pool: Pool): Promise<StepResult> {
  const start = Date.now();
  await assertColumnsPopulated(
    pool,
    [
      "amenity_supermarket_equiv",
      "restaurant_count",
      "cafe_count",
      "quietness_raw",
      "convenience_count",
      "cuisine_variety_count",
      "late_night_count",
      "health_count",
      "green_space_share",
    ],
    "normalization",
    "the full pipeline up through `--only=green-space`",
  );
  // rent_source is checked separately (not folded into the generic
  // assertColumnsPopulated call above): the source_dates rent lookup below
  // joins rent_stats on nm.rent_source / nm.rent_source_period, both
  // written by step 6, but rent.ts itself legitimately and permanently
  // leaves rent_source null for a station with no ward assignment or no
  // ward rent data — that's not "rent hasn't run yet", so it must not
  // block normalization. See assertRentSourcePopulatedForRankableStations's
  // own doc comment for why this needs its own scoped check.
  await assertRentSourcePopulatedForRankableStations(pool);

  const rowsWritten = await withTransaction(pool, async (client) => {
    const { rowCount } = await client.query(`
      WITH base AS (
        SELECT
          station_group_id,
          amenity_supermarket_equiv,
          (restaurant_count + cafe_count)::double precision AS restaurant_cafe_total,
          quietness_raw,
          convenience_count::double precision AS convenience_count,
          cuisine_variety_count::double precision AS cuisine_variety_count,
          green_space_share,
          late_night_count::double precision AS late_night_count,
          health_count::double precision AS health_count
        FROM neighborhood_metrics
      ),
      bounds AS (
        SELECT
          MIN(amenity_supermarket_equiv) AS min_amenity, MAX(amenity_supermarket_equiv) AS max_amenity,
          MIN(restaurant_cafe_total) AS min_rest, MAX(restaurant_cafe_total) AS max_rest,
          MIN(quietness_raw) AS min_quiet, MAX(quietness_raw) AS max_quiet,
          MIN(convenience_count) AS min_convenience, MAX(convenience_count) AS max_convenience,
          MIN(cuisine_variety_count) AS min_cuisine, MAX(cuisine_variety_count) AS max_cuisine,
          MIN(green_space_share) AS min_green, MAX(green_space_share) AS max_green,
          MIN(late_night_count) AS min_late_night, MAX(late_night_count) AS max_late_night,
          MIN(health_count) AS min_health, MAX(health_count) AS max_health
        FROM base
      ),
      normalized AS (
        SELECT
          b.station_group_id,
          CASE WHEN bd.max_amenity = bd.min_amenity THEN 50
            ELSE LEAST(100, GREATEST(0,
              (b.amenity_supermarket_equiv - bd.min_amenity) / (bd.max_amenity - bd.min_amenity) * 100))
          END AS norm_amenity_supermarket,
          CASE WHEN bd.max_rest = bd.min_rest THEN 50
            ELSE LEAST(100, GREATEST(0,
              (b.restaurant_cafe_total - bd.min_rest) / (bd.max_rest - bd.min_rest) * 100))
          END AS norm_amenity_restaurant,
          CASE WHEN bd.max_quiet = bd.min_quiet THEN 50
            ELSE LEAST(100, GREATEST(0,
              (b.quietness_raw - bd.min_quiet) / (bd.max_quiet - bd.min_quiet) * 100))
          END AS norm_quietness,
          CASE WHEN bd.max_convenience = bd.min_convenience THEN 50
            ELSE LEAST(100, GREATEST(0,
              (b.convenience_count - bd.min_convenience) / (bd.max_convenience - bd.min_convenience) * 100))
          END AS norm_amenity_convenience,
          CASE WHEN bd.max_cuisine = bd.min_cuisine THEN 50
            ELSE LEAST(100, GREATEST(0,
              (b.cuisine_variety_count - bd.min_cuisine) / (bd.max_cuisine - bd.min_cuisine) * 100))
          END AS norm_amenity_cuisine_variety,
          CASE WHEN bd.max_green = bd.min_green THEN 50
            ELSE LEAST(100, GREATEST(0,
              (b.green_space_share - bd.min_green) / (bd.max_green - bd.min_green) * 100))
          END AS norm_green_space,
          CASE WHEN bd.max_late_night = bd.min_late_night THEN 50
            ELSE LEAST(100, GREATEST(0,
              (b.late_night_count - bd.min_late_night) / (bd.max_late_night - bd.min_late_night) * 100))
          END AS norm_amenity_late_night,
          CASE WHEN bd.max_health = bd.min_health THEN 50
            ELSE LEAST(100, GREATEST(0,
              (b.health_count - bd.min_health) / (bd.max_health - bd.min_health) * 100))
          END AS norm_amenity_health
        FROM base b CROSS JOIN bounds bd
      )
      UPDATE neighborhood_metrics nm
      SET
        norm_amenity_supermarket = n.norm_amenity_supermarket,
        norm_amenity_restaurant = n.norm_amenity_restaurant,
        norm_quietness = n.norm_quietness,
        norm_amenity_convenience = n.norm_amenity_convenience,
        norm_amenity_cuisine_variety = n.norm_amenity_cuisine_variety,
        norm_green_space = n.norm_green_space,
        norm_amenity_late_night = n.norm_amenity_late_night,
        norm_amenity_health = n.norm_amenity_health
      FROM normalized n
      WHERE nm.station_group_id = n.station_group_id
    `);

    await client.query(
      `
      WITH src AS (
        SELECT
          sg.station_group_id,
          sg.source_updated_at AS sg_date,
          (SELECT MAX(p.source_updated_at) FROM pois p
             WHERE ST_DWithin(p.point::geography, sg.point::geography, $1)) AS pois_date,
          (SELECT MAX(za.source_updated_at) FROM zoning_areas za
             WHERE ST_Intersects(za.geom, sa.geom)) AS zoning_date,
          (SELECT MAX(mr.source_updated_at) FROM major_roads mr
             WHERE ST_DWithin(mr.geom::geography, sg.point::geography, $1 + $2)) AS road_date,
          (SELECT MAX(rl.source_updated_at) FROM rail_lines rl
             WHERE rl.geom IS NOT NULL
             AND ST_DWithin(rl.geom::geography, sg.point::geography, $1 + $2)) AS rail_date,
          (SELECT MAX(lp.source_updated_at) FROM land_prices lp
             WHERE lp.use_category = 'residential'
             AND ST_DWithin(lp.point::geography, sg.point::geography, $1)) AS land_price_date,
          (SELECT rs.source_updated_at FROM rent_stats rs
             WHERE rs.ward_code = sg.ward_code
             AND rs.source = nm.rent_source
             AND rs.period = nm.rent_source_period
             LIMIT 1) AS rent_date
        FROM station_groups sg
        JOIN station_areas sa ON sa.station_group_id = sg.station_group_id
        JOIN neighborhood_metrics nm ON nm.station_group_id = sg.station_group_id
      )
      UPDATE neighborhood_metrics nm2
      SET source_dates = jsonb_strip_nulls(jsonb_build_object(
        'station_groups', src.sg_date,
        'pois', src.pois_date,
        'zoning_areas', src.zoning_date,
        'major_roads', src.road_date,
        'rail_lines', src.rail_date,
        'land_prices', src.land_price_date,
        'rent_stats', src.rent_date
      ))
      FROM src
      WHERE nm2.station_group_id = src.station_group_id
      `,
      [CATCHMENT_RADIUS_M, ROAD_RAIL_BUFFER_M],
    );

    return rowCount ?? 0;
  });

  return { name: "normalization", rowsWritten, durationMs: Date.now() - start };
}

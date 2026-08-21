/**
 * Step 7 — normalization (and `source_dates`).
 *
 * Min-max normalizes across ALL station areas to 0-100:
 *   - `norm_amenity_supermarket` from `amenity_supermarket_equiv`
 *   - `norm_amenity_restaurant` from `restaurant_count + cafe_count`
 *   - `norm_flood_safety` from `flood_exposure_score`, INVERTED so a higher
 *     score means safer (min-max-normalizing then inverting, or inverting
 *     then min-max-normalizing, are algebraically identical here — this
 *     does the former: `100 - normalize(flood_exposure_score)`).
 *   - `norm_quietness` from `quietness_raw`
 *
 * Min-max edge case (mandated by the brief): when every station has the
 * same value on an axis (min == max), that axis's `norm_*` is exactly `50`
 * for every station rather than dividing by zero / producing `NaN`. Values
 * are additionally clamped to `[0, 100]` to absorb floating-point overshoot
 * at the exact min/max stations.
 *
 * `source_dates` records, per contributing source table, the freshest
 * `source_updated_at` among rows that plausibly fed that station's metrics
 * (POIs/land prices within the catchment radius, flood/zoning polygons
 * intersecting the catchment, roads/rail lines within the road/rail buffer
 * of the catchment, the station's own row, and the exact `rent_stats` row
 * `pickRentStat` chose in step 6). Keys with no known date are omitted
 * (`jsonb_strip_nulls`) rather than stored as an explicit `null`, since the
 * seed fixtures don't set `source_updated_at` anywhere yet — real imports
 * will.
 *
 * Depends on every earlier step: amenities (2), flood (3), zoning (4),
 * quietness (5), and rent (6, for the `source_dates` rent lookup).
 */

import type { Pool } from "pg";

import { CATCHMENT_RADIUS_M, ROAD_RAIL_BUFFER_M } from "@tokyo/shared";

import { withTransaction } from "../lib/db.js";
import { assertColumnsPopulated } from "./prerequisites.js";
import type { StepResult } from "./types.js";

export async function runNormalizationStep(pool: Pool): Promise<StepResult> {
  const start = Date.now();
  await assertColumnsPopulated(
    pool,
    [
      "amenity_supermarket_equiv",
      "restaurant_count",
      "cafe_count",
      "flood_exposure_score",
      "quietness_raw",
      // rent_source: the source_dates rent lookup below joins rent_stats
      // on nm.rent_source / nm.rent_source_period, both written by step 6.
      // Without this check, running --only=normalization before rent had
      // ever run would silently omit the "rent_stats" key from
      // source_dates (via jsonb_strip_nulls) instead of failing loudly.
      "rent_source",
    ],
    "normalization",
    "the full pipeline up through `--only=rent`",
  );

  const rowsWritten = await withTransaction(pool, async (client) => {
    const { rowCount } = await client.query(`
      WITH base AS (
        SELECT
          station_group_id,
          amenity_supermarket_equiv,
          (restaurant_count + cafe_count)::double precision AS restaurant_cafe_total,
          flood_exposure_score,
          quietness_raw
        FROM neighborhood_metrics
      ),
      bounds AS (
        SELECT
          MIN(amenity_supermarket_equiv) AS min_amenity, MAX(amenity_supermarket_equiv) AS max_amenity,
          MIN(restaurant_cafe_total) AS min_rest, MAX(restaurant_cafe_total) AS max_rest,
          MIN(flood_exposure_score) AS min_flood, MAX(flood_exposure_score) AS max_flood,
          MIN(quietness_raw) AS min_quiet, MAX(quietness_raw) AS max_quiet
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
          CASE WHEN bd.max_flood = bd.min_flood THEN 50
            ELSE LEAST(100, GREATEST(0,
              100 - (b.flood_exposure_score - bd.min_flood) / (bd.max_flood - bd.min_flood) * 100))
          END AS norm_flood_safety,
          CASE WHEN bd.max_quiet = bd.min_quiet THEN 50
            ELSE LEAST(100, GREATEST(0,
              (b.quietness_raw - bd.min_quiet) / (bd.max_quiet - bd.min_quiet) * 100))
          END AS norm_quietness
        FROM base b CROSS JOIN bounds bd
      )
      UPDATE neighborhood_metrics nm
      SET
        norm_amenity_supermarket = n.norm_amenity_supermarket,
        norm_amenity_restaurant = n.norm_amenity_restaurant,
        norm_flood_safety = n.norm_flood_safety,
        norm_quietness = n.norm_quietness
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
          (SELECT MAX(fz.source_updated_at) FROM flood_zones fz
             WHERE ST_Intersects(fz.geom, sa.geom)) AS flood_date,
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
        'flood_zones', src.flood_date,
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

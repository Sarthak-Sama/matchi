import type { Pool } from "pg";

import { CATCHMENT_RADIUS_M, ROAD_RAIL_BUFFER_M } from "@tokyo/shared";

import { withTransaction } from "../lib/db.js";
import {
  assertColumnsPopulated,
  assertRentSourcePopulatedForRankableStations,
} from "./prerequisites.js";
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

import type { Pool } from "pg";

import {
  AMENITY_WEIGHTS,
  CATCHMENT_RADIUS_M,
  computeLandPriceMultiplier,
  LIFESTYLE_SUFFICIENCY_TARGETS,
  LOCALITY_SAMPLE_COUNT,
  LOCALITY_STATION_LIMIT,
  LOCALITY_STATION_RADIUS_M,
  pickRentStat,
  QUIETNESS_WEIGHTS,
  ROAD_RAIL_BUFFER_M,
  WALK_DETOUR_FACTOR,
  WALK_SPEED_M_PER_MIN,
} from "@tokyo/shared";
import type { RentStatRow } from "@tokyo/shared";

import { withTransaction } from "../lib/db.js";
import type { StepResult } from "./types.js";

export function sufficiencyScore(value: number, target: number): number {
  return Math.min(100, (100 * Math.log1p(Math.max(0, value))) / Math.log1p(target));
}

export async function runLocalitiesStep(pool: Pool): Promise<StepResult> {
  const start = Date.now();
  const { rows: localityCountRows } = await pool.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM localities",
  );
  if (Number(localityCountRows[0]?.count ?? 0) === 0) {
    throw new Error(
      "derive/localities: no locality boundaries are imported. Run `pnpm data:prepare` and `pnpm import:localities` first.",
    );
  }
  const rowsWritten = await withTransaction(pool, async (client) => {
    await client.query("DELETE FROM locality_samples");
    await client.query(
      `WITH raw_areas AS (
        SELECT l.locality_id,
          COALESCE(
            NULLIF(ST_CollectionExtract(ST_MakeValid(ST_Intersection(l.geom, z.geom)), 3),
              ST_GeomFromText('MULTIPOLYGON EMPTY', 4326)),
            l.geom
          ) AS sample_geom,
          z.geom IS NOT NULL AND NOT ST_IsEmpty(z.geom) AS used_residential_zoning
        FROM localities l
        LEFT JOIN LATERAL (
          SELECT ST_UnaryUnion(ST_Collect(za.geom)) AS geom
          FROM zoning_areas za
          WHERE za.is_residential AND ST_Intersects(za.geom, l.geom)
        ) z ON true
      ), areas AS (
        -- e-Stat localities and residential intersections can be
        -- MultiPolygons. ST_GeneratePoints generates N points per polygon
        -- component, so sample the largest component to guarantee exactly
        -- nine representative points instead of 9*N rows.
        SELECT ra.locality_id, ra.used_residential_zoning, component.geom AS sample_geom
        FROM raw_areas ra
        CROSS JOIN LATERAL (
          SELECT dumped.geom
          FROM ST_Dump(ra.sample_geom) AS dumped
          WHERE GeometryType(dumped.geom) = 'POLYGON'
          ORDER BY ST_Area(dumped.geom::geography) DESC
          LIMIT 1
        ) component
      ), generated AS (
        SELECT locality_id, used_residential_zoning,
          ST_GeneratePoints(sample_geom, $1, 1 + (abs(hashtext(locality_id)::bigint) % 2147483646)::integer) AS points
        FROM areas
        WHERE NOT ST_IsEmpty(sample_geom)
      )
      INSERT INTO locality_samples (locality_id, sample_number, point, used_residential_zoning)
      SELECT locality_id, row_number() OVER (PARTITION BY locality_id ORDER BY (ST_X(point), ST_Y(point)))::smallint,
        point, used_residential_zoning
      FROM generated, LATERAL ST_DumpPoints(points) AS dump
      CROSS JOIN LATERAL (SELECT dump.geom::geometry(Point, 4326) AS point) p
    `,
      [LOCALITY_SAMPLE_COUNT],
    );

    await client.query(
      `INSERT INTO locality_sample_stations
        (locality_id, sample_number, station_group_id, walk_distance_m, walk_minutes, station_rank)
       SELECT locality_id, sample_number, station_group_id, distance_m,
         CEIL(distance_m * $1 / $2)::integer, station_rank
       FROM (
         SELECT ls.locality_id, ls.sample_number, sg.station_group_id,
           ST_Distance(ls.point::geography, sg.point::geography) AS distance_m,
           row_number() OVER (
             PARTITION BY ls.locality_id, ls.sample_number
             ORDER BY ls.point <-> sg.point, sg.station_group_id
           )::smallint AS station_rank
         FROM locality_samples ls
         JOIN station_groups sg ON ST_DWithin(ls.point::geography, sg.point::geography, $3)
       ) ranked
       WHERE station_rank <= $4`,
      [WALK_DETOUR_FACTOR, WALK_SPEED_M_PER_MIN, LOCALITY_STATION_RADIUS_M, LOCALITY_STATION_LIMIT],
    );

    const { rowCount } = await client.query(
      `WITH sample_catchments AS MATERIALIZED (
        SELECT ls.locality_id, ls.sample_number, ls.point,
          ST_Buffer(ls.point::geography, $1)::geometry AS geom,
          ST_Area(ST_Buffer(ls.point::geography, $1)::geometry::geography) AS area_sqm
        FROM locality_samples ls
      ), amenities AS MATERIALIZED (
        SELECT sc.locality_id, sc.sample_number,
          COALESCE(SUM((p.category = 'supermarket')::int), 0)::double precision AS supermarkets,
          COALESCE(SUM((p.category = 'grocery')::int), 0)::double precision AS groceries,
          COALESCE(SUM((p.category = 'convenience')::int), 0)::double precision AS convenience,
          COALESCE(SUM((p.category = 'restaurant')::int), 0)::double precision AS restaurants,
          COALESCE(SUM((p.category = 'cafe')::int), 0)::double precision AS cafes,
          COALESCE(SUM((p.category = 'bar')::int), 0)::double precision AS nightlife,
          COALESCE(SUM((p.category = 'health')::int), 0)::double precision AS health,
          COALESCE(SUM((p.category IN ('restaurant', 'cafe', 'bar')
            AND p.opening_hours IS NOT NULL AND p.opening_hours !~* '\\yoff\\y'
            AND (p.opening_hours = '24/7' OR p.opening_hours ~ '-2[3-9]:[0-5][0-9]'))::int), 0)::double precision AS late_night,
          COUNT(DISTINCT p.cuisine) FILTER (WHERE p.category IN ('restaurant', 'cafe'))::double precision AS cuisine
        FROM sample_catchments sc
        LEFT JOIN pois p ON ST_DWithin(p.point::geography, sc.point::geography, $1)
        GROUP BY sc.locality_id, sc.sample_number
      ), residential_union AS MATERIALIZED (
        SELECT ST_UnaryUnion(ST_Collect(ST_CollectionExtract(ST_MakeValid(geom), 3))) AS geom
        FROM zoning_areas WHERE is_residential
      ), road_rail_union AS MATERIALIZED (
        SELECT ST_UnaryUnion(ST_Collect(buffered.geom)) AS geom
        FROM (
          SELECT ST_Buffer(geom::geography, $2)::geometry AS geom FROM major_roads
          UNION ALL
          SELECT ST_Buffer(geom::geography, $2)::geometry AS geom FROM rail_lines WHERE geom IS NOT NULL
        ) buffered
      ), green_union AS MATERIALIZED (
        SELECT ST_UnaryUnion(ST_Collect(ST_CollectionExtract(ST_MakeValid(geom), 3))) AS geom
        FROM green_spaces
      ), area_metrics AS MATERIALIZED (
        SELECT sc.locality_id, sc.sample_number,
          CASE WHEN ru.geom IS NOT NULL AND ST_Intersects(sc.geom, ru.geom)
            THEN LEAST(1, GREATEST(0, ST_Area(ST_Intersection(sc.geom, ru.geom)::geography) / sc.area_sqm))
            ELSE 0 END AS residential_share,
          CASE WHEN rr.geom IS NOT NULL AND ST_Intersects(sc.geom, rr.geom)
            THEN LEAST(1, GREATEST(0, ST_Area(ST_Intersection(sc.geom, rr.geom)::geography) / sc.area_sqm))
            ELSE 0 END AS road_rail_share,
          CASE WHEN gu.geom IS NOT NULL AND ST_Intersects(sc.geom, gu.geom)
            THEN LEAST(1, GREATEST(0, ST_Area(ST_Intersection(sc.geom, gu.geom)::geography) / sc.area_sqm))
            ELSE 0 END AS green_share
        FROM sample_catchments sc
        CROSS JOIN residential_union ru CROSS JOIN road_rail_union rr CROSS JOIN green_union gu
      ), per_sample AS (
        SELECT a.locality_id, a.sample_number,
          a.supermarkets * $3::double precision + a.groceries * $4::double precision
            + a.convenience * $5::double precision AS supermarket_equiv,
          a.restaurants, a.cafes, a.convenience, a.cuisine, a.late_night, a.health,
          am.green_share,
          100 * (
            $6::double precision * am.residential_share
            + $7::double precision * (1 - am.road_rail_share)
            + $8::double precision * (1 - LEAST(1,
              ln(1 + a.nightlife) / ln(1 + $16::double precision)))
          ) AS quietness
        FROM amenities a
        JOIN area_metrics am USING (locality_id, sample_number)
      ), medians AS (
        SELECT locality_id,
          percentile_cont(0.5) WITHIN GROUP (ORDER BY supermarket_equiv) AS supermarket_equiv,
          percentile_cont(0.5) WITHIN GROUP (ORDER BY restaurants) AS restaurants,
          percentile_cont(0.5) WITHIN GROUP (ORDER BY cafes) AS cafes,
          percentile_cont(0.5) WITHIN GROUP (ORDER BY restaurants + cafes) AS restaurant_cafe_total,
          percentile_cont(0.5) WITHIN GROUP (ORDER BY convenience) AS convenience,
          percentile_cont(0.5) WITHIN GROUP (ORDER BY cuisine) AS cuisine,
          percentile_cont(0.5) WITHIN GROUP (ORDER BY late_night) AS late_night,
          percentile_cont(0.5) WITHIN GROUP (ORDER BY health) AS health,
          percentile_cont(0.5) WITHIN GROUP (ORDER BY green_share) AS green_share,
          percentile_cont(0.5) WITHIN GROUP (ORDER BY quietness) AS quietness
        FROM per_sample GROUP BY locality_id
      ), source_vintage AS (
        SELECT jsonb_strip_nulls(jsonb_build_object(
          'pois', (SELECT max(source_updated_at) FROM pois),
          'zoning_areas', (SELECT max(source_updated_at) FROM zoning_areas),
          'green_spaces', (SELECT max(source_updated_at) FROM green_spaces),
          'major_roads', (SELECT max(source_updated_at) FROM major_roads),
          'rail_lines', (SELECT max(source_updated_at) FROM rail_lines)
        )) AS dates
      )
      INSERT INTO locality_metrics (
        locality_id, supermarket_count, restaurant_count, cafe_count, convenience_count, cuisine_variety_count,
        late_night_count, health_count, green_space_share, norm_amenity_supermarket, norm_amenity_restaurant,
        norm_amenity_convenience, norm_amenity_cuisine_variety, norm_amenity_late_night, norm_amenity_health,
        norm_green_space, norm_quietness, source_dates, derived_at
      )
      SELECT locality_id, round(supermarket_equiv)::integer, round(restaurants)::integer, round(cafes)::integer, round(convenience)::integer,
        round(cuisine)::integer, round(late_night)::integer, round(health)::integer, green_share,
        LEAST(100, 100 * ln(1 + supermarket_equiv) / ln(1 + $9::double precision)),
        LEAST(100, 100 * ln(1 + restaurant_cafe_total) / ln(1 + $10::double precision)),
        LEAST(100, 100 * ln(1 + convenience) / ln(1 + $11::double precision)),
        LEAST(100, 100 * ln(1 + cuisine) / ln(1 + $12::double precision)),
        LEAST(100, 100 * ln(1 + late_night) / ln(1 + $13::double precision)),
        LEAST(100, 100 * ln(1 + health) / ln(1 + $14::double precision)),
        LEAST(100, 100 * ln(1 + green_share) / ln(1 + $15::double precision)),
        quietness, sv.dates, now()
      FROM medians CROSS JOIN source_vintage sv
      ON CONFLICT (locality_id) DO UPDATE SET
        supermarket_count = EXCLUDED.supermarket_count, restaurant_count = EXCLUDED.restaurant_count,
        cafe_count = EXCLUDED.cafe_count, convenience_count = EXCLUDED.convenience_count,
        cuisine_variety_count = EXCLUDED.cuisine_variety_count, late_night_count = EXCLUDED.late_night_count,
        health_count = EXCLUDED.health_count, green_space_share = EXCLUDED.green_space_share,
        norm_amenity_supermarket = EXCLUDED.norm_amenity_supermarket,
        norm_amenity_restaurant = EXCLUDED.norm_amenity_restaurant,
        norm_amenity_convenience = EXCLUDED.norm_amenity_convenience,
        norm_amenity_cuisine_variety = EXCLUDED.norm_amenity_cuisine_variety,
        norm_amenity_late_night = EXCLUDED.norm_amenity_late_night,
        norm_amenity_health = EXCLUDED.norm_amenity_health, norm_green_space = EXCLUDED.norm_green_space,
        norm_quietness = EXCLUDED.norm_quietness,
        source_dates = EXCLUDED.source_dates,
        derived_at = EXCLUDED.derived_at`,
      [
        CATCHMENT_RADIUS_M,
        ROAD_RAIL_BUFFER_M,
        AMENITY_WEIGHTS.supermarket,
        AMENITY_WEIGHTS.grocery,
        AMENITY_WEIGHTS.convenience,
        QUIETNESS_WEIGHTS.residentialZoningShare,
        QUIETNESS_WEIGHTS.inverseRoadRailExposure,
        QUIETNESS_WEIGHTS.inverseNightlifeDensity,
        LIFESTYLE_SUFFICIENCY_TARGETS.supermarketEquivalent,
        LIFESTYLE_SUFFICIENCY_TARGETS.restaurantsAndCafes,
        LIFESTYLE_SUFFICIENCY_TARGETS.convenience,
        LIFESTYLE_SUFFICIENCY_TARGETS.cuisineTypes,
        LIFESTYLE_SUFFICIENCY_TARGETS.lateNight,
        LIFESTYLE_SUFFICIENCY_TARGETS.health,
        LIFESTYLE_SUFFICIENCY_TARGETS.greenSpaceShare,
        LIFESTYLE_SUFFICIENCY_TARGETS.nightlifeForQuietness,
      ],
    );

    const land = await client.query<{
      locality_id: string;
      ward_code: string;
      median: string | null;
      count: string;
    }>(
      `
      WITH per_sample AS (
        SELECT ls.locality_id, ls.sample_number,
          percentile_cont(0.5) WITHIN GROUP (ORDER BY lp.price_yen_per_sqm) AS median,
          count(lp.id) AS point_count
        FROM locality_samples ls
        LEFT JOIN land_prices lp ON lp.use_category = 'residential'
          AND ST_DWithin(lp.point::geography, ls.point::geography, $1)
        GROUP BY ls.locality_id, ls.sample_number
      )
      SELECT ps.locality_id, l.ward_code,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY ps.median)::text AS median,
        round(percentile_cont(0.5) WITHIN GROUP (ORDER BY ps.point_count))::text AS count
      FROM per_sample ps JOIN localities l ON l.locality_id=ps.locality_id
      GROUP BY ps.locality_id, l.ward_code`,
      [CATCHMENT_RADIUS_M],
    );
    const wardLand = await client.query<{ ward_code: string; median: string | null }>(`
      SELECT ward_code, percentile_cont(0.5) WITHIN GROUP (ORDER BY price_yen_per_sqm)::text AS median
      FROM land_prices WHERE use_category = 'residential' GROUP BY ward_code`);
    const rentStats = await client.query<RentStatRow & { ward_code: string }>(
      "SELECT ward_code, period, source, rent_per_sqm_yen, management_fee_yen FROM rent_stats",
    );

    const wardMedianLandPriceByCode = new Map(
      wardLand.rows.map((row) => [row.ward_code, row.median === null ? null : Number(row.median)]),
    );
    const rentStatsByWardCode = new Map<string, (RentStatRow & { ward_code: string })[]>();
    for (const row of rentStats.rows) {
      const existing = rentStatsByWardCode.get(row.ward_code) ?? [];
      rentStatsByWardCode.set(row.ward_code, [...existing, row]);
    }

    for (const row of land.rows) {
      const choices = rentStatsByWardCode.get(row.ward_code);
      if (!choices?.length) continue;

      const selected = pickRentStat(choices, { currentYear: new Date().getFullYear() }).stat;
      const multiplier = computeLandPriceMultiplier({
        catchmentMedianLandPrice: row.median === null ? null : Number(row.median),
        wardMedianLandPrice: wardMedianLandPriceByCode.get(row.ward_code) ?? null,
        pointCount: Number(row.count),
      });

      await client.query(
        `UPDATE locality_metrics SET
           rent_per_sqm_yen=$2, management_fee_yen=$3, land_price_multiplier=$4,
           land_price_point_count=$5, land_price_used_fallback=$6, rent_source=$7, rent_source_period=$8
         WHERE locality_id=$1`,
        [
          row.locality_id,
          selected.rent_per_sqm_yen,
          selected.management_fee_yen,
          multiplier.multiplier,
          Number(row.count),
          multiplier.usedFallback,
          selected.source,
          selected.period,
        ],
      );
    }
    return rowCount ?? 0;
  });
  return { name: "localities", rowsWritten, durationMs: Date.now() - start };
}

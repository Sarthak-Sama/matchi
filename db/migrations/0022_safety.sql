-- Safety data (plan D10): earthquake risk rank, flood exposure and crime per
-- locality, loaded by `pnpm import:safety`. The view gains the raw columns, a
-- combined safety_score, and the nearest station (plan UX 6).

CREATE TABLE locality_safety (
  locality_id text PRIMARY KEY REFERENCES localities(locality_id) ON DELETE CASCADE,
  quake_rank smallint CHECK (quake_rank BETWEEN 1 AND 5),
  fire_rank smallint CHECK (fire_rank BETWEEN 1 AND 5),
  flood_share real CHECK (flood_share BETWEEN 0 AND 1),
  crime_per_1k real CHECK (crime_per_1k >= 0),
  sources jsonb NOT NULL DEFAULT '{}'::jsonb
);

COMMENT ON TABLE locality_safety IS
  'Hazard and crime measures per locality. A null column means the source had no matching row for the locality, not zero risk. sources records each source''s release and the collapse rank.';
COMMENT ON COLUMN locality_safety.quake_rank IS
  'Tokyo Metropolitan Government earthquake risk survey, 9th round, combined risk rank 1 (safest) to 5. Rounded mean over the locality''s chome.';
COMMENT ON COLUMN locality_safety.fire_rank IS
  'Same survey, fire risk rank 1 to 5. Rounded mean over the locality''s chome.';
COMMENT ON COLUMN locality_safety.flood_share IS
  'Share (0 to 1) of the locality area inside the MLIT A31a maximum-scale flood inundation zones with depth of 0.5 m or more.';
COMMENT ON COLUMN locality_safety.crime_per_1k IS
  'Reported criminal offences in the year per 1,000 residents (Metropolitan Police Department counts, localities.population). Inflated where few people live, such as business districts.';

CREATE OR REPLACE VIEW :"agent_schema".area_features AS
SELECT
  l.locality_id, l.name_en, l.name_ja, l.ward_code,
  w.name_en AS ward_name_en, w.name_ja AS ward_name_ja,
  ST_Y(l.centroid) AS lat, ST_X(l.centroid) AS lon,
  lm.rent_per_sqm_yen, lm.management_fee_yen, lm.land_price_multiplier,
  lm.land_price_used_fallback, lm.rent_source, lm.rent_source_period,
  lm.supermarket_count, lm.restaurant_count, lm.cafe_count, lm.convenience_count,
  lm.cuisine_variety_count, lm.late_night_count, lm.health_count, lm.green_space_share,
  lm.land_value_yen_per_sqm, lm.land_value_nearest_m,
  lm.rent_local_multiplier, lm.rent_per_sqm_local_yen,
  lm.residential_zoning_share, lm.road_rail_exposure_share, lm.bar_count, lm.quietness_raw,
  la.centrality_minutes,
  (la.hub_minutes ->> 'shinjuku')::double precision AS min_to_shinjuku,
  (la.hub_minutes ->> 'shibuya')::double precision AS min_to_shibuya,
  (la.hub_minutes ->> 'ikebukuro')::double precision AS min_to_ikebukuro,
  (la.hub_minutes ->> 'tokyo')::double precision AS min_to_tokyo,
  (la.hub_minutes ->> 'shinagawa')::double precision AS min_to_shinagawa,
  (la.hub_minutes ->> 'ueno')::double precision AS min_to_ueno,
  (la.hub_minutes ->> 'otemachi')::double precision AS min_to_otemachi,
  (la.hub_minutes ->> 'roppongi')::double precision AS min_to_roppongi,
  la.line_count, la.direct_reach_stations, la.stations_within_30_min,
  la.nearest_station_walk_min, la.confidence AS access_confidence,
  lm.reach_restaurant, lm.reach_cuisine_variety, lm.reach_late_night, lm.reach_green,
  l.population, l.households, l.area_sqm,
  lm.population_density_per_km2, lm.persons_per_household,
  -- 0022
  ls.quake_rank, ls.fire_rank, ls.flood_share, ls.crime_per_1k,
  1 - (
    SELECT avg(part)
    FROM unnest(ARRAY[ls.quake_rank / 5.0, ls.flood_share, cp.crime_percentile]::double precision[]) AS part
  ) AS safety_score,
  ns.name_ja AS nearest_station_name_ja,
  ns.name_en AS nearest_station_name_en,
  rs.market_refs AS rent_market_refs
FROM localities l
JOIN locality_metrics lm USING (locality_id)
JOIN wards w ON w.ward_code = l.ward_code
LEFT JOIN locality_access la ON la.locality_id = l.locality_id
LEFT JOIN locality_safety ls ON ls.locality_id = l.locality_id
LEFT JOIN (
  SELECT locality_id, percent_rank() OVER (ORDER BY crime_per_1k) AS crime_percentile
  FROM locality_safety
  WHERE crime_per_1k IS NOT NULL
) cp ON cp.locality_id = l.locality_id
LEFT JOIN LATERAL (
  SELECT sg.name_ja, sg.name_en
  FROM locality_sample_stations lss
  JOIN station_groups sg USING (station_group_id)
  WHERE lss.locality_id = l.locality_id
  ORDER BY lss.walk_distance_m, sg.station_group_id
  LIMIT 1
) ns ON true
LEFT JOIN rent_stats rs
  ON rs.ward_code = l.ward_code AND rs.source = lm.rent_source AND rs.period = lm.rent_source_period;

COMMENT ON COLUMN :"agent_schema".area_features.quake_rank IS 'Earthquake risk rank 1 (safest) to 5, Tokyo Metropolitan Government survey, 9th round, combined collapse, fire and evacuation difficulty. Null when the survey has no matching row.';
COMMENT ON COLUMN :"agent_schema".area_features.fire_rank IS 'Fire risk rank 1 (safest) to 5 from the same survey. Null when the survey has no matching row.';
COMMENT ON COLUMN :"agent_schema".area_features.flood_share IS 'Share of the locality area (0 to 1) flooded to 0.5 m or deeper in the maximum-scale river flood scenario, MLIT A31a. Null when the source was not imported.';
COMMENT ON COLUMN :"agent_schema".area_features.crime_per_1k IS 'Reported offences in the latest full year per 1,000 residents, Metropolitan Police Department. Inflated in business districts where few people live. Null when there is no match or no residents.';
COMMENT ON COLUMN :"agent_schema".area_features.safety_score IS '1 minus the mean of quake_rank / 5, flood_share and the crime_per_1k percentile among localities. Higher is safer. Parts with no data are left out of the mean; null when there is none.';
COMMENT ON COLUMN :"agent_schema".area_features.nearest_station_name_ja IS 'Station group nearest on foot to any of the locality''s sample points, Japanese name.';
COMMENT ON COLUMN :"agent_schema".area_features.nearest_station_name_en IS 'Same station, English name.';
COMMENT ON COLUMN :"agent_schema".area_features.rent_market_refs IS 'Listing reference rents behind the ward rent adjustment (rent_stats.market_refs). 0 means the ward uses the city-wide factor.';

SELECT grant_agent_read_access();

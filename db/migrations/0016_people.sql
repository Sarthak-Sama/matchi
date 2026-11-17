-- People data (plan E1, E2) from the 2020 census boundary file that
-- import:localities already reads. Station footfall (E3) waits for the ODPT
-- and MLIT credentials and is not in this migration.

ALTER TABLE localities
  ADD COLUMN population integer,
  ADD COLUMN households integer,
  ADD COLUMN area_sqm double precision;

COMMENT ON COLUMN localities.population IS 'Sum of JINKO over the census polygons merged into this locality. 2020 census.';
COMMENT ON COLUMN localities.households IS 'Sum of SETAI over the census polygons merged into this locality. 2020 census.';
COMMENT ON COLUMN localities.area_sqm IS 'Sum of AREA over those census polygons, m2 (before clipping to the ward boundary).';

ALTER TABLE locality_metrics
  ADD COLUMN population_density_per_km2 double precision,
  ADD COLUMN persons_per_household double precision;

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
  -- 0016
  l.population, l.households, l.area_sqm,
  lm.population_density_per_km2, lm.persons_per_household
FROM localities l
JOIN locality_metrics lm USING (locality_id)
JOIN wards w ON w.ward_code = l.ward_code
LEFT JOIN locality_access la ON la.locality_id = l.locality_id;

COMMENT ON COLUMN :"agent_schema".area_features.population IS 'Residents, 2020 census (JINKO). Source: e-Stat census boundary data.';
COMMENT ON COLUMN :"agent_schema".area_features.households IS 'Households, 2020 census (SETAI). Source: e-Stat census boundary data.';
COMMENT ON COLUMN :"agent_schema".area_features.area_sqm IS 'Land area of the locality''s census polygons, m2, 2020 census.';
COMMENT ON COLUMN :"agent_schema".area_features.population_density_per_km2 IS 'population / area, residents per km2. Low values in business districts mean few residents, not few people.';
COMMENT ON COLUMN :"agent_schema".area_features.persons_per_household IS 'population / households. Lower values mean more single-person homes, higher values more family homes; compare against other localities rather than a fixed threshold. Null when households is 0.';

SELECT grant_agent_read_access();

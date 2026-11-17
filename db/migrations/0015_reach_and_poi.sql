-- Reachability-weighted amenities (plan D3) and an on-demand POI count for
-- the agent (D4).

ALTER TABLE locality_metrics
  ADD COLUMN reach_restaurant double precision,
  ADD COLUMN reach_cuisine_variety double precision,
  ADD COLUMN reach_late_night double precision,
  ADD COLUMN reach_green double precision;

-- cuisine holds free text such as 'ramen;japanese', so the function matches
-- with ILIKE '%...%'; a trigram index serves that, a btree would not.
CREATE INDEX pois_cuisine_trgm_idx ON pois USING gin (cuisine gin_trgm_ops);

-- SECURITY DEFINER so the read-only role can count public.pois without a
-- grant on it; search_path is pinned to the schema the migration ran in.
CREATE FUNCTION :"agent_schema".locality_poi_count(
  p_category text,
  p_cuisine text DEFAULT NULL,
  p_radius_m int DEFAULT 800
) RETURNS TABLE (locality_id text, poi_count double precision)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path FROM CURRENT
AS $$
  SELECT ls.locality_id,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY c.n)
  FROM locality_samples ls
  CROSS JOIN LATERAL (
    SELECT count(*) AS n
    FROM pois p
    WHERE p.category = p_category
      AND (p_cuisine IS NULL OR p.cuisine ILIKE '%' || p_cuisine || '%')
      AND ST_DWithin(p.point::geography, ls.point::geography, LEAST(GREATEST(p_radius_m, 50), 2000))
  ) c
  GROUP BY ls.locality_id
$$;

REVOKE ALL ON FUNCTION :"agent_schema".locality_poi_count(text, text, int) FROM PUBLIC;

COMMENT ON FUNCTION :"agent_schema".locality_poi_count(text, text, int) IS
  'Places of one category (supermarket, grocery, convenience, restaurant, cafe, bar, health, landmark) within p_radius_m (clamped to 50 to 2000) of each locality: median over its 9 sample points. p_cuisine matches the OpenStreetMap cuisine tag by substring, e.g. ramen. Source: OpenStreetMap; most places have no cuisine tag.';

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
  -- 0015
  lm.reach_restaurant, lm.reach_cuisine_variety, lm.reach_late_night, lm.reach_green
FROM localities l
JOIN locality_metrics lm USING (locality_id)
JOIN wards w ON w.ward_code = l.ward_code
LEFT JOIN locality_access la ON la.locality_id = l.locality_id;

COMMENT ON COLUMN :"agent_schema".area_features.reach_restaurant IS 'Restaurants and cafes reachable by rail, discounted by time: sum over stations of the station''s 800 m count * exp(-offpeak door-to-station minutes / reach_decay_minutes). An index, not a head count: overlapping station catchments count twice. Does not saturate, so central areas stay distinguishable.';
COMMENT ON COLUMN :"agent_schema".area_features.reach_cuisine_variety IS 'Same weighting as reach_restaurant applied to each station''s distinct cuisine count. An index, not a distinct count.';
COMMENT ON COLUMN :"agent_schema".area_features.reach_late_night IS 'Same weighting as reach_restaurant applied to each station''s late-night venue count.';
COMMENT ON COLUMN :"agent_schema".area_features.reach_green IS 'Same weighting as reach_restaurant applied to each station''s green space share (0 to 1). Units: station-equivalents of full green cover.';

SELECT grant_agent_read_access();

-- Local land value for every locality (plan B1) and the locality rent estimate
-- built on it with the fitted elasticity (B2). Existing rent_per_sqm_yen and
-- land_price_multiplier keep their meaning; /v1/optimize still reads those.

ALTER TABLE locality_metrics
  ADD COLUMN land_value_yen_per_sqm double precision,
  ADD COLUMN land_value_nearest_m double precision,
  ADD COLUMN rent_local_multiplier double precision,
  ADD COLUMN rent_per_sqm_local_yen double precision;

COMMENT ON COLUMN locality_metrics.land_value_yen_per_sqm IS
  'Inverse-distance-weighted mean of the 5 nearest residential land price points to the centroid, yen per m2.';
COMMENT ON COLUMN locality_metrics.land_value_nearest_m IS
  'Distance from the centroid to the nearest of those points, metres.';
COMMENT ON COLUMN locality_metrics.rent_local_multiplier IS
  '(land_value / ward median land_value) ^ model_params.rent_land_elasticity, clamped by model_params.rent_local_multiplier_min/max.';
COMMENT ON COLUMN locality_metrics.rent_per_sqm_local_yen IS
  'rent_per_sqm_yen * rent_local_multiplier.';

CREATE OR REPLACE VIEW :"agent_schema".area_features AS
SELECT
  l.locality_id, l.name_en, l.name_ja, l.ward_code,
  w.name_en AS ward_name_en, w.name_ja AS ward_name_ja,
  ST_Y(l.centroid) AS lat, ST_X(l.centroid) AS lon,
  lm.rent_per_sqm_yen, lm.management_fee_yen, lm.land_price_multiplier,
  lm.land_price_used_fallback, lm.rent_source, lm.rent_source_period,
  lm.supermarket_count, lm.restaurant_count, lm.cafe_count, lm.convenience_count,
  lm.cuisine_variety_count, lm.late_night_count, lm.health_count, lm.green_space_share,
  -- 0012
  lm.land_value_yen_per_sqm, lm.land_value_nearest_m,
  lm.rent_local_multiplier, lm.rent_per_sqm_local_yen
FROM localities l
JOIN locality_metrics lm USING (locality_id)
JOIN wards w ON w.ward_code = l.ward_code;

COMMENT ON COLUMN :"agent_schema".area_features.land_value_yen_per_sqm IS 'Local residential land value, yen per m2: inverse-distance-weighted mean of the 5 nearest residential land price points. Source: MLIT official land prices (L01). Confidence falls as land_value_nearest_m grows.';
COMMENT ON COLUMN :"agent_schema".area_features.land_value_nearest_m IS 'Distance from the locality centroid to the nearest land price point used, metres. Over about 1000 m means land_value is mostly borrowed from neighbouring areas.';
COMMENT ON COLUMN :"agent_schema".area_features.rent_local_multiplier IS 'Locality rent relative to its ward average: (land value / ward median land value) ^ elasticity, clamped. Elasticity and clamp are in model_params (rent_land_elasticity, rent_local_multiplier_min/max). Ratio. Low confidence: the elasticity is fitted on 23 wards.';
COMMENT ON COLUMN :"agent_schema".area_features.rent_per_sqm_local_yen IS 'Modelled locality rent per m2 per month, yen: rent_per_sqm_yen * rent_local_multiplier. Ward-anchored model; no source publishes rent per town.';

SELECT grant_agent_read_access();

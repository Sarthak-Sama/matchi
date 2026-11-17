-- Quietness parts (plan D1). The localities derive step already computed
-- these per sample and blended them into norm_quietness; now the medians are
-- kept so the engine can weigh quiet against lively per person.

ALTER TABLE locality_metrics
  ADD COLUMN residential_zoning_share double precision,
  ADD COLUMN road_rail_exposure_share double precision,
  ADD COLUMN bar_count integer,
  ADD COLUMN quietness_raw double precision;

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
  -- 0013
  lm.residential_zoning_share, lm.road_rail_exposure_share, lm.bar_count, lm.quietness_raw
FROM localities l
JOIN locality_metrics lm USING (locality_id)
JOIN wards w ON w.ward_code = l.ward_code;

COMMENT ON COLUMN :"agent_schema".area_features.residential_zoning_share IS 'Share of the 800 m catchment zoned residential, 0 to 1. Source: MLIT zoning (A55).';
COMMENT ON COLUMN :"agent_schema".area_features.road_rail_exposure_share IS 'Share of the 800 m catchment within 100 m of a major road or rail line, 0 to 1. Higher is noisier. Source: OpenStreetMap roads, MLIT rail lines.';
COMMENT ON COLUMN :"agent_schema".area_features.bar_count IS 'Bars, pubs and nightclubs within 800 m. Count. Source: OpenStreetMap. Positive signal for a lively preference, negative for a quiet one.';
COMMENT ON COLUMN :"agent_schema".area_features.quietness_raw IS 'The fixed quietness blend used by /v1/optimize, 0 to 1: 0.5 residential share + 0.3 (1 - road/rail exposure) + 0.2 (1 - capped bar density). Prefer the three parts when a preference is not plain quiet.';

SELECT grant_agent_read_access();

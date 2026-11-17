-- Agent-facing layer (plan workstream F): one flat, documented, read-only
-- surface in its own schema. :"agent_schema" is substituted by migrate.ts
-- ("agent" by default); tests redirect it to a scratch schema.
--
-- The matchi_agent_ro role is created outside migrations (`pnpm
-- db:agent-role`) so its password never enters the repo. This file only
-- defines grant_agent_read_access(), which every later migration calls and
-- which does nothing until the role exists.

CREATE SCHEMA IF NOT EXISTS :"agent_schema";

-- ---------------------------------------------------------------------------
-- model_params — fitted or chosen constants the engine and the agent read.
-- ---------------------------------------------------------------------------
CREATE TABLE model_params (
  key text PRIMARY KEY,
  value double precision NOT NULL,
  unit text NOT NULL,
  fitted_at timestamptz,
  sample_size integer,
  notes text NOT NULL DEFAULT ''
);

COMMENT ON TABLE model_params IS
  'Constants the engine and the agent can quote. fitted_at is null for chosen (not fitted) values.';

INSERT INTO model_params (key, value, unit, notes) VALUES
  ('reach_decay_minutes', 10, 'minutes',
   'Decay constant for reach_* amenity columns: weight = exp(-minutes / value). Starting value, not fitted.'),
  ('rent_local_multiplier_min', 0.85, 'ratio',
   'Lower clamp on rent_local_multiplier. Chosen, not fitted; same as the original land_price_multiplier clamp.'),
  ('rent_local_multiplier_max', 1.15, 'ratio',
   'Upper clamp on rent_local_multiplier. Chosen, not fitted; same as the original land_price_multiplier clamp.')
ON CONFLICT (key) DO NOTHING;

CREATE FUNCTION grant_agent_read_access() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'matchi_agent_ro') THEN
    RETURN;
  END IF;
  GRANT USAGE ON SCHEMA :"agent_schema" TO matchi_agent_ro;
  GRANT SELECT ON ALL TABLES IN SCHEMA :"agent_schema" TO matchi_agent_ro;
  GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA :"agent_schema" TO matchi_agent_ro;
END;
$$;

COMMENT ON FUNCTION grant_agent_read_access() IS
  'Grants matchi_agent_ro read access to every object in the agent schema. No-op when the role does not exist.';

-- ---------------------------------------------------------------------------
-- agent.model_params
-- ---------------------------------------------------------------------------
CREATE VIEW :"agent_schema".model_params AS
SELECT key, value, unit, fitted_at, sample_size, notes FROM model_params;

COMMENT ON VIEW :"agent_schema".model_params IS
  'Model constants with their fit date and sample size. Quote these rather than assuming values.';
COMMENT ON COLUMN :"agent_schema".model_params.key IS 'Parameter name.';
COMMENT ON COLUMN :"agent_schema".model_params.value IS 'Parameter value, in unit.';
COMMENT ON COLUMN :"agent_schema".model_params.unit IS 'Unit of value.';
COMMENT ON COLUMN :"agent_schema".model_params.fitted_at IS 'When the value was fitted; null when it was chosen by hand.';
COMMENT ON COLUMN :"agent_schema".model_params.sample_size IS 'Observations behind the fit; null when chosen by hand.';
COMMENT ON COLUMN :"agent_schema".model_params.notes IS 'How the value was obtained and what it is used for.';

-- ---------------------------------------------------------------------------
-- agent.data_vintages — latest successful run per import source.
-- ---------------------------------------------------------------------------
CREATE VIEW :"agent_schema".data_vintages AS
SELECT DISTINCT ON (source)
  source, source_updated_at, finished_at AS imported_at, rows_imported
FROM import_runs
WHERE status = 'success'
ORDER BY source, started_at DESC;

COMMENT ON VIEW :"agent_schema".data_vintages IS
  'How old each imported source is: the latest successful import per source.';
COMMENT ON COLUMN :"agent_schema".data_vintages.source IS 'Import source name, e.g. mlit, estat, openstreetmap.';
COMMENT ON COLUMN :"agent_schema".data_vintages.source_updated_at IS 'Publication or snapshot date of the source data itself.';
COMMENT ON COLUMN :"agent_schema".data_vintages.imported_at IS 'When the import into this database finished.';
COMMENT ON COLUMN :"agent_schema".data_vintages.rows_imported IS 'Rows written by that import.';

-- ---------------------------------------------------------------------------
-- agent.area_features v1 — one row per locality, no geometry.
-- Later migrations append columns with CREATE OR REPLACE VIEW, which keeps
-- these column comments and the grants.
-- ---------------------------------------------------------------------------
CREATE VIEW :"agent_schema".area_features AS
SELECT
  l.locality_id,
  l.name_en,
  l.name_ja,
  l.ward_code,
  w.name_en AS ward_name_en,
  w.name_ja AS ward_name_ja,
  ST_Y(l.centroid) AS lat,
  ST_X(l.centroid) AS lon,
  lm.rent_per_sqm_yen,
  lm.management_fee_yen,
  lm.land_price_multiplier,
  lm.land_price_used_fallback,
  lm.rent_source,
  lm.rent_source_period,
  lm.supermarket_count,
  lm.restaurant_count,
  lm.cafe_count,
  lm.convenience_count,
  lm.cuisine_variety_count,
  lm.late_night_count,
  lm.health_count,
  lm.green_space_share
FROM localities l
JOIN locality_metrics lm USING (locality_id)
JOIN wards w ON w.ward_code = l.ward_code;

COMMENT ON VIEW :"agent_schema".area_features IS
  'One row per locality (town, chome combined) in the 23 wards. Counts are medians over 9 sample points, each with an 800 m catchment, unless a column says otherwise.';

COMMENT ON COLUMN :"agent_schema".area_features.locality_id IS 'Stable locality id: ward code, colon, hash of the Japanese name.';
COMMENT ON COLUMN :"agent_schema".area_features.name_en IS 'Locality name, romanized. Source: Japan Post romanization file.';
COMMENT ON COLUMN :"agent_schema".area_features.name_ja IS 'Locality name in Japanese, chome suffix removed. Source: e-Stat 2020 census boundaries.';
COMMENT ON COLUMN :"agent_schema".area_features.ward_code IS 'Five-digit municipality code of the ward (13101 to 13123).';
COMMENT ON COLUMN :"agent_schema".area_features.ward_name_en IS 'Ward name in English.';
COMMENT ON COLUMN :"agent_schema".area_features.ward_name_ja IS 'Ward name in Japanese.';
COMMENT ON COLUMN :"agent_schema".area_features.lat IS 'Latitude of a point inside the locality (WGS84 degrees).';
COMMENT ON COLUMN :"agent_schema".area_features.lon IS 'Longitude of a point inside the locality (WGS84 degrees).';
COMMENT ON COLUMN :"agent_schema".area_features.rent_per_sqm_yen IS 'Ward-level average rent per m2 per month, yen. The same value for every locality in a ward. Source: e-Stat Housing and Land Survey; vintage in rent_source_period.';
COMMENT ON COLUMN :"agent_schema".area_features.management_fee_yen IS 'Ward-level typical monthly management fee, yen. Source: e-Stat Housing and Land Survey.';
COMMENT ON COLUMN :"agent_schema".area_features.land_price_multiplier IS 'Rent multiplier used by /v1/optimize: (local / ward median land price) ^ 0.25, clamped to 0.85 to 1.15. 1.0 when fewer than 3 land price points were in range (see land_price_used_fallback).';
COMMENT ON COLUMN :"agent_schema".area_features.land_price_used_fallback IS 'True when land_price_multiplier fell back to 1.0 for lack of nearby land price points. Low confidence.';
COMMENT ON COLUMN :"agent_schema".area_features.rent_source IS 'Source of rent_per_sqm_yen: estat or reins.';
COMMENT ON COLUMN :"agent_schema".area_features.rent_source_period IS 'Survey period of rent_per_sqm_yen, e.g. 2023.';
COMMENT ON COLUMN :"agent_schema".area_features.supermarket_count IS 'Supermarket-equivalents within 800 m: supermarkets plus weighted groceries and convenience stores. Count. Source: OpenStreetMap.';
COMMENT ON COLUMN :"agent_schema".area_features.restaurant_count IS 'Restaurants within 800 m. Count. Source: OpenStreetMap; coverage varies by area.';
COMMENT ON COLUMN :"agent_schema".area_features.cafe_count IS 'Cafes within 800 m. Count. Source: OpenStreetMap.';
COMMENT ON COLUMN :"agent_schema".area_features.convenience_count IS 'Convenience stores within 800 m. Count. Source: OpenStreetMap.';
COMMENT ON COLUMN :"agent_schema".area_features.cuisine_variety_count IS 'Distinct OpenStreetMap cuisine tags among restaurants and cafes within 800 m. Count.';
COMMENT ON COLUMN :"agent_schema".area_features.late_night_count IS 'Restaurants, cafes and bars within 800 m whose opening hours run to 23:00 or later. Count. Only places with tagged hours are counted.';
COMMENT ON COLUMN :"agent_schema".area_features.health_count IS 'Clinics, hospitals, pharmacies and similar within 800 m. Count. Source: OpenStreetMap.';
COMMENT ON COLUMN :"agent_schema".area_features.green_space_share IS 'Share of the 800 m catchment covered by parks and other green space, 0 to 1. Source: OpenStreetMap.';

SELECT grant_agent_read_access();

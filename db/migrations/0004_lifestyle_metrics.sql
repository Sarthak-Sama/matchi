-- Adds the schema and OSM-sourced tables needed for five new lifestyle
-- metrics (task-2-brief.md): everyday health, cuisine variety, late-night
-- food, parks/green space, and konbini (which reuses the existing
-- `convenience_count` raw column and only gains a `norm_*` here).
--
-- `pnpm derive` (Task 3) populates the new raw columns and all `norm_*`
-- columns after import; this migration only adds structure.

-- ---------------------------------------------------------------------------
-- pois — two nullable OSM tag passthroughs, needed to derive cuisine
-- variety (COUNT(DISTINCT cuisine)) and the late-night heuristic (which
-- inspects opening_hours). Exactly these two columns, not a jsonb bag.
-- ---------------------------------------------------------------------------
ALTER TABLE pois
  ADD COLUMN cuisine text,
  ADD COLUMN opening_hours text;

-- ---------------------------------------------------------------------------
-- green_spaces — OSM leisure=park|garden polygons, used to derive
-- green_space_share. Mirrors major_roads exactly (surrogate id only, no
-- natural key; a `*_class` column classifying the OSM tag value; same
-- source/source_updated_at/imported_at bookkeeping columns), except the
-- geometry is a MultiPolygon rather than a MultiLineString.
-- ---------------------------------------------------------------------------
CREATE TABLE green_spaces (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text,
  leisure_class text NOT NULL,
  geom geometry(MultiPolygon, 4326) NOT NULL,
  source text,
  source_updated_at timestamptz,
  imported_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX green_spaces_geom_gist_idx ON green_spaces USING gist (geom);

-- ---------------------------------------------------------------------------
-- neighborhood_metrics — raw counts/shares for the four new metrics that
-- need one (konbini reuses the existing convenience_count), plus all five
-- norm_* columns. Raw counts follow the existing count columns' pattern
-- (integer NOT NULL DEFAULT 0); green_space_share follows the existing
-- share columns' pattern (residential_zoning_share, road_rail_exposure_share
-- — nullable double precision, no default, since derive computes it once a
-- catchment exists). norm_* columns are nullable double precision, same as
-- the existing four — `pnpm derive` populates them after import.
-- ---------------------------------------------------------------------------
ALTER TABLE neighborhood_metrics
  ADD COLUMN health_count integer NOT NULL DEFAULT 0,
  ADD COLUMN cuisine_variety_count integer NOT NULL DEFAULT 0,
  ADD COLUMN late_night_count integer NOT NULL DEFAULT 0,
  ADD COLUMN green_space_share double precision,
  ADD COLUMN norm_amenity_convenience double precision,
  ADD COLUMN norm_amenity_cuisine_variety double precision,
  ADD COLUMN norm_green_space double precision,
  ADD COLUMN norm_amenity_late_night double precision,
  ADD COLUMN norm_amenity_health double precision;

-- ---------------------------------------------------------------------------
-- station_groups — needed by Task 6's ST_DWithin(point::geography, ...)
-- filtering. Per 0002_geography_indexes.sql: a GiST index on the plain
-- `point` geometry column (station_groups_point_gist_idx, 0001_init.sql) is
-- not used by the planner when the column is cast to `geography` inside the
-- predicate, since `point` and `point::geography` are different expressions
-- to the index matcher. This expression index fixes that for station_groups,
-- the same way 0002 fixed it for pois/land_prices.
-- ---------------------------------------------------------------------------
CREATE INDEX station_groups_point_geog_gist_idx ON station_groups USING gist ((point::geography));

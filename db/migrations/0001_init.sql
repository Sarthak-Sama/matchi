-- Initial schema for the Tokyo neighborhood optimizer.
--
-- All geometry columns are SRID 4326 (WGS84 lon/lat), matching stored
-- source data. Distance and area computations elsewhere in the codebase
-- cast to `geography` or `ST_Transform(..., 6677)` (JGD2011 / Japan Plane
-- Rectangular CS IX) rather than operating on raw degrees.

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------------------------------------------------------------------------
-- import_runs — bookkeeping row per invocation of an import script.
-- ---------------------------------------------------------------------------
CREATE TABLE import_runs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source text NOT NULL,
  source_updated_at timestamptz,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status text NOT NULL CHECK (status IN ('running', 'success', 'failed')),
  rows_imported integer,
  error text
);

-- ---------------------------------------------------------------------------
-- wards — Tokyo's 23 special wards (and any other administrative areas).
-- ---------------------------------------------------------------------------
CREATE TABLE wards (
  ward_code text PRIMARY KEY,
  name_ja text NOT NULL,
  name_en text NOT NULL,
  geom geometry(MultiPolygon, 4326) NOT NULL,
  source text,
  source_updated_at timestamptz,
  imported_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- station_groups — deduplicated station clusters (multiple operators'
-- platforms for the "same" station collapse to one row).
-- ---------------------------------------------------------------------------
CREATE TABLE station_groups (
  station_group_id text PRIMARY KEY,
  name_ja text NOT NULL,
  name_en text NOT NULL,
  aliases text[] NOT NULL DEFAULT '{}',
  point geometry(Point, 4326) NOT NULL,
  ward_code text REFERENCES wards (ward_code),
  source text,
  source_updated_at timestamptz,
  imported_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- station_source_refs — maps each upstream source's station identifier to
-- the deduplicated station_group it belongs to.
-- ---------------------------------------------------------------------------
CREATE TABLE station_source_refs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  station_group_id text NOT NULL REFERENCES station_groups ON DELETE CASCADE,
  source text NOT NULL,
  source_id text NOT NULL,
  source_name text,
  UNIQUE (source, source_id)
);

-- ---------------------------------------------------------------------------
-- rail_lines
-- ---------------------------------------------------------------------------
CREATE TABLE rail_lines (
  rail_line_id text PRIMARY KEY,
  operator text NOT NULL,
  name_ja text NOT NULL,
  name_en text,
  mode text NOT NULL CHECK (mode IN ('subway', 'local_rail', 'commuter_rail', 'monorail')),
  geom geometry(MultiLineString, 4326),
  source text,
  source_updated_at timestamptz,
  imported_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- rail_edges — directed ride/transfer edges between station_groups, used to
-- compute commute times. `rail_line_id` is null for transfer edges, so the
-- table-level UNIQUE constraint (which treats NULL as distinct from every
-- other NULL) does not prevent duplicate transfer edges on its own — see the
-- partial unique index below.
-- ---------------------------------------------------------------------------
CREATE TABLE rail_edges (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  from_station_group_id text NOT NULL REFERENCES station_groups,
  to_station_group_id text NOT NULL REFERENCES station_groups,
  rail_line_id text REFERENCES rail_lines,
  edge_type text NOT NULL CHECK (edge_type IN ('ride', 'transfer')),
  peak_travel_minutes double precision NOT NULL CHECK (peak_travel_minutes >= 0),
  offpeak_travel_minutes double precision NOT NULL CHECK (offpeak_travel_minutes >= 0),
  peak_wait_minutes double precision NOT NULL DEFAULT 0,
  offpeak_wait_minutes double precision NOT NULL DEFAULT 0,
  confidence text NOT NULL CHECK (confidence IN ('high', 'medium', 'low')),
  source text,
  source_updated_at timestamptz,
  imported_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (from_station_group_id, to_station_group_id, rail_line_id, edge_type)
);

-- Covers the rail_line_id IS NULL case (transfer edges), where the
-- table-level UNIQUE constraint above does not deduplicate.
CREATE UNIQUE INDEX rail_edges_null_line_unique_idx
  ON rail_edges (from_station_group_id, to_station_group_id, edge_type)
  WHERE rail_line_id IS NULL;

-- ---------------------------------------------------------------------------
-- station_areas — derived catchment polygon per station (isochrone or
-- buffer at radius_m), computed by `pnpm derive`.
-- ---------------------------------------------------------------------------
CREATE TABLE station_areas (
  station_group_id text PRIMARY KEY REFERENCES station_groups ON DELETE CASCADE,
  radius_m integer NOT NULL,
  geom geometry(Polygon, 4326) NOT NULL,
  area_sqm double precision NOT NULL,
  derived_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- rent_stats — per-ward, per-period rent statistics from a given source.
-- ---------------------------------------------------------------------------
CREATE TABLE rent_stats (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ward_code text NOT NULL REFERENCES wards (ward_code),
  period text NOT NULL,
  source text NOT NULL,
  rent_per_sqm_yen double precision NOT NULL CHECK (rent_per_sqm_yen > 0),
  management_fee_yen double precision NOT NULL DEFAULT 0,
  sample_count integer,
  source_updated_at timestamptz,
  imported_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ward_code, period, source)
);

-- ---------------------------------------------------------------------------
-- land_prices — individual official land price points (e.g. MLIT posted
-- land prices), used to derive a ward-relative multiplier.
-- ---------------------------------------------------------------------------
CREATE TABLE land_prices (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  point geometry(Point, 4326) NOT NULL,
  price_yen_per_sqm double precision NOT NULL,
  year integer NOT NULL,
  use_category text,
  ward_code text REFERENCES wards (ward_code),
  source text,
  source_updated_at timestamptz,
  imported_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- zoning_areas — urban planning zoning polygons.
-- ---------------------------------------------------------------------------
CREATE TABLE zoning_areas (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  category text NOT NULL,
  is_residential boolean NOT NULL,
  geom geometry(MultiPolygon, 4326) NOT NULL,
  source text,
  source_updated_at timestamptz,
  imported_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- flood_zones — flood hazard map polygons, ranked by depth category.
-- ---------------------------------------------------------------------------
CREATE TABLE flood_zones (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  depth_category text NOT NULL,
  depth_rank integer NOT NULL,
  geom geometry(MultiPolygon, 4326) NOT NULL,
  source text,
  source_updated_at timestamptz,
  imported_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- pois — points of interest (supermarkets, restaurants, nightlife, etc.)
-- imported from OSM.
-- ---------------------------------------------------------------------------
CREATE TABLE pois (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  category text NOT NULL,
  name text,
  osm_type text,
  osm_id bigint,
  point geometry(Point, 4326) NOT NULL,
  source text,
  source_updated_at timestamptz,
  imported_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (osm_type, osm_id)
);

-- ---------------------------------------------------------------------------
-- major_roads — used to derive road/rail noise exposure.
-- ---------------------------------------------------------------------------
CREATE TABLE major_roads (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text,
  road_class text NOT NULL,
  geom geometry(MultiLineString, 4326) NOT NULL,
  source text,
  source_updated_at timestamptz,
  imported_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- neighborhood_metrics — one row per station_group, holding every derived
-- metric `pnpm derive` computes. norm_* columns hold 0-100 normalized
-- scores.
-- ---------------------------------------------------------------------------
CREATE TABLE neighborhood_metrics (
  station_group_id text PRIMARY KEY REFERENCES station_groups ON DELETE CASCADE,
  ward_code text REFERENCES wards (ward_code),
  rent_low_yen double precision,
  rent_median_yen double precision,
  rent_high_yen double precision,
  rent_confidence text,
  rent_source text,
  rent_source_period text,
  rent_per_sqm_yen double precision,
  management_fee_yen double precision,
  land_price_multiplier double precision,
  land_price_point_count integer,
  supermarket_count integer NOT NULL DEFAULT 0,
  grocery_count integer NOT NULL DEFAULT 0,
  convenience_count integer NOT NULL DEFAULT 0,
  amenity_supermarket_equiv double precision NOT NULL DEFAULT 0,
  restaurant_count integer NOT NULL DEFAULT 0,
  cafe_count integer NOT NULL DEFAULT 0,
  nightlife_count integer NOT NULL DEFAULT 0,
  flood_share_by_category jsonb NOT NULL DEFAULT '{}'::jsonb,
  flood_exposure_score double precision,
  residential_zoning_share double precision,
  road_rail_exposure_share double precision,
  quietness_raw double precision,
  norm_amenity_supermarket double precision,
  norm_amenity_restaurant double precision,
  norm_flood_safety double precision,
  norm_quietness double precision,
  source_dates jsonb NOT NULL DEFAULT '{}'::jsonb,
  derived_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

-- GiST on every geometry column.
CREATE INDEX wards_geom_gist_idx ON wards USING gist (geom);
CREATE INDEX station_groups_point_gist_idx ON station_groups USING gist (point);
CREATE INDEX rail_lines_geom_gist_idx ON rail_lines USING gist (geom);
CREATE INDEX station_areas_geom_gist_idx ON station_areas USING gist (geom);
CREATE INDEX land_prices_point_gist_idx ON land_prices USING gist (point);
CREATE INDEX zoning_areas_geom_gist_idx ON zoning_areas USING gist (geom);
CREATE INDEX flood_zones_geom_gist_idx ON flood_zones USING gist (geom);
CREATE INDEX pois_point_gist_idx ON pois USING gist (point);
CREATE INDEX major_roads_geom_gist_idx ON major_roads USING gist (geom);

-- B-tree lookup/filter indexes.
CREATE INDEX station_source_refs_station_group_id_idx ON station_source_refs (station_group_id);
CREATE INDEX rail_edges_from_station_group_id_idx ON rail_edges (from_station_group_id);
CREATE INDEX rail_edges_to_station_group_id_idx ON rail_edges (to_station_group_id);
CREATE INDEX rent_stats_ward_code_idx ON rent_stats (ward_code);
CREATE INDEX land_prices_ward_code_idx ON land_prices (ward_code);
CREATE INDEX pois_category_idx ON pois (category);
CREATE INDEX flood_zones_depth_rank_idx ON flood_zones (depth_rank);
CREATE INDEX import_runs_source_started_at_idx ON import_runs (source, started_at DESC);

-- Trigram indexes for autocomplete on station names.
CREATE INDEX station_groups_name_en_trgm_idx ON station_groups USING gin (name_en gin_trgm_ops);
CREATE INDEX station_groups_name_ja_trgm_idx ON station_groups USING gin (name_ja gin_trgm_ops);

-- Ward-scoped e-Stat 2020 town/chome localities and their residential samples.
-- Station-derived tables intentionally remain in place for legacy detail APIs.

CREATE TABLE localities (
  locality_id text PRIMARY KEY,
  ward_code text NOT NULL REFERENCES wards(ward_code),
  name_ja text NOT NULL,
  name_en text,
  geom geometry(MultiPolygon, 4326) NOT NULL,
  centroid geometry(Point, 4326) NOT NULL,
  source text NOT NULL,
  source_updated_at timestamptz,
  imported_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ward_code, name_ja)
);

CREATE TABLE locality_samples (
  locality_id text NOT NULL REFERENCES localities(locality_id) ON DELETE CASCADE,
  sample_number smallint NOT NULL CHECK (sample_number BETWEEN 1 AND 9),
  point geometry(Point, 4326) NOT NULL,
  used_residential_zoning boolean NOT NULL,
  PRIMARY KEY (locality_id, sample_number)
);

CREATE TABLE locality_sample_stations (
  locality_id text NOT NULL,
  sample_number smallint NOT NULL,
  station_group_id text NOT NULL REFERENCES station_groups(station_group_id) ON DELETE CASCADE,
  walk_distance_m double precision NOT NULL CHECK (walk_distance_m >= 0),
  walk_minutes integer NOT NULL CHECK (walk_minutes >= 0),
  station_rank smallint NOT NULL CHECK (station_rank BETWEEN 1 AND 3),
  PRIMARY KEY (locality_id, sample_number, station_group_id),
  UNIQUE (locality_id, sample_number, station_rank),
  FOREIGN KEY (locality_id, sample_number)
    REFERENCES locality_samples(locality_id, sample_number) ON DELETE CASCADE
);

CREATE TABLE locality_metrics (
  locality_id text PRIMARY KEY REFERENCES localities(locality_id) ON DELETE CASCADE,
  rent_per_sqm_yen double precision,
  management_fee_yen double precision,
  land_price_multiplier double precision,
  land_price_point_count integer,
  land_price_used_fallback boolean,
  rent_source text,
  rent_source_period text,
  supermarket_count integer NOT NULL DEFAULT 0,
  restaurant_count integer NOT NULL DEFAULT 0,
  cafe_count integer NOT NULL DEFAULT 0,
  convenience_count integer NOT NULL DEFAULT 0,
  cuisine_variety_count integer NOT NULL DEFAULT 0,
  late_night_count integer NOT NULL DEFAULT 0,
  health_count integer NOT NULL DEFAULT 0,
  green_space_share double precision NOT NULL DEFAULT 0,
  norm_amenity_supermarket double precision,
  norm_amenity_restaurant double precision,
  norm_amenity_convenience double precision,
  norm_amenity_cuisine_variety double precision,
  norm_amenity_late_night double precision,
  norm_amenity_health double precision,
  norm_green_space double precision,
  norm_quietness double precision,
  source_dates jsonb NOT NULL DEFAULT '{}'::jsonb,
  derived_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX localities_geom_gist_idx ON localities USING gist (geom);
CREATE INDEX localities_centroid_gist_idx ON localities USING gist (centroid);
CREATE INDEX locality_samples_point_gist_idx ON locality_samples USING gist (point);
CREATE INDEX locality_sample_stations_station_idx ON locality_sample_stations(station_group_id);

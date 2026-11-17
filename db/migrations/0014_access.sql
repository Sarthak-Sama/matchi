-- Access and connectivity (plan C1 to C3), precomputed from rail_edges by
-- `pnpm derive --only=access`. Every value inherits rail_edges' confidence:
-- most edges are still geometric estimates (source mlit-topology).

CREATE TABLE station_travel_times (
  from_station_group_id text NOT NULL REFERENCES station_groups ON DELETE CASCADE,
  to_station_group_id text NOT NULL REFERENCES station_groups ON DELETE CASCADE,
  period text NOT NULL CHECK (period IN ('peak', 'offpeak')),
  minutes double precision NOT NULL CHECK (minutes >= 0),
  transfers smallint NOT NULL CHECK (transfers >= 0),
  confidence text NOT NULL CHECK (confidence IN ('high', 'medium', 'low')),
  derived_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (from_station_group_id, to_station_group_id, period)
);

CREATE INDEX station_travel_times_to_idx ON station_travel_times (to_station_group_id, period);

COMMENT ON TABLE station_travel_times IS
  'Fastest station-to-station rail time, including the first wait and transfer penalties, from the same search /v1/optimize uses. Self pairs are 0. Missing pairs are disconnected.';

CREATE TABLE station_access (
  station_group_id text PRIMARY KEY REFERENCES station_groups ON DELETE CASCADE,
  line_count integer NOT NULL,
  direct_reach_stations integer NOT NULL,
  stations_within_30_min integer NOT NULL,
  derived_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE locality_access (
  locality_id text PRIMARY KEY REFERENCES localities ON DELETE CASCADE,
  hub_minutes jsonb NOT NULL DEFAULT '{}'::jsonb,
  centrality_minutes double precision,
  line_count double precision,
  direct_reach_stations double precision,
  stations_within_30_min double precision,
  nearest_station_walk_min double precision,
  confidence text CHECK (confidence IN ('high', 'medium', 'low')),
  derived_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN locality_access.hub_minutes IS
  'Door-to-hub peak minutes per hub key in shared/src/config/access.ts: median over the 9 samples of min over each sample''s 3 nearest stations of walk + rail.';

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
  -- 0014
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
  la.nearest_station_walk_min, la.confidence AS access_confidence
FROM localities l
JOIN locality_metrics lm USING (locality_id)
JOIN wards w ON w.ward_code = l.ward_code
LEFT JOIN locality_access la ON la.locality_id = l.locality_id;

COMMENT ON COLUMN :"agent_schema".area_features.centrality_minutes IS 'Mean of the min_to_* columns: typical peak door-to-door minutes to the 8 main hubs. Lower is more central. Confidence in access_confidence.';
COMMENT ON COLUMN :"agent_schema".area_features.min_to_shinjuku IS 'Peak door-to-door minutes to Shinjuku station: walk to one of the 3 nearest stations plus rail, median over 9 sample points. Modelled, not timetabled; see access_confidence.';
COMMENT ON COLUMN :"agent_schema".area_features.min_to_shibuya IS 'Peak door-to-door minutes to Shibuya station. Same method as min_to_shinjuku.';
COMMENT ON COLUMN :"agent_schema".area_features.min_to_ikebukuro IS 'Peak door-to-door minutes to Ikebukuro station. Same method as min_to_shinjuku.';
COMMENT ON COLUMN :"agent_schema".area_features.min_to_tokyo IS 'Peak door-to-door minutes to Tokyo station. Same method as min_to_shinjuku.';
COMMENT ON COLUMN :"agent_schema".area_features.min_to_shinagawa IS 'Peak door-to-door minutes to Shinagawa station. Same method as min_to_shinjuku.';
COMMENT ON COLUMN :"agent_schema".area_features.min_to_ueno IS 'Peak door-to-door minutes to Ueno station. Same method as min_to_shinjuku.';
COMMENT ON COLUMN :"agent_schema".area_features.min_to_otemachi IS 'Peak door-to-door minutes to Otemachi station. Same method as min_to_shinjuku.';
COMMENT ON COLUMN :"agent_schema".area_features.min_to_roppongi IS 'Peak door-to-door minutes to Roppongi station. Same method as min_to_shinjuku.';
COMMENT ON COLUMN :"agent_schema".area_features.line_count IS 'Distinct rail lines serving the 3 nearest stations of a sample point, median over 9 points.';
COMMENT ON COLUMN :"agent_schema".area_features.direct_reach_stations IS 'Stations reachable without a transfer within 30 rail minutes from the best of the 3 nearest stations, median over 9 points.';
COMMENT ON COLUMN :"agent_schema".area_features.stations_within_30_min IS 'Stations reachable within 30 peak minutes, transfers allowed, from the best of the 3 nearest stations, median over 9 points.';
COMMENT ON COLUMN :"agent_schema".area_features.nearest_station_walk_min IS 'Walk to the nearest station, minutes (straight line * 1.3 at 80 m/min), median over 9 points.';
COMMENT ON COLUMN :"agent_schema".area_features.access_confidence IS 'Lowest confidence of the rail edges behind the hub times: high (timetable), medium, or low (geometric estimate).';

-- Station-level views so the agent can answer station questions directly.
CREATE VIEW :"agent_schema".stations AS
SELECT sg.station_group_id, sg.name_en, sg.name_ja, sg.ward_code,
  ST_Y(sg.point) AS lat, ST_X(sg.point) AS lon,
  sa.line_count, sa.direct_reach_stations, sa.stations_within_30_min
FROM station_groups sg
LEFT JOIN station_access sa USING (station_group_id);

COMMENT ON VIEW :"agent_schema".stations IS 'One row per station group (platforms of all operators at one place merged).';
COMMENT ON COLUMN :"agent_schema".stations.station_group_id IS 'Station group id; joins station_travel_times.';
COMMENT ON COLUMN :"agent_schema".stations.name_en IS 'Station name, romanized where available.';
COMMENT ON COLUMN :"agent_schema".stations.name_ja IS 'Station name in Japanese. Several groups can share a name (Tokyo, Ikebukuro).';
COMMENT ON COLUMN :"agent_schema".stations.ward_code IS 'Ward containing the station.';
COMMENT ON COLUMN :"agent_schema".stations.lat IS 'Latitude, WGS84 degrees.';
COMMENT ON COLUMN :"agent_schema".stations.lon IS 'Longitude, WGS84 degrees.';
COMMENT ON COLUMN :"agent_schema".stations.line_count IS 'Distinct rail lines with a ride edge at this station.';
COMMENT ON COLUMN :"agent_schema".stations.direct_reach_stations IS 'Stations reachable on one line, no transfer, within 30 rail minutes.';
COMMENT ON COLUMN :"agent_schema".stations.stations_within_30_min IS 'Stations reachable within 30 peak minutes, transfers allowed.';

CREATE VIEW :"agent_schema".station_travel_times AS
SELECT from_station_group_id, to_station_group_id, period, minutes, transfers, confidence
FROM station_travel_times;

COMMENT ON VIEW :"agent_schema".station_travel_times IS 'Station-to-station rail minutes. About 240,000 rows per period: always filter by station.';
COMMENT ON COLUMN :"agent_schema".station_travel_times.from_station_group_id IS 'Origin station group.';
COMMENT ON COLUMN :"agent_schema".station_travel_times.to_station_group_id IS 'Destination station group.';
COMMENT ON COLUMN :"agent_schema".station_travel_times.period IS 'peak (arrive 07:30 to 10:00) or offpeak.';
COMMENT ON COLUMN :"agent_schema".station_travel_times.minutes IS 'Fastest rail time including first wait and 5-minute transfer penalties, minutes. Modelled.';
COMMENT ON COLUMN :"agent_schema".station_travel_times.transfers IS 'Transfers on that fastest path.';
COMMENT ON COLUMN :"agent_schema".station_travel_times.confidence IS 'Lowest edge confidence on the path: high (timetable), medium, low (geometric estimate).';

SELECT grant_agent_read_access();

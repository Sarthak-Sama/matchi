-- Which rail line each station group serves, taken from the N02 station
-- features (N02_003 line, N02_004 operator). The topology import builds each
-- line's graph from these members instead of snapping stations to line
-- geometry, so a parallel line's stations cannot attach to the wrong line.

CREATE TABLE station_line_members (
  station_group_id text NOT NULL REFERENCES station_groups ON DELETE CASCADE,
  rail_line_id text NOT NULL REFERENCES rail_lines ON DELETE CASCADE,
  PRIMARY KEY (station_group_id, rail_line_id)
);

CREATE INDEX station_line_members_rail_line_idx ON station_line_members (rail_line_id);

COMMENT ON TABLE station_line_members IS
  'Station groups served by each rail line, from the MLIT N02 station features. Rebuilt by import:mlit.';

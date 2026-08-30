-- Real N02 refreshes can remove stations or rail lines.  Transit is a
-- derived projection of that source, so stale edges must not block the
-- refresh; the next topology rebuild writes the current graph.
ALTER TABLE rail_edges DROP CONSTRAINT IF EXISTS rail_edges_from_station_group_id_fkey;
ALTER TABLE rail_edges
  ADD CONSTRAINT rail_edges_from_station_group_id_fkey
  FOREIGN KEY (from_station_group_id) REFERENCES station_groups(station_group_id) ON DELETE CASCADE;

ALTER TABLE rail_edges DROP CONSTRAINT IF EXISTS rail_edges_to_station_group_id_fkey;
ALTER TABLE rail_edges
  ADD CONSTRAINT rail_edges_to_station_group_id_fkey
  FOREIGN KEY (to_station_group_id) REFERENCES station_groups(station_group_id) ON DELETE CASCADE;

ALTER TABLE rail_edges DROP CONSTRAINT IF EXISTS rail_edges_rail_line_id_fkey;
ALTER TABLE rail_edges
  ADD CONSTRAINT rail_edges_rail_line_id_fkey
  FOREIGN KEY (rail_line_id) REFERENCES rail_lines(rail_line_id) ON DELETE CASCADE;

-- Curated search aliases let a destination be found by the name people use,
-- even when OpenStreetMap only exposes a different official English name.
ALTER TABLE pois ADD COLUMN IF NOT EXISTS aliases text[] NOT NULL DEFAULT '{}';

UPDATE pois
SET aliases = array_append(aliases, 'Bunka Fashion College')
WHERE source = 'openstreetmap'
  AND osm_type = 'way'
  AND osm_id = 575505286
  AND NOT ('Bunka Fashion College' = ANY(aliases));

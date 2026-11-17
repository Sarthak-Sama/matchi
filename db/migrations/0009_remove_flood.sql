-- Flood data and flood-derived scores were removed from the product.
-- Keeping nullable legacy columns would allow stale values to leak back
-- into future queries, so remove both the raw layer and all derived fields.

DROP TABLE IF EXISTS flood_zones;

ALTER TABLE neighborhood_metrics
  DROP COLUMN IF EXISTS flood_share_by_category,
  DROP COLUMN IF EXISTS flood_exposure_score,
  DROP COLUMN IF EXISTS norm_flood_safety;

ALTER TABLE locality_metrics
  DROP COLUMN IF EXISTS norm_flood_safety;

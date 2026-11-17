-- Persists computeLandPriceMultiplier's `usedFallback` flag (Task 7's
-- rent step already computes this and threads it into estimateRent for
-- the confidence calculation, but previously discarded it afterward).
--
-- Task 10 recomputes rent per requested layout at request time by reusing
-- `rent_per_sqm_yen`, `land_price_multiplier`, etc. from this table (see
-- scripts/src/derive/rent.ts's module doc comment) — but `estimateRent`'s
-- `landPriceUsedFallback` is a required input, and re-deriving it from
-- `land_price_point_count < MIN_LAND_PRICE_POINTS` alone is exactly the
-- bug Task 6 fixed: computeLandPriceMultiplier also falls back to 1.0
-- when a median is missing or non-positive even with enough points (see
-- shared/src/domain/rent.ts). Without a stored column, Task 10 would have
-- no safe way to reconstruct this value.
--
-- Nullable, no default: a station_group row that predates a `pnpm derive`
-- run (or whose rent step hasn't run yet) should read as "unknown", not
-- silently "false" (which would read as "a real, non-fallback multiplier"
-- and understate how little land-price data backs the number).
ALTER TABLE neighborhood_metrics
  ADD COLUMN land_price_used_fallback boolean;

-- Market-level rent (plan D8). The survey rents describe the whole rented
-- stock; hand-collected listing medians (data/rent-reference.csv, loaded by
-- `pnpm import:rent-reference`) pull the ward level towards what a new tenant
-- pays. market_factor multiplies the ward rent in derive; market_refs is the
-- number of reference rows behind it (0 = city-wide median factor).

ALTER TABLE rent_stats
  ADD COLUMN market_factor double precision NOT NULL DEFAULT 1 CHECK (market_factor > 0),
  ADD COLUMN market_refs integer NOT NULL DEFAULT 0 CHECK (market_refs >= 0);

COMMENT ON COLUMN rent_stats.market_factor IS
  'Median of listing reference rent / modelled rent across layouts for the ward, clamped to 0.8-1.6; the city-wide median when the ward has no references. Multiplied into rent_per_sqm_yen by derive.';
COMMENT ON COLUMN rent_stats.market_refs IS
  'Reference rents behind market_factor. 0 means the ward has none and uses the city-wide factor.';

CREATE TABLE rent_reference (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ward_code text NOT NULL REFERENCES wards (ward_code),
  layout text NOT NULL,
  median_rent_yen integer NOT NULL CHECK (median_rent_yen > 0),
  source_note text NOT NULL,
  collected_on date NOT NULL,
  model_rent_yen double precision,
  UNIQUE (ward_code, layout, source_note)
);

COMMENT ON TABLE rent_reference IS
  'Hand-collected median asking rents per ward and layout from listing sites. Not scraped. model_rent_yen is the survey-based ward rent for the layout at import time.';

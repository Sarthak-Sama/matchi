-- Rent distribution per ward (plan B3) and the size premium (B4), from the
-- 2023 Housing and Land Survey via the e-Stat API (`pnpm import:estat-detail`).
-- B5 (prefectural land survey points) and B6 (transaction prices) need the
-- Real Estate Information Library API key and are not in this migration.

CREATE TABLE rent_bands (
  ward_code text NOT NULL REFERENCES wards (ward_code),
  period text NOT NULL,
  band_code text NOT NULL,
  band_low_yen integer,
  band_high_yen integer,
  dwellings integer NOT NULL CHECK (dwellings >= 0),
  ward_total_dwellings integer NOT NULL CHECK (ward_total_dwellings >= 0),
  source text NOT NULL,
  source_updated_at timestamptz,
  imported_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ward_code, period, band_code),
  CHECK (band_high_yen IS NULL OR band_low_yen IS NULL OR band_high_yen > band_low_yen)
);

COMMENT ON TABLE rent_bands IS
  'Rented dwellings by monthly rent band per ward (e-Stat table 0004021454, survey table 112-3-1, all rented dwellings incl. public and company housing). band_low_yen is inclusive, band_high_yen exclusive; both null for the not-stated band (99).';

CREATE TABLE rent_size_curve (
  period text NOT NULL,
  tenure text NOT NULL,
  size_class_code text NOT NULL,
  tatami_min double precision,
  tatami_max double precision,
  dwellings integer NOT NULL CHECK (dwellings >= 0),
  median_rent_per_tatami_yen double precision,
  relative_to_all double precision,
  source text NOT NULL,
  source_updated_at timestamptz,
  imported_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (period, tenure, size_class_code)
);

COMMENT ON TABLE rent_size_curve IS
  'Median monthly rent per tatami of living-room space by room-size class, 23-ward area as one unit (e-Stat table 0004021502, survey table 119-1). Medians are interpolated within the published rent bands; 0-yen and not-stated rents are excluded. size_class_code 0 is all sizes.';

-- Published 2020 census population per ward (e-Stat table 0003445078), used
-- by data:validate to check the locality population sums.
CREATE TABLE census_ward_totals (
  ward_code text NOT NULL REFERENCES wards (ward_code),
  period text NOT NULL,
  population integer NOT NULL CHECK (population >= 0),
  source text NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ward_code, period)
);

CREATE VIEW :"agent_schema".ward_rent_bands AS
SELECT rb.ward_code, w.name_en AS ward_name_en, rb.period, rb.band_low_yen, rb.band_high_yen,
  rb.dwellings, rb.ward_total_dwellings,
  rb.dwellings::double precision / NULLIF(rb.ward_total_dwellings, 0) AS share_of_ward
FROM rent_bands rb
JOIN wards w ON w.ward_code = rb.ward_code;

COMMENT ON VIEW :"agent_schema".ward_rent_bands IS 'How many rented homes in each ward fall in each monthly rent band. Use it to say what share of a ward''s rentals fit a budget. Includes public and company housing, so low bands are larger than the open market.';
COMMENT ON COLUMN :"agent_schema".ward_rent_bands.ward_code IS 'Ward code.';
COMMENT ON COLUMN :"agent_schema".ward_rent_bands.ward_name_en IS 'Ward name in English.';
COMMENT ON COLUMN :"agent_schema".ward_rent_bands.period IS 'Survey year (2023).';
COMMENT ON COLUMN :"agent_schema".ward_rent_bands.band_low_yen IS 'Band lower bound, monthly rent in yen, inclusive. Null for the not-stated band.';
COMMENT ON COLUMN :"agent_schema".ward_rent_bands.band_high_yen IS 'Band upper bound, yen, exclusive. Null for the top band (200,000 and over) and the not-stated band.';
COMMENT ON COLUMN :"agent_schema".ward_rent_bands.dwellings IS 'Rented dwellings in the band. Survey estimate, rounded to tens.';
COMMENT ON COLUMN :"agent_schema".ward_rent_bands.ward_total_dwellings IS 'All rented dwellings in the ward, including the not-stated band.';
COMMENT ON COLUMN :"agent_schema".ward_rent_bands.share_of_ward IS 'dwellings / ward_total_dwellings, 0 to 1.';

CREATE VIEW :"agent_schema".rent_size_curve AS
SELECT period, tenure, size_class_code, tatami_min, tatami_max, dwellings,
  median_rent_per_tatami_yen, relative_to_all
FROM rent_size_curve;

COMMENT ON VIEW :"agent_schema".rent_size_curve IS 'Rent per tatami by room size for private rentals across the 23 wards. Smaller homes cost more per tatami; relative_to_all is the multiplier to apply to a per-area rent.';
COMMENT ON COLUMN :"agent_schema".rent_size_curve.period IS 'Survey year (2023).';
COMMENT ON COLUMN :"agent_schema".rent_size_curve.tenure IS 'private_rental (民営借家).';
COMMENT ON COLUMN :"agent_schema".rent_size_curve.size_class_code IS 'Survey size class: 0 all, 1 under 6 tatami, 2 6-12, 3 12-18, 4 18-24, 5 24-30, 6 30 and over.';
COMMENT ON COLUMN :"agent_schema".rent_size_curve.tatami_min IS 'Lower bound of living-room space, tatami (1 tatami is about 1.62 m2). Living rooms only, not kitchen or bath.';
COMMENT ON COLUMN :"agent_schema".rent_size_curve.tatami_max IS 'Upper bound, tatami, exclusive. Null for the top class.';
COMMENT ON COLUMN :"agent_schema".rent_size_curve.dwellings IS 'Private rented dwellings in the class with a stated, non-zero rent.';
COMMENT ON COLUMN :"agent_schema".rent_size_curve.median_rent_per_tatami_yen IS 'Median monthly rent per tatami, yen, interpolated within the published bands.';
COMMENT ON COLUMN :"agent_schema".rent_size_curve.relative_to_all IS 'median_rent_per_tatami_yen divided by the all-sizes median.';

SELECT grant_agent_read_access();

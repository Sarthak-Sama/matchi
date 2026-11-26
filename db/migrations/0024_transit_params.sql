-- Fitted routing parameters written by `pnpm calibrate:transit` and read by the
-- topology import and derive/access. Keys are `speed_kmh.<mode>` (one per
-- rail_lines.mode) and `transfer_penalty_minutes`. Absent keys fall back to the
-- constants in shared/src/config/scoring.ts.

CREATE TABLE transit_params (
  key text PRIMARY KEY,
  value double precision NOT NULL,
  fitted_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE transit_params IS
  'Routing parameters fitted against commute_reference by calibrate:transit. Overrides the defaults in shared/src/config/scoring.ts.';

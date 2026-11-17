-- Commute calibration scaffolding (plan A2, A4). Reference journeys are
-- entered by hand into data/commute-reference.csv and loaded with `pnpm
-- import:commute-reference`; `pnpm derive --only=commute-error` compares them
-- with station_travel_times. A3 (refitting speeds) and A5 (express stop
-- patterns) are not in this migration.

CREATE TABLE commute_reference (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  origin_name_ja text NOT NULL,
  destination_name_ja text NOT NULL,
  arrival_time text NOT NULL CHECK (arrival_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  reference_minutes double precision NOT NULL CHECK (reference_minutes > 0),
  reference_transfers smallint CHECK (reference_transfers >= 0),
  line_note text,
  source_note text NOT NULL,
  collected_on date NOT NULL,
  model_minutes double precision,
  model_confidence text CHECK (model_confidence IN ('high', 'medium', 'low')),
  compared_at timestamptz,
  UNIQUE (origin_name_ja, destination_name_ja, arrival_time)
);

COMMENT ON TABLE commute_reference IS
  'Hand-collected station-to-station journeys from a journey planner, weekday arrival. Not scraped. model_* is filled by derive --only=commute-error.';

CREATE TABLE commute_error_model (
  confidence text PRIMARY KEY CHECK (confidence IN ('high', 'medium', 'low')),
  n integer NOT NULL,
  mean_error_minutes double precision NOT NULL,
  mae_minutes double precision NOT NULL,
  p90_abs_error_minutes double precision NOT NULL,
  derived_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE commute_error_model IS
  'Model minus reference error per path confidence class. mean_error is signed (positive: model too slow).';

CREATE VIEW :"agent_schema".commute_error_model AS
SELECT confidence, n, mean_error_minutes, mae_minutes, p90_abs_error_minutes, derived_at
FROM commute_error_model;

COMMENT ON VIEW :"agent_schema".commute_error_model IS 'How wrong modelled rail minutes are, per confidence class, measured against hand-collected reference journeys. Empty until reference journeys are loaded.';
COMMENT ON COLUMN :"agent_schema".commute_error_model.confidence IS 'Path confidence class: high, medium or low.';
COMMENT ON COLUMN :"agent_schema".commute_error_model.n IS 'Reference journeys in the class.';
COMMENT ON COLUMN :"agent_schema".commute_error_model.mean_error_minutes IS 'Mean of model minus reference, minutes. Positive means the model is too slow.';
COMMENT ON COLUMN :"agent_schema".commute_error_model.mae_minutes IS 'Mean absolute error, minutes.';
COMMENT ON COLUMN :"agent_schema".commute_error_model.p90_abs_error_minutes IS '90th percentile absolute error, minutes. Use as an error band.';
COMMENT ON COLUMN :"agent_schema".commute_error_model.derived_at IS 'When the comparison ran.';

SELECT grant_agent_read_access();

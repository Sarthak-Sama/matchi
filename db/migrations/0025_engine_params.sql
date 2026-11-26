-- Evidence noise shares (plan R4): model_params is the one source of truth for
-- them; the engine reads them through ModelParams (api/src/agent/feature-store.ts).
-- Starting values are the engine's former constants, to be tuned with the
-- non-circular simulation (E2).

INSERT INTO model_params (key, value, unit, notes) VALUES
  ('evidence_beta_share', 0.03, 'share of scale',
   'Choice noise beta of area-choice evidence (logit temperature), as a share of the scale (budget). Chosen, not fitted; tune with eval:sim.'),
  ('evidence_tau_share', 0.01, 'share of scale',
   'Statement noise tau of direction and compare_importance evidence, as a share of the scale (budget). Chosen, not fitted; tune with eval:sim.')
ON CONFLICT (key) DO NOTHING;

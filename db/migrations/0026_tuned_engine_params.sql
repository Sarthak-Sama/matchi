-- Tuned with the non-circular simulation (pnpm eval:sim; hidden people drawn from
-- a different model than the engine prior). Over 900 hidden people, 5 seeds x 3
-- anchors, synthetic fixtures: beta 0.03 -> 0.04 cut ECE of pBest from 0.063 to
-- 0.025; together with agent.minEvoiShare 0.003 -> 0.001 (engine constant, not a
-- row) mean regret after six questions fell from about 2,590 to 2,250 yen per month.
-- evidence_tau_share is left at 0.01: the simulation answers with taps only, so
-- it has no statement evidence to tune tau against.
UPDATE model_params
SET value = 0.04,
    notes = 'Choice noise beta of area-choice evidence (logit temperature), as a share of the scale (budget). Tuned with eval:sim (was 0.03): the best-calibrated pBest against hidden people who answer with probit noise and 10% lapses.'
WHERE key = 'evidence_beta_share';

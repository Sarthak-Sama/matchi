# Engine spec errata

Review of `docs/plans/engine-spec.md` (337 lines), read-only. Column facts come from `progress.md` "P0 recon", which was built from migrations, not a live database. Nothing here was run; every item is from reading. Most severe first.

## Blocking

### E01 · blocking · lines 82-88, 192, 212-215, 229
**Problem.** Rent and travel noise is drawn independently per sample and per area (`z_ia`), and Risk, Regret and P_best take `max over b in F` of the noisy `U_i(b)`. With sigma_R 0.08 to 0.12 on a rent near 100,000 yen, each area carries about 8,000 to 12,000 yen of independent noise. The maximum over hundreds of feasible areas is then several thousand yen above the best of any five, in every sample, and no evidence about the person can reduce it. Risk(S) therefore has a floor well above the 1% of budget stop threshold (about 1,000 yen), so the stop rule can only fire through the six-question cap. The same noise spreads P_best thinly over many areas, so the "P_best above 0.05" filter in line 229 may leave fewer than two areas, and it gives uncertain areas (sigma 0.12) an optimism bonus in the greedy pick.
**Fix.** Use noise-free `U` (z = 0) for EUS, Risk, Regret, P_best and EVOI, and keep the noise only inside the choice likelihoods (to soften near ties). Or, if noise stays in, define Risk against a baseline: Risk now minus Risk under a fully known person. State which.

### E02 · blocking · lines 57, 259-263, 284-289
**Problem.** `t_m(a)` for an arbitrary anchor needs, per locality, the 9 sample points, each point's 3 nearest stations and walk minutes, plus the anchor's station and destination walk. None of that is in `agent.area_features` (it has only `min_to_*` for 8 fixed hubs, peak only, and `nearest_station_walk_min`), and `createEngine(areas, matrix, params, seed)` has no argument for it. Recon lists `station_access` and `locality_access` as public tables from migration 0014 with no `agent.*` view. The engine as specified cannot compute travel time to a user anchor.
**Fix.** Add a `localityAccess` input (locality, station group, walk minutes; ideally per sample point) and an anchor-to-station resolver result in `Profile`; say which object supplies it. If only locality-level access exists, say that the 9-point median is replaced by it.

### E03 · blocking · lines 137, 170, 224-227
**Problem.** The outcome probabilities do not sum to 1. Each outcome uses `(1 - eps) L + eps`, so a pair gives 1 + eps = 1.05 and a pick among five gives 1.20. In EVOI, `U` is negative and large (about minus the rent), so `sum_o P(o) max E[U | o]` is about 1.05 times a number near -100,000, and EVOI comes out near -5,000 yen. It never exceeds 0.3% of budget, so a pair question is never asked. The formula should be non-negative by construction.
**Fix.** Mix the floor as `(1 - eps) L + eps / n_outcomes`, or normalise P(o) over outcomes before use. Add the invariant "EVOI is never negative". Does not affect tonight's shortcut (line 229), only the full EVOI path.

### E04 · blocking · lines 65-78, 260
**Problem.** Null inputs are undefined. Per recon, `residential_zoning_share`, `road_rail_exposure_share`, `bar_count`, `line_count`, `reach_restaurant`, `rent_per_sqm_yen`, `management_fee_yen`, `land_value_yen_per_sqm` and `land_value_nearest_m` are nullable. The spec only excludes localities "with missing access values". A null feature gives `s_j = NaN`, which makes `U` NaN for every sample, and NaN in the greedy maximum silently corrupts the shortlist.
**Fix.** State per column: null rent or fee excludes the area (counted in `excluded`); null land value gives m(a) = 1 and sigma_R = 0.12; null amenity share or count gives s = 0 with a low-confidence label, or excludes. Add the invariant "no U is NaN or infinite".

## Should-fix

### E05 · should-fix · lines 145-146
**Problem.** `exp(U(c) / beta)` underflows. U is about -100,000 and beta is 0.03 B, so the exponent is about -33 in the normal case and below -700 once penalties apply or B is small; the ratio becomes 0 / 0.
**Fix.** Specify the softmax on `U - max over S`. Also accumulate weights as log weights and normalise once (line 137), since a long log multiplies many small numbers.

### E06 · should-fix · lines 173 vs 317
**Problem.** The text says an item is surprising below 0.15 for all types. The defaults table says 0.15 for two-outcome items and 0.5 / n for a pick among n. A fair pick among five has chance 0.2, so the flat rule flags ordinary taps.
**Fix.** Make line 173 match the table. See E07 for the types the table does not cover.

### E07 · should-fix · lines 148, 151-152, 170
**Problem.** `magnitude`, `like_area` and `dislike_area` likelihoods are not probabilities of an outcome, so p_e is not comparable to 0.15. The magnitude kernel peaks at 1 and its prior average is about 0.6 exp(-d^2 / 2), where d is the log ratio of tier to prior median; "essential" (8%) on a feature whose prior is 1% gives about 0.07, flagged as surprising with no conflict. `q^2` averages 1/3 under no information. p_e also ignores the strength exponent alpha.
**Fix.** Either exempt these types from the surprise check, or compare p_e with its value under the prior (a ratio threshold).

### E08 · should-fix · lines 94, 148, 154, 215, 227, 265
**Problem.** With no budget, B is replaced by "the median modelled rent of the reachable areas". Line 265 covers the prior and noise only; the magnitude tiers (`ln(B x tier)`), the stop threshold (1% of budget) and the EVOI threshold (0.3% of budget) also need B. "Reachable" is undefined before an anchor exists, and the value changes with layout and anchors, which silently rescales every prior draw and beta and tau mid-session.
**Fix.** Define one `scale` S used everywhere B appears as a scale (prior, beta, tau, tiers, thresholds); B itself only in the penalty. Define S with no anchor (median over all areas for the layout). State that samples are stored as fractions of S so a change of S is a deterministic rescale.

### E09 · should-fix · lines 85, 319
**Problem.** `t + max(3, 0.15 t) z` goes negative for short trips (t = 5 minutes is negative below z = -1.67, about 5% of samples), which makes travel a gain. One `z^t_ia` is shared by all anchors of an area, which is not stated as intended. The rent factor `e^(sigma z)` has mean `e^(sigma^2 / 2)`, so uncertain areas are biased dearer by about 0.7% of rent, close to the 1% stop threshold.
**Fix.** Clamp `t_im >= 1` minute (or a floor of the walk time). Say whether z is per anchor. Use `exp(sigma z - sigma^2 / 2)`.

### E10 · should-fix · lines 150, 159
**Problem.** `sigma((c_T - c*) / (0.25 c*))` divides by zero when yen is 0 or minutes is 0 ("I wouldn't pay anything"), and c* is infinite when trips per week is 0. "Trips per week" is ambiguous with several anchors. If the trip is past the commute cap, the person's rate per hour is `(1 + gamma) c_T`, not c_T, so the item is misread.
**Fix.** Reject items with yen <= 0, minutes <= 0 or n = 0 with a typed error; name the anchor in the item (default main anchor); note the over-cap case or restrict the question to under-cap minutes.

### E11 · should-fix · lines 160
**Problem.** `V(x) = U(x) + R(x)` removes rent but leaves the budget penalty `lambda_B [R - B]+`, so "like Shimokitazawa" is penalised when that area is over budget, against the stated intent ("everything except rent"). With noisy inputs it is unclear whether R or R_i is added. q is ranked "among all areas", but U does not exist for areas outside F, and x itself may be outside F.
**Fix.** `V_i(x) = U_i(x) + R_i(x) + lambda_B [R_i(x) - B]+`. Rank over all areas with access values, ignoring firm limits. Define q as (rank - 0.5) / n so it is never exactly 0 or 1. Say what happens when x has no access values (reject the item).

### E12 · should-fix · lines 26, 41, 183, 330, 333
**Problem.** The firm-limit filter needs one rent and one time per area, but U uses the per-sample noisy R_i and t_i. The spec does not say which the filter uses; with noisy values F would differ per sample and the invariants on lines 330 and 333 could not hold. The commute cap is stated in minutes one way (line 246) but compared in monthly hours (line 33); with 0 trips per week both sides are 0 and a firm cap never binds.
**Fix.** State: firm limits test the point estimates R(a) and one-way `t_1(a)` in minutes. Give the conversion `T_C = cap_min x 2 x n_1 x 52 / 12 / 60` for the soft penalty.

### E13 · should-fix · lines 199, 242-244
**Problem.** "The parameter whose mean differs most" compares parameters in different units (yen per hour, yen per month, plain numbers) with no standardisation. The ratio of means in `whyNot` step 2 divides by an overall mean that is near zero or negative for bars (archetype medians 0 and -3), giving huge or sign-flipped ratios. In step 3, G can be zero or negative because the top pick by expected value over samples need not be best at the mean parameters; the factor `1 + G / D_d` is then 1 or less. The rent term has no weight to grow.
**Fix.** Standardise by the prior or overall weighted standard deviation for Role; in step 2 use that z-score, and phrase as a ratio only for one-sided parameters. In step 3 exclude the rent term and return "already ahead at your average preferences" when G <= 0.

### E14 · should-fix · lines 128, 268
**Problem.** The redraw is skipped tonight, so nothing prevents collapse. With beta = 3% of budget and utilities that differ by tens of thousands of yen between areas, each pick is close to a hard cut, and strength 2 squares it; ESS can pass below 200 within a few items and can reach about 1, at which point every percentile, P_best and Risk is one sample. When built: the fitted variance is 0 at ESS near 1 (division by zero in q); the prior density must be the five-archetype mixture, not the sample's own archetype; the noise draws z must be redrawn too; "exact" should read "consistent".
**Fix.** Tonight: when ESS is below a hard floor (say 50), `recommend` sets a `degenerate` flag and the agent stops asking. In the redraw text: floor the fitted standard deviation, name the mixture prior and the z draws.

### E15 · should-fix · lines 229
**Problem.** The shortcut has no defined result when fewer than two shortlisted areas have P_best above 0.05 (one dominant area, or the dilution in E01).
**Fix.** Fall back to the top two by P_best, or return no pair question and let the stop rule decide.

### E16 · should-fix · lines 183, 258
**Problem.** Only F empty is defined. With 1 to 4 feasible areas "five times, add" has nothing to add. EUS of the empty set is a maximum over nothing.
**Fix.** Loop `min(k, |F|)` times; define the first step as the argmax of expected U; attach `relax` when |F| < k.

### E17 · should-fix · lines 328-329, 187
**Problem.** "Restores the previous weights exactly" and "any order gives the same weights" cannot hold bit for bit: floating-point products depend on order, and U is held as Float32.
**Fix.** Replay in a canonical order (by item id) and test with a tolerance (for example 1e-9 on weights), or say so in the test list.

### E18 · should-fix · lines 49, 321 (recon section 3)
**Problem.** The view's `rent_local_multiplier` and `rent_per_sqm_local_yen` are clamped 0.85 to 1.15 by `model_params`; the spec wants 0.7 to 1.4, so the engine must rebuild m(a) from `land_value_yen_per_sqm` and must not read those two columns. The ward median land value is not a column. The elasticity key is `rent_land_elasticity`; it exists only if the derive script has run, and its value was not measured (0.356 is unverified).
**Fix.** Name the inputs: `rent_per_sqm_yen`, `management_fee_yen`, `land_value_yen_per_sqm`; compute the ward median in the engine over non-null values; fall back to 0.356 with a warning when the key is absent.

## Minor

### E19 · minor · lines 67, 69, 80 (recon section 1)
`supermarket_count` is "supermarket-equivalents" and already includes weighted konbini and groceries, so it overlaps `convenience_count`. Line 80 says the first seven h values are `LIFESTYLE_SUFFICIENCY_TARGETS`; that holds (4, 40, 10, 12, 6, 8, 0.15 in `shared/src/config/scoring.ts`), and the bars value 6 matches `nightlifeForQuietness`. Fix: note the overlap, or lower the konbini prior.

### E20 · minor · lines 77-78
`reach_restaurant` is an index, not a count, and its h is a percentile that is 0 if most areas are 0; `s = 1 - 10^(-x / 0)` is undefined. `line_count` is a median over points and can be fractional. Fix: require h > 0 (floor at the smallest positive value), also after a profile statement multiplies h (line 163).

### E21 · minor · lines 147
`direction` on a one-sided feature carries little: every sample already has the stated sign, so the likelihood only separates samples within about 2 tau of zero. A statement against the fixed sign ("I like being near the tracks") gives L below 0.5 for every sample and changes nothing but the surprise flag. Fix: say so, or map such statements to `magnitude`.

### E22 · minor · lines 148
`ln abs(w_j)` is minus infinity at w = 0. Reachable only for bars (normal prior) with probability zero, but guard with `max(abs(w), 1e-9 B)`.

### E23 · minor · lines 130, 200, 237, 243
The interface shows weighted medians; the breakdown and `whyNot` use weighted means. For lognormal(…, 0.8) the mean is about 1.4 times the median, so the yen in "why this area" will not match the belief panel. Fix: pick one, or label both.

### E24 · minor · lines 185
The 63% guarantee needs a non-negative function with EUS of the empty set equal to 0. U is negative, so the ratio is meaningless as stated. Fix: state it for U shifted by the worst feasible expected value, or drop the number.

### E25 · minor · lines 51-54, 264
`2 t_m` assumes the return trip takes the same time in the same period; a peak outbound usually returns off-peak. Fix: state the assumption, or use peak out and off-peak back.

### E26 · minor · lines 215, 224
EVOI is defined for choosing one area, while Risk and the stop rule are defined for a set of five. The two thresholds (0.3% and 1% of budget) are therefore on different quantities. Fix: define EVOI as the expected rise in EUS of the best five.

### E27 · minor · lines 246
"The binding limit is the one with the larger gain at its first step" compares +5% of budget with +5 minutes, which are not equal-sized steps. Relax of a limit that was never set (no budget, no cap) is undefined. Fix: skip unset limits; compare gain per step as stated but label it as such.

### E28 · minor · lines 281, 291-302
"Exposes ten methods" matches the interface (ten). `recommend(k?)` accepts any k; no bound stated for k < 1 or k above |F| (see E16). `whyNot` and `compare` do not say what they return for an unknown `localityId`. Fix: typed error, as for malformed evidence.

## Checked and found consistent

- c_T prior: 3 B / 160 x 0.4 = B / 133, 750 yen per hour at B = 100,000 (line 98).
- lambda_B median 1 gives "about twice" (line 101); gamma median 3 gives "four times" (line 102).
- Travel conversion `52 / 12 x n x 2 t / 60` is hours per month (line 54) and matches the time trade-off conversion (line 159).
- `s_j(h) = 0.9` (line 62). Magnitude tiers 1, 2, 4, 8% (line 158).
- Defaults table agrees with the body on samples, beta, tau, epsilon, strengths, sigma_R, travel noise, clamp, ESS floor; the only disagreement is E06.
- No spec feature lacks a column: all twelve feature columns exist in the recon list.

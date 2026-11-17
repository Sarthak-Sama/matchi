# Matchi recommendation engine: logic, maths and edge cases

Nov 17, 2026 · @Yato

## What the engine does

The engine keeps a probability distribution over what one person values, measured in yen per month, and uses it to decide which five areas to show, what to ask next and when to stop asking. It never ranks areas by one fixed score.

One turn runs in five steps:

1. The agent turns what the person said into typed evidence.
2. Each piece of evidence reweights about 4,000 sampled versions of this person, each a full set of preferences.
3. Every area gets a monthly value in yen under every version.
4. The shortlist is the set of five areas with the highest expected value when the person picks their favourite from it.
5. The engine reports how much value is still at risk from not knowing the person better. Above a threshold it proposes the next question; below it, it commits.

Three properties hold throughout. Every area fact comes from the database, never from the language model. All quantities are in yen per month or minutes, so every trade-off can be said in plain words. A fixed random seed makes the same evidence produce the same shortlist.

Column names below follow the database plan; check them against the comments on `agent.area_features` before coding.

## The value of an area, in yen

An area's value to a person is what its amenities are worth to them, minus rent, minus the cost of their travel time, minus penalties for breaking soft limits.

```latex
U_\theta(a) = -R(a) - c_T\,T(a) + \sum_{j} w_j\, s_j(x_{aj}) - \lambda_B\,[R(a)-B]_+ - \gamma\, c_T\,[T_1(a)-T_C]_+
```

| Symbol | Meaning | Unit | Comes from |
| --- | --- | --- | --- |
| R(a) | Modelled monthly rent for the chosen layout | yen | Rent formula below |
| T(a) | Monthly hours in transit across all anchors | hours | Travel-time matrix |
| T\_1(a), T\_C | Monthly hours to the main anchor, and the same for the stated commute cap | hours | Matrix, profile |
| c\_T | What an hour of travel costs this person | yen per hour | Belief |
| x\_aj | Raw feature j of area a | count or share | `agent.area_features` |
| s\_j | Saturating curve from 0 to 1 | none | Fixed per feature |
| w\_j | What having plenty of feature j is worth, against none; may be negative | yen per month | Belief |
| B, lambda\_B | Budget, and extra pain per yen over it | yen, none | Profile, belief |
| gamma | Extra cost multiplier for hours beyond the cap | none | Belief |

The bracket with a plus sign means "zero if negative". A firm limit is not a penalty: areas that break it are removed before scoring.

**Rent.** Ward rent per square metre, shifted by local land value, times the layout's area, plus the ward management fee.

```latex
R(a) = r_{w(a)}\, m(a)\, A_\ell + f_{w(a)}, \qquad m(a) = \mathrm{clip}\left( \left( L_a / \tilde{L}_{w(a)} \right)^{\varepsilon},\ 0.7,\ 1.4 \right)
```

L\_a is `land_value_yen_per_sqm`; the tilde value is the median of L\_a over the localities of the same ward; epsilon is 0.356 from `model_params`; A is the layout's mid size from `LAYOUTS`. The clamp is wider than the stored 0.85 to 1.15 because 129 localities sit at that bound.

**Travel time.** Round trips per week n\_m to each anchor m, one-way minutes t\_m(a) in that anchor's period, converted to hours per month.

```latex
T(a) = \frac{52}{12} \sum_{m} n_m \cdot \frac{2\, t_m(a)}{60}
```

t\_m(a) is computed as `localityCommute` does today: for each of the locality's 9 sample points take the best of its 3 nearest stations (walk, plus matrix minutes, plus destination walk), then take the median across points.

**Saturation.** More of an amenity helps less and less. h\_j is the amount that counts as enough: at x = h\_j the curve reaches 0.9.

```latex
s_j(x) = 1 - 10^{-x / h_j}
```

| Feature | Column | Enough (h) | Sign of w |
| --- | --- | --- | --- |
| Supermarkets | `supermarket_count` | 4 | Positive |
| Restaurants and cafes | `restaurant_count + cafe_count` | 40 | Positive |
| Konbini | `convenience_count` | 10 | Positive |
| Cuisine variety | `cuisine_variety_count` | 12 | Positive |
| Late-night food | `late_night_count` | 6 | Positive |
| Everyday health | `health_count` | 8 | Positive |
| Green space | `green_space_share` | 0.15 | Positive |
| Residential calm | `residential_zoning_share` | 0.6 | Positive |
| Road and rail exposure | `road_rail_exposure_share` | 0.5 | Negative |
| Bars nearby | `bar_count` | 6 | Either |
| Dining a short ride away | `reach_restaurant` | 75th percentile across areas | Positive |
| Connectedness | `line_count` | 3 | Positive |

The first seven h values are the existing `LIFESTYLE_SUFFICIENCY_TARGETS`; the rest are starting values.

**Uncertain inputs.** Rent and travel time are estimates, so each sampled person sees a slightly different rent and travel time for each area.

```latex
R_i(a) = R(a)\, e^{\sigma_R(a)\, z^{R}_{ia}}, \qquad t_{i,m}(a) = t_m(a) + \max(3,\ 0.15\, t_m(a))\; z^{t}_{ia}
```

The z values are standard normal draws, fixed per sample i and area a for the whole session. sigma\_R is 0.08 when `land_value_nearest_m` is at most 300 and 0.12 otherwise. These are starting values until `commute_error_model` exists. The effect: two areas three minutes apart are treated as a near tie, which is correct given that every rail edge is an estimate.

## The belief about the person

The belief is 4,000 weighted samples of the parameter vector theta = (c\_T, w\_1 to w\_12, lambda\_B, gamma). Each sample is one plausible version of the person; its weight pi\_i starts at 1/4000 and changes with evidence.

**Scale-free prior.** Every yen parameter is drawn as a fraction of the budget B, so one prior serves a 70,000 yen student and a 250,000 yen couple. With no budget stated, use the median modelled rent of the reachable areas in place of B.

| Parameter | Prior | Why |
| --- | --- | --- |
| c\_T | (B / 133) x archetype multiplier x lognormal(0, 0.7) | Rule of thumb: rent near a third of take-home pay, about 160 paid hours a month, travel time valued near 40% of hourly pay. At B = 100,000 the median is about 750 yen per hour |
| w\_j, one-sided | B x (archetype percent / 100) x lognormal(0, 0.8) | Wide on purpose; the sign is fixed by the feature table |
| w\_j, either sign (bars) | Normal with mean B x (archetype percent / 100) and standard deviation 0.03 B | Lets one person like bars and another avoid them |
| lambda\_B | lognormal(ln 1, 0.7) | A yen over budget hurts about twice as much as a yen under it |
| gamma | lognormal(ln 3, 0.5) | Minutes beyond the stated cap cost three times extra, so four times a normal minute |

**Archetypes.** Each sample is assigned one of five archetypes at random, which sets its medians. The numbers are percent of budget, hand-set starting values. They only need to be plausible and wide: the first two or three pieces of evidence move the weight to the right mixture.

| Feature | Student | Young professional | Couple | Family | Remote worker |
| --- | --- | --- | --- | --- | --- |
| Supermarkets | 3 | 2 | 4 | 5 | 4 |
| Restaurants and cafes | 2 | 4 | 4 | 2 | 4 |
| Konbini | 3 | 3 | 1 | 1 | 2 |
| Cuisine variety | 1 | 3 | 3 | 1 | 2 |
| Late-night food | 3 | 3 | 1 | 0.5 | 1 |
| Everyday health | 1 | 1 | 2 | 4 | 2 |
| Green space | 1 | 2 | 3 | 5 | 4 |
| Residential calm | 1 | 2 | 3 | 5 | 4 |
| Road and rail exposure | -1 | -2 | -3 | -4 | -4 |
| Bars nearby | +2 | +2 | 0 | -3 | 0 |
| Dining a short ride away | 2 | 3 | 2 | 1 | 2 |
| Connectedness | 2 | 3 | 2 | 1 | 1 |
| Time multiplier for c\_T | 0.7 | 1.3 | 1.0 | 1.0 | 0.5 |

**Health of the belief.** The effective sample size says how many samples still carry weight.

```latex
\mathrm{ESS} = 1 \Big/ \sum_i \pi_i^2
```

Below 200, redraw: fit an independent normal to the weighted samples (in log space for one-sided parameters), widen it by 1.5, draw 4,000 new samples from that proposal q, and set each weight to prior x all evidence likelihoods / q. Because the evidence log is replayed in full, the redraw is exact, not an approximation. For tonight, compute and display the effective sample size and skip the redraw.

**What the interface shows.** For each parameter: the weighted median and the 10th to 90th percentile range, as a share of budget. The range shrinking as the person talks is the visible form of learning.

## Evidence

Every statement or tap becomes one typed evidence item with a likelihood: how probable that statement is if the person were sample theta. Applying it multiplies each sample's weight by its likelihood, then renormalises.

```latex
\pi_i \leftarrow \pi_i \cdot \bigl( (1-\epsilon)\, L_e(\theta_i) + \epsilon \bigr)^{\alpha_e}, \qquad \epsilon = 0.05
```

The epsilon floor assumes a 5% chance any statement was misheard or mistranslated, so one contradictory remark can never zero out the belief. alpha is the strength the agent assigns: 0.5 weak, 1 normal, 2 strong.

| Type | Example | Likelihood L(theta) |
| --- | --- | --- |
| `prefer_area` (a over b) | "I'd take Koenji over Nakano" | sigma((U(a) - U(b)) / beta) |
| `pick_from_set` (c from S) | Taps one of the five cards | exp(U(c) / beta) / sum over s in S of exp(U(s) / beta) |
| `reject_area` (a from S) | "Not that one" | 1 minus the pick probability of a in S |
| `direction` (feature j, sign) | "I hate noise" | sigma(sign x w\_j / tau) |
| `magnitude` (feature j, tier) | "Green space is essential" | exp(-(ln abs(w\_j) - ln(B x tier))^2 / (2 x 0.6^2)) |
| `compare_importance` (j over k) | "Quiet matters more than food" | sigma((abs(w\_j) - abs(w\_k)) / tau) |
| `time_tradeoff` (yen, minutes, accept) | "I'd pay 10,000 more to save 15 minutes each way" | sigma(+/-(c\_T - c\*) / (0.25 c\*)), plus if accepted |
| `like_area` (x) | "Somewhere like Shimokitazawa" | q(x)^2 |
| `dislike_area` (x) | "Nothing like Roppongi" | (1 - q(x))^2 |

sigma is the logistic function 1 / (1 + e^-z). The noise scales are beta = 0.03 B for area choices and tau = 0.01 B for statements about weights.

**Details per type**

- **Magnitude tiers** are low 1%, medium 2%, high 4%, essential 8% of budget. They double per step, matching the existing `IMPORTANCE_VALUES` of 1, 2, 4, 8.
- **Time trade-off.** c\* is the hourly rate the statement implies: yen divided by monthly hours saved, where hours saved = minutes x 2 x trips per week x 52 / 12 / 60. Accepting says c\_T is above c\*; declining says below.
- **Like and dislike.** q(x) is the percentile rank, among all areas, of the non-price value V(x) = U(x) + R(x) under theta. "Like X" favours versions of the person under which X ranks high on everything except rent. "But cheaper" needs no evidence: the rent term already rewards it.
- **A reaction to a card**, such as "too suburban" or "too far", is translated by the agent into `direction` or `time_tradeoff` items, at weak strength.

**Profile facts are not evidence.** Anchors, trips per week, layout, budget and commute cap, each cap marked firm or soft, go into the profile. A firm limit filters areas; a soft one becomes the penalty term. "I want lots of restaurants, not just enough" also edits the profile: it multiplies that feature's h.

**Replay, not accumulation.** The belief is always the prior times the likelihoods of the items currently in the log. Adding, editing or deleting an item recomputes from the prior. Order therefore never matters, and deleting a chip in the interface exactly undoes it.

**Surprise.** Before applying an item, compute how expected it was:

```latex
p_e = \sum_i \pi_i \bigl( (1-\epsilon)\, L_e(\theta_i) + \epsilon \bigr)
```

Below 0.15 the item is flagged as surprising. The engine also names the earlier item it conflicts with most: the one whose removal raises p\_e the most. The agent then says so, for example "you said budget is firm, but you keep preferring places above it".

## The shortlist

The shortlist is chosen as a set, not as the top five by score: it is the five areas that give the highest expected value when the person picks their own favourite among them.

```latex
\mathrm{EUS}(S) = \sum_i \pi_i \max_{a \in S} U_i(a)
```

**Algorithm.** Let F be the feasible areas: those that pass every firm limit and have access values. Start with S empty. Five times, add the area in F that raises EUS(S) the most. The first pick is therefore the area with the highest expected value.

**Why this works.** EUS is monotone and submodular, so the greedy set is guaranteed to reach at least 63% of the best possible set, and in practice far more. A near-duplicate of an area already chosen adds almost nothing, so the list diversifies on its own: each added area is there because it is the best answer for some share of the plausible versions of the person.

**Cost.** Hold U as a `Float32Array` of 4,000 x 937 values, recomputed when the profile changes. One shortlist is 5 x 937 x 4,000, about 19 million operations, which runs in tens of milliseconds.

**What each shortlisted area carries**

```latex
P_{\mathrm{best}}(a) = \sum_i \pi_i\, \mathbf{1}\bigl[a = \arg\max_{b \in F} U_i(b)\bigr], \qquad \mathrm{Regret}(a) = \sum_i \pi_i \bigl( \max_{b \in F} U_i(b) - U_i(a) \bigr)
```

| Output | Definition | Shown as |
| --- | --- | --- |
| Chance of being the best | P\_best above | "Top pick in 41% of plausible versions of you" |
| Regret | Expected yen per month lost by choosing it over the true best | "About 3,000 yen a month from ideal" |
| Role | Among samples where this area is the best in S, the parameter whose mean differs most from the overall mean | "Best if your time matters most" |
| Breakdown | Each term of U at the weighted mean parameters, and its difference from the median feasible area | Rent, time cost and each amenity in yen |
| Confidence | Rent confidence, land-value distance, commute error band | A plain label per number |

Show the five in order of P\_best. The example figures in the table are illustrations, not results.

## Ask or stop

The engine asks another question only while the answer could change the recommendation by an amount worth the person's time, measured in yen per month.

**Value at risk.** How much the person loses, on average, by having only this shortlist to pick from.

```latex
\mathrm{Risk}(S) = \sum_i \pi_i \Bigl( \max_{b \in F} U_i(b) - \max_{a \in S} U_i(a) \Bigr)
```

**Stop when** Risk(S) is under 1% of budget, or six questions have been asked, or the person asks for the answer. The agent can say it plainly: "what I still don't know about you is worth under 1,000 yen a month".

**Which question, in order of preference**

1. **A missing profile fact.** Anchor, trips per week, layout or budget. Nothing else can be asked well without these.
2. **The shortlist itself.** "Which of these feels closest?" The set that maximises EUS is also the most informative choice to put in front of someone when answers are noise-free, and close to it otherwise (Viappiani and Boutilier, 2010). So showing the cards and reading the tap is the default question.
3. **A pair of real areas.** When a sharper answer is needed, pick the pair from the shortlist with the highest expected value of information.

```latex
\mathrm{EVOI}(q) = \sum_{o} P(o)\, \max_{a \in F} \mathbb{E}\bigl[U(a) \mid o\bigr] - \max_{a \in F} \mathbb{E}\bigl[U(a)\bigr]
```

For a pair (a, b) the outcomes o are "a" and "b". P(o) is the predictive probability from the surprise formula; each conditional expectation reweights the samples by that outcome's likelihood. Ten pairs x two outcomes x 3.7 million operations stays well under a second. Ask only if the best EVOI exceeds 0.3% of budget.

**Tonight's shortcut for step 3.** Among shortlisted areas with P\_best above 0.05, take the pair whose probability that a beats b is closest to one half.

Questions are always phrased with real areas and their real numbers, never as abstract sliders: "Koenji at 82,000 and 38 minutes, or Kami-Igusa at 74,000 and 52?" The figures in that example are placeholders.

## Explanations

Every explanation is computed from the same samples and utilities, so it cannot disagree with the recommendation. The agent only phrases what these functions return.

**Why this area.** The yen breakdown at the weighted mean parameters, with the two largest gains and the two largest losses against the median feasible area. Example shape: "8,000 a month cheaper than typical for you, 5 hours a month more travel".

**Why not area x.** Let a\* be the top pick.

1. If x fails a firm limit, say which and by how much, and stop.
2. Let W be the samples under which x is the best feasible area. If their weight is at least 1%, compute for each parameter the ratio of its mean within W to its overall mean, and report the parameter with the largest ratio: "x wins for people who value late-night food about 2.5 times as much as you seem to; that is 4% of plausible versions of you".
3. Otherwise work at the mean parameters. Let G = U(a\*) - U(x) and, for each term d, let D\_d be x's contribution minus a\*'s. For each d with D\_d above zero, the weight on d would need to grow by the factor 1 + G / D\_d. Report the smallest factor.
4. If no D\_d is above zero, x is no better than a\* on anything this person values. Say that plainly.

**Relax.** For each limit, try fixed steps (budget +5%, +10%, +20%; commute cap +5, +10, +15 minutes). For each step return how many areas become feasible and how much the best expected value rises, in yen per month. The binding limit is the one with the larger gain at its first step. This replaces the current "no areas fit" suggestion and also runs when plenty of areas fit.

**Compare a and b.** The term-by-term yen difference at the mean parameters, plus the probability that a beats b across samples.

**If I'm wrong about you.** Among samples where a\* is not the best, the area that wins most often, with the parameter that distinguishes those samples. Shown as one extra card.

## Edge cases

Each of these has a defined behaviour; none may return an empty or silent result.

| Situation | What the engine does |
| --- | --- |
| No area passes the firm limits | Returns an empty shortlist with the `relax` table attached; the agent must present the nearest options, never "nothing found" alone |
| Anchor outside the 23 wards, or no station within 1,500 m of it | Refuses that anchor with a reason; the agent asks for the nearest station inside coverage and says the commute beyond it is not counted |
| Locality with missing access values (the Ukima case) | Excluded from F and counted in an `excluded` summary |
| Station pair not connected in the matrix | The area is infeasible for that anchor; counted as disconnected |
| Anchor inside or beside the locality | Uses the existing walk estimate; time cost still applies |
| Anchors in different periods (school at peak, a late shift off-peak) | Each anchor reads its own period from the matrix |
| Late-night return trips | Travel time is computed, but the result carries a flag: last trains are not in the data |
| No budget given | Uses the median modelled rent of reachable areas as the scale for the prior and noise; no budget penalty |
| Budget firm and soft in different statements | The latest profile statement wins; if choices contradict it, the surprise check raises it |
| Contradictory evidence | The 5% floor keeps the belief alive; the item is flagged with the item it conflicts with |
| Effective sample size under 200 | Redraw from the adaptive proposal; until that is built, show a low-confidence badge |
| Evidence deleted or edited | Full replay from the prior |
| Layout changed | Recompute R for all areas, then U |
| Two near-identical neighbouring areas | The set objective picks one; the other shows as "similar nearby" if its features are within a small distance |
| An amenity far above "enough" | Extra count adds almost nothing by design; only a profile statement raising h changes that |
| A feature the person dislikes | Negative w; the same curve applies |
| Rent estimate with a distant land-price point | Wider sigma\_R, so the area's rank is less certain and its label says so |
| The person names an area the data does not have | `find_area` returns no match; the agent offers the closest names |
| The agent sends a malformed or unknown evidence type | Rejected with a typed error; nothing is applied |
| Same session reopened | Restored from profile, evidence log and seed; the belief is recomputed, not stored |

## Interface, defaults and tests

The engine is pure TypeScript with no database or model access: it is constructed from arrays already loaded in memory and exposes ten methods.

```ts
function createEngine(
  areas: AreaFeatures[],      // rows of agent.area_features
  matrix: TravelMatrix,       // station-to-station minutes, peak and off-peak
  params: ModelParams,        // rent elasticity and other fitted constants
  seed: number
): Engine;

interface Engine {
  setProfile(p: Profile): ProfileResult;           // anchors, layout, limits; reports refused anchors
  observe(e: Evidence): ObserveResult;             // { id, predictive, surprising, conflictsWith? }
  removeEvidence(id: string): void;                // replays from the prior
  recommend(k?: number): Recommendation;           // shortlist, risk, shouldStop, nextQuestion, excluded
  whyNot(localityId: string): WhyNot;
  relax(): RelaxOption[];
  compare(a: string, b: string): Comparison;
  beliefSummary(): BeliefSummary;                  // median and 10-90 range per parameter, ESS
  snapshot(): SessionState;                        // profile, evidence log, seed
  restore(s: SessionState): void;
}
```

**Default values.** All are starting points to tune with the simulated-user evaluation in the build plan.

| Setting | Value |
| --- | --- |
| Samples | 4,000 |
| Shortlist size | 5 |
| Choice noise beta | 3% of budget |
| Statement noise tau | 1% of budget |
| Mishearing floor epsilon | 0.05 |
| Strength exponents | 0.5, 1, 2 |
| Stop threshold | Risk under 1% of budget, or 6 questions |
| Minimum EVOI to ask a pair question | 0.3% of budget |
| Surprise threshold | 0.15 for two-outcome items; half of chance (0.5 / n) for a pick among n |
| Rent noise sigma\_R | 0.08 near a price point, 0.12 otherwise |
| Travel-time noise | 15% of minutes, at least 3 minutes |
| Local rent clamp | 0.7 to 1.4 |
| Rent elasticity | 0.356, read from `model_params` |
| Effective sample size floor | 200 |

**Invariant tests.** These hold for any input and belong in Vitest beside the existing scoring tests.

- Weights are non-negative and sum to 1 after every operation.
- With no evidence, the belief summary equals the prior summary.
- Adding an item and then removing it restores the previous weights exactly.
- Applying the same items in any order gives the same weights.
- No area that breaks a firm limit ever appears in a shortlist.
- P\_best over the feasible set sums to 1.
- Risk(S) is never negative and does not rise when the shortlist grows.
- Raising the budget never reduces the number of feasible areas.
- The same seed, profile and evidence give an identical shortlist.
- A `prefer_area` item for a over b never lowers the probability that a beats b.

**Known limits.** Utility is additive: it cannot express "only matters if". The prior numbers are hand-set. Rent is ward-anchored and every travel time is an estimate, which is why both carry noise. The archetypes and the value-of-time rule are assumptions to replace with learned values once real sessions exist.

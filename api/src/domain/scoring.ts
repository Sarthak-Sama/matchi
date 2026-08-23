/**
 * Scoring, hard filters, ranking, and explanations — pure functions over
 * precomputed `neighborhood_metrics` columns plus a commute estimate. No
 * database access happens here (Task 10 does the querying and hands this
 * module plain data); every formula constant is imported from
 * `@tokyo/shared`'s `config/scoring.ts` rather than re-typed.
 *
 * This is where the product's actual opinion lives: which candidates
 * survive the hard filters, how they're scored, and why. Every point on
 * `overallScore` must be traceable to a `FactorEvidence` entry in
 * `factors`, and every `factors[].pointContribution` must be explainable
 * from its own `componentScore` and `effectiveWeight`.
 */

import type {
  Confidence,
  FactorEvidence,
  NeighborhoodResult,
  OptimizationRequest,
} from "@tokyo/shared";
import {
  AFFORDABILITY_FULL_SCORE_RATIO,
  CATCHMENT_LABEL,
  COMMUTE_FULL_SCORE_MINUTES,
  COMMUTE_LABEL,
  IMPORTANCE_VALUES,
  LIFESTYLE_AXES,
  LIFESTYLE_AXIS_IDS,
  OVERALL_WEIGHTS,
  REASON_NEGATIVE_THRESHOLD,
  REASON_POSITIVE_THRESHOLD,
  RENT_LABEL,
} from "@tokyo/shared";
import type { RentEstimateResult } from "@tokyo/shared";

import { LIFESTYLE_AXIS_DESCRIBERS } from "./lifestyle-axis-describe.js";
import type { CommuteEstimateResult } from "./transit/commute.js";

// ---------------------------------------------------------------------------
// Input shapes
// ---------------------------------------------------------------------------

/**
 * Every axis's `norm_*` (0-100) column from `pnpm derive`'s normalization
 * step, plus the raw counts behind the two amenity axes (used for
 * human-readable `rawValueLabel`s — see the worked example in the task
 * report) and a single source date/confidence pair covering all of them.
 * `neighborhood_metrics` has no per-axis confidence column (only
 * `rent_confidence`), so one bundle-level confidence for the whole
 * derived-metrics row is the honest representation of what the pipeline
 * actually knows.
 *
 * Deliberately a hand-written, named-field interface rather than a
 * `Record<string, number>` generated from `LIFESTYLE_AXES`: it is the
 * tripwire that makes a new registry axis fail to compile in
 * `lifestyle-axis-describe.ts` until the metric it reads actually exists.
 * Each field name is an axis's `metricsKey` (or a describer's declared raw
 * column).
 */
export interface LifestyleMetricsInput {
  readonly normFloodSafety: number;
  readonly normAmenitySupermarket: number;
  readonly normAmenityRestaurant: number;
  readonly normQuietness: number;
  readonly supermarketCount: number;
  readonly restaurantCount: number;
  readonly cafeCount: number;
  readonly sourceDate: string | null;
  readonly confidence: Confidence;
}

/**
 * One station area, fully assembled by the caller (Task 10) from
 * `station_groups`/`wards`, a `RentEstimateResult` (`@tokyo/shared`'s
 * `estimateRent`), a `CommuteEstimateResult` (`estimateCommute`, or `null`
 * when the station is unreachable from the requested destination — the
 * "disconnected" hard-filter case), and `LifestyleMetricsInput`.
 */
export interface Candidate {
  readonly stationGroupId: string;
  readonly nameEn: string;
  readonly nameJa: string;
  readonly wardCode: string;
  readonly wardNameEn: string;
  readonly wardNameJa: string;
  readonly centroid: { readonly lat: number; readonly lon: number };
  readonly rent: RentEstimateResult;
  readonly commute: CommuteEstimateResult | null;
  readonly lifestyle: LifestyleMetricsInput;
}

// ---------------------------------------------------------------------------
// applyHardFilters
// ---------------------------------------------------------------------------

export interface HardFilterDiagnostics {
  readonly candidatesConsidered: number;
  readonly excludedByRent: number;
  readonly excludedByCommute: number;
  readonly excludedByDisconnected: number;
  readonly feasibleCount: number;
  readonly suggestion: string | null;
}

export interface HardFilterResult {
  readonly feasible: readonly Candidate[];
  readonly diagnostics: HardFilterDiagnostics;
}

/**
 * Applies the three hard filters in spec order — disconnected, then
 * commute, then rent — counting each candidate under the FIRST rule it
 * fails. This first-match-wins ordering is what makes
 * `excludedByDisconnected + excludedByCommute + excludedByRent +
 * feasibleCount === candidatesConsidered` hold unconditionally: every
 * candidate takes exactly one of the four `continue`/fall-through paths
 * below, never more than one.
 *
 * Preferences (lifestyle importance) never appear here — "essential" is a
 * *weight* used later by `scoreLifestyle`/`scoreCandidate`, not a filter.
 * A candidate can have essential-but-terrible lifestyle metrics and still
 * be `feasible`; it will simply score low.
 */
export function applyHardFilters(
  candidates: readonly Candidate[],
  request: OptimizationRequest,
): HardFilterResult {
  const feasible: Candidate[] = [];

  let disconnectedCount = 0;
  let commuteExcludedCount = 0;
  const commuteExcludedMinutes: number[] = [];
  let rentExcludedCount = 0;
  const rentExcludedMedians: number[] = [];

  for (const candidate of candidates) {
    const commute = candidate.commute;

    if (!commute) {
      disconnectedCount += 1;
      continue;
    }

    if (commute.totalMinutes > request.maxCommuteMinutes) {
      commuteExcludedCount += 1;
      commuteExcludedMinutes.push(commute.totalMinutes);
      continue;
    }

    if (candidate.rent.medianYen > request.monthlyBudgetYen) {
      rentExcludedCount += 1;
      rentExcludedMedians.push(candidate.rent.medianYen);
      continue;
    }

    feasible.push(candidate);
  }

  const candidatesConsidered = candidates.length;

  const suggestion =
    feasible.length === 0
      ? buildSuggestion({
          candidatesConsidered,
          disconnectedCount,
          commuteExcludedCount,
          commuteExcludedMinutes,
          rentExcludedCount,
          rentExcludedMedians,
        })
      : null;

  return {
    feasible,
    diagnostics: {
      candidatesConsidered,
      excludedByRent: rentExcludedCount,
      excludedByCommute: commuteExcludedCount,
      excludedByDisconnected: disconnectedCount,
      feasibleCount: feasible.length,
      suggestion,
    },
  };
}

/**
 * Only called when `feasible.length === 0`. Names the exclusion rule that
 * removed the most candidates (ties broken by filter priority order:
 * disconnected, then commute, then rent — the same order the filters
 * themselves run in) and derives a concrete relaxation from the data
 * behind that rule, rather than a hard-coded guess:
 *   - rent: the 25th percentile of the excluded candidates' rent medians,
 *     rounded to the nearest ¥1,000.
 *   - commute: the 25th percentile of the excluded candidates' total
 *     commute minutes, rounded to the nearest minute.
 *   - disconnected: there is no numeric threshold to relax (no route
 *     exists at all), so the suggestion names the count and points at
 *     changing the destination/arrival time instead.
 */
function buildSuggestion(input: {
  readonly candidatesConsidered: number;
  readonly disconnectedCount: number;
  readonly commuteExcludedCount: number;
  readonly commuteExcludedMinutes: readonly number[];
  readonly rentExcludedCount: number;
  readonly rentExcludedMedians: readonly number[];
}): string | null {
  const {
    candidatesConsidered,
    disconnectedCount,
    commuteExcludedCount,
    commuteExcludedMinutes,
    rentExcludedCount,
    rentExcludedMedians,
  } = input;

  if (candidatesConsidered === 0) return null;

  const reasons = [
    { key: "disconnected" as const, count: disconnectedCount },
    { key: "commute" as const, count: commuteExcludedCount },
    { key: "rent" as const, count: rentExcludedCount },
  ];
  const dominant = reasons.reduce((best, reason) => (reason.count > best.count ? reason : best));

  if (dominant.count === 0) return null;

  const prefix = "No areas fit.";

  if (dominant.key === "disconnected") {
    return (
      `${prefix} No commute route was found for ${dominant.count} of ${candidatesConsidered} ` +
      `areas — try a different destination station or arrival time.`
    );
  }

  if (dominant.key === "commute") {
    const sortedMinutes = [...commuteExcludedMinutes].sort((a, b) => a - b);
    const suggestedMinutes = Math.round(percentile(sortedMinutes, 0.25));
    return (
      `${prefix} Commute excluded ${dominant.count} of ${candidatesConsidered} areas — try ` +
      `raising the max commute to about ${suggestedMinutes} minutes.`
    );
  }

  const sortedMedians = [...rentExcludedMedians].sort((a, b) => a - b);
  const suggestedBudget = Math.round(percentile(sortedMedians, 0.25) / 1000) * 1000;
  return (
    `${prefix} Rent excluded ${dominant.count} of ${candidatesConsidered} areas — try raising ` +
    `the budget to about ¥${suggestedBudget.toLocaleString("en-US")}.`
  );
}

/**
 * Linear-interpolation percentile (the "R-7" / Excel `PERCENTILE.INC`
 * method) over an ALREADY-SORTED-ASCENDING, non-empty array. `p` is a
 * fraction in `[0, 1]` (e.g. `0.25` for the 25th percentile).
 */
function percentile(sortedAscending: readonly number[], p: number): number {
  const n = sortedAscending.length;
  if (n === 0) {
    throw new Error("percentile: empty input");
  }
  const idx = p * (n - 1);
  const lowerIdx = Math.floor(idx);
  const upperIdx = Math.ceil(idx);
  const lower = sortedAscending[lowerIdx];
  const upper = sortedAscending[upperIdx];
  if (lower === undefined || upper === undefined) {
    throw new Error("percentile: index out of range");
  }
  const weight = idx - lowerIdx;
  return lower + (upper - lower) * weight;
}

/**
 * Rounds to one decimal place. Used to round every `FactorEvidence`'s
 * `pointContribution` AT THE POINT IT'S STORED, so that `overallScore` (the
 * sum of those already-rounded contributions — see `scoreCandidate`) is
 * guaranteed to equal what a reader gets by adding up the displayed
 * contributions by hand. Rounding the total separately from its parts, as
 * an earlier version of this module did, only reconciles by coincidence
 * (when the unrounded total already happens to land on a 0.1 boundary) —
 * see the "point contributions sum to overallScore" tests for a
 * non-boundary counterexample.
 */
function roundToOneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

// ---------------------------------------------------------------------------
// scoreAffordability
// ---------------------------------------------------------------------------

/**
 * 100 when `rentMedianYen` is at or below `AFFORDABILITY_FULL_SCORE_RATIO`
 * (0.6) of `budgetYen`, 0 when it is at or above `budgetYen`, linear
 * between.
 */
export function scoreAffordability(rentMedianYen: number, budgetYen: number): number {
  const fullScoreThreshold = budgetYen * AFFORDABILITY_FULL_SCORE_RATIO;

  if (rentMedianYen <= fullScoreThreshold) return 100;
  if (rentMedianYen >= budgetYen) return 0;

  return (100 * (budgetYen - rentMedianYen)) / (budgetYen - fullScoreThreshold);
}

// ---------------------------------------------------------------------------
// scoreCommute
// ---------------------------------------------------------------------------

/**
 * 100 at or below `COMMUTE_FULL_SCORE_MINUTES` (15), 0 at or above
 * `maxCommuteMinutes`, linear between.
 */
export function scoreCommute(totalMinutes: number, maxCommuteMinutes: number): number {
  if (totalMinutes <= COMMUTE_FULL_SCORE_MINUTES) return 100;
  if (totalMinutes >= maxCommuteMinutes) return 0;

  return (
    (100 * (maxCommuteMinutes - totalMinutes)) / (maxCommuteMinutes - COMMUTE_FULL_SCORE_MINUTES)
  );
}

// ---------------------------------------------------------------------------
// scoreLifestyle
// ---------------------------------------------------------------------------

export interface LifestyleScoreResult {
  readonly score: number;
  readonly factors: readonly FactorEvidence[];
}

/**
 * Effective share for axis _i_ is
 * `IMPORTANCE_VALUES[pref_i] / sum(IMPORTANCE_VALUES[pref_j] for all SELECTED j)`
 * — "essential" (8) is the strongest possible weight, never a filter.
 * `score` is the weighted sum of the selected axes' normalized (0-100)
 * scores (`Σ componentScore_i * share_i`), so it stays on a 0-100 scale;
 * each factor's `effectiveWeight` is that same share scaled into the
 * OVERALL score (`OVERALL_WEIGHTS.lifestyle * share_i`), so
 * `Σ factors[].pointContribution === OVERALL_WEIGHTS.lifestyle * score`.
 *
 * An axis the request left out is OMITTED, not weighted zero: it produces
 * no `FactorEvidence`, so it can never surface in `factors` or in
 * `reasonsFor`/`reasonsAgainst`.
 *
 * Lifestyle stays `OVERALL_WEIGHTS.lifestyle` (40%) of the overall score no
 * matter how many axes are selected — the shares RENORMALIZE over the
 * selected axes and always sum to 1. Rating one axis instead of four does
 * not make lifestyle count for less; it concentrates the same 40% on that
 * one axis. (Writing this down because "fewer axes should count less" is a
 * plausible misreading, and "fixing" it would silently rescale every score.)
 */
export function scoreLifestyle(
  metrics: LifestyleMetricsInput,
  preferences: OptimizationRequest["preferences"],
): LifestyleScoreResult {
  // Registry order, so `factors` ordering is stable and independent of the
  // key order of whatever object the caller built.
  const selected = LIFESTYLE_AXIS_IDS.flatMap((id) => {
    const importance = preferences[id];
    return importance === undefined ? [] : [{ id, importance }];
  });

  // With nothing selected there is no share to compute: `importanceTotal`
  // would be 0, every share `NaN`, and the `NaN` would propagate into
  // `overallScore` and then into `rankCandidates`'s comparisons, which
  // silently produce an arbitrary order. `optimizationRequestSchema`
  // already requires at least one axis, but `/v1/neighborhoods` builds its
  // own preferences object without going through the schema, so the guard
  // is real rather than redundant. The honest answer for "no lifestyle
  // axes rated" is that lifestyle contributes nothing and explains
  // nothing — 0 points, no factors — NOT a fabricated neutral score.
  if (selected.length === 0) {
    return { score: 0, factors: [] };
  }

  const importanceTotal = selected.reduce(
    (sum, axis) => sum + IMPORTANCE_VALUES[axis.importance],
    0,
  );

  let score = 0;
  const factors: FactorEvidence[] = selected.map(({ id, importance }) => {
    const share = IMPORTANCE_VALUES[importance] / importanceTotal;
    const effectiveWeight = OVERALL_WEIGHTS.lifestyle * share;
    const { componentScore, rawValue, rawValueLabel } =
      LIFESTYLE_AXIS_DESCRIBERS[id].describe(metrics);
    score += componentScore * share;

    const label = LIFESTYLE_AXES[id].label;
    return {
      key: id,
      label,
      rawValue,
      rawValueLabel,
      componentScore,
      effectiveWeight,
      pointContribution: roundToOneDecimal(componentScore * effectiveWeight),
      sourceDate: metrics.sourceDate,
      confidence: metrics.confidence,
      // Deliberately does NOT restate `componentScore` in the same "X/100"
      // form `rawValueLabel` already uses for floodSafety/quietness (that
      // would read as "80/100 flood safety score scores 80/100 on flood
      // safety" — pure repetition). The effective weight is new
      // information `rawValueLabel` never carries, for every axis.
      explanation: `${rawValueLabel}, weighted at ${(effectiveWeight * 100).toFixed(1)}% of your overall score.`,
      direction: classifyDirection(componentScore),
    };
  });

  return { score, factors };
}

// ---------------------------------------------------------------------------
// direction classification (shared by scoreCandidate's factors and buildReasons)
// ---------------------------------------------------------------------------

/**
 * A factor's contribution "relative to what it could have contributed" is
 * `pointContribution / (100 * effectiveWeight)`. Since
 * `pointContribution === componentScore * effectiveWeight`, that ratio
 * algebraically reduces to `componentScore / 100` — the weight cancels
 * out (note: this uses the UNROUNDED `componentScore * effectiveWeight`
 * product, not the rounded `pointContribution` that gets stored — rounding
 * for display must never feed back into which bucket a factor lands in).
 * So classifying direction from `componentScore` alone, against
 * `REASON_POSITIVE_THRESHOLD`/`REASON_NEGATIVE_THRESHOLD` scaled onto the
 * 0-100 `componentScore` scale, is exactly the spec's formula, just
 * computed the numerically simpler way. `buildReasons` reuses this same
 * classification rather than recomputing the ratio.
 */
function classifyDirection(componentScore: number): FactorEvidence["direction"] {
  if (componentScore > REASON_POSITIVE_THRESHOLD * 100) return "positive";
  if (componentScore < REASON_NEGATIVE_THRESHOLD * 100) return "negative";
  return "neutral";
}

// ---------------------------------------------------------------------------
// scoreCandidate
// ---------------------------------------------------------------------------

export type ScoredCandidate = Omit<NeighborhoodResult, "rank">;

/**
 * Scores one candidate that has already passed `applyHardFilters` (so
 * `candidate.commute` is non-null — this throws otherwise, since scoring a
 * disconnected candidate is a caller bug, not a data condition to handle
 * gracefully). `overallScore = 0.30*affordability + 0.30*commute +
 * 0.40*lifestyle`. Every `factors[].pointContribution` is rounded to one
 * decimal place AT THE POINT IT'S COMPUTED (see `roundToOneDecimal`), and
 * `overallScore` is the sum of those already-rounded contributions (passed
 * through `roundToOneDecimal` once more only to absorb floating-point
 * summation noise, e.g. `0.1 + 0.2`-style artifacts — not to re-round a
 * meaningfully different value). This is reconciliation BY CONSTRUCTION:
 * `factors[].pointContribution` summed by a caller always equals
 * `overallScore` exactly, for every input, not just ones whose raw total
 * happens to land on a 0.1 boundary.
 */
export function scoreCandidate(
  candidate: Candidate,
  request: OptimizationRequest,
): ScoredCandidate {
  const commute = candidate.commute;
  if (!commute) {
    throw new Error(
      `scoreCandidate: candidate "${candidate.stationGroupId}" has no commute result — it ` +
        `should have been excluded by applyHardFilters (the "disconnected" rule) before scoring.`,
    );
  }

  const affordabilityScore = scoreAffordability(candidate.rent.medianYen, request.monthlyBudgetYen);
  const commuteScore = scoreCommute(commute.totalMinutes, request.maxCommuteMinutes);
  // Only `factors` is needed here — `overallScore` below is derived by
  // summing every factor's `pointContribution` directly (which already
  // includes the lifestyle axes' contributions), not by recombining
  // `scoreLifestyle`'s own `score` a second time.
  const { factors: lifestyleFactors } = scoreLifestyle(candidate.lifestyle, request.preferences);

  const affordabilityFactor: FactorEvidence = {
    key: "affordability",
    label: "Affordability",
    rawValue: candidate.rent.medianYen,
    rawValueLabel: `¥${candidate.rent.medianYen.toLocaleString("en-US")} ${RENT_LABEL}`,
    componentScore: affordabilityScore,
    effectiveWeight: OVERALL_WEIGHTS.affordability,
    pointContribution: roundToOneDecimal(affordabilityScore * OVERALL_WEIGHTS.affordability),
    sourceDate: candidate.rent.sourcePeriod,
    confidence: candidate.rent.confidence,
    explanation: `¥${candidate.rent.medianYen.toLocaleString("en-US")} ${RENT_LABEL} against a ¥${request.monthlyBudgetYen.toLocaleString("en-US")} budget scores ${Math.round(affordabilityScore)}/100 on affordability.`,
    direction: classifyDirection(affordabilityScore),
  };

  const commuteFactor: FactorEvidence = {
    key: "commute",
    label: "Commute",
    rawValue: commute.totalMinutes,
    rawValueLabel: `${Math.round(commute.totalMinutes)} min ${COMMUTE_LABEL}`,
    componentScore: commuteScore,
    effectiveWeight: OVERALL_WEIGHTS.commute,
    pointContribution: roundToOneDecimal(commuteScore * OVERALL_WEIGHTS.commute),
    // Commute is computed live from the current graph, not sourced from a
    // dated table — there is no vintage to report.
    sourceDate: null,
    confidence: commute.confidence,
    explanation: `A ${Math.round(commute.totalMinutes)} min commute (${COMMUTE_LABEL}) against a ${request.maxCommuteMinutes} min cap scores ${Math.round(commuteScore)}/100 on commute.`,
    direction: classifyDirection(commuteScore),
  };

  const factors: FactorEvidence[] = [affordabilityFactor, commuteFactor, ...lifestyleFactors];

  // Sum of the ALREADY-ROUNDED pointContributions (affordability, commute,
  // and one per selected lifestyle axis) — see this function's doc comment
  // for why this is reconciliation by construction rather than a
  // coincidence of the inputs. Each pointContribution can carry up to ±0.05
  // of rounding drift versus its true (unrounded) value, so the sum can
  // overshoot 100 by up to half a decimal per factor even when every
  // componentScore is exactly 100 (e.g. preferences low/low/high/essential
  // with all four lifestyle axes at 100 sums to 100.1) — clamped here
  // rather than in `roundToOneDecimal` itself, since that helper is also
  // used for the individual (unclamped) factor contributions.
  const roundedContributionSum = factors.reduce((sum, factor) => sum + factor.pointContribution, 0);
  const overallScore = Math.min(100, roundToOneDecimal(roundedContributionSum));

  const { reasonsFor, reasonsAgainst } = buildReasons(factors);

  return {
    stationGroupId: candidate.stationGroupId,
    nameEn: candidate.nameEn,
    nameJa: candidate.nameJa,
    wardCode: candidate.wardCode,
    wardNameEn: candidate.wardNameEn,
    wardNameJa: candidate.wardNameJa,
    centroid: candidate.centroid,
    overallScore,
    rent: candidate.rent,
    // `CommuteEstimateResult.path` is `readonly CommutePathHop[]` (the
    // transit domain's own invariant); `NeighborhoodResult["commute"]`
    // (derived from `commuteEstimateSchema` via `z.infer`) expects a
    // plain mutable array. `.map()` always returns a fresh mutable array
    // regardless of the source's readonly-ness, so this is a type-shape
    // conversion only — no data is changed.
    commute: { ...commute, path: commute.path.map((hop) => ({ ...hop })) },
    factors,
    reasonsFor,
    reasonsAgainst,
    catchmentLabel: CATCHMENT_LABEL,
  };
}

// ---------------------------------------------------------------------------
// buildReasons
// ---------------------------------------------------------------------------

/**
 * Selects up to three `reasonsFor` (from factors classified `"positive"`,
 * i.e. `componentScore > REASON_POSITIVE_THRESHOLD * 100`) and up to three
 * `reasonsAgainst` (from factors classified `"negative"`, i.e.
 * `componentScore < REASON_NEGATIVE_THRESHOLD * 100`) — see
 * `classifyDirection` for why that's equivalent to the spec's
 * `contribution / (100 * effectiveWeight)` formula. Candidates are sorted
 * by `effectiveWeight` descending first (a factor that carries more of the
 * overall score is a more important reason), then by "gap size" — how far
 * past the threshold the factor sits — descending as the tiebreaker.
 */
export function buildReasons(factors: readonly FactorEvidence[]): {
  reasonsFor: string[];
  reasonsAgainst: string[];
} {
  const positive = factors.filter((f) => f.direction === "positive");
  const negative = factors.filter((f) => f.direction === "negative");

  const gapFor = (f: FactorEvidence) => f.componentScore / 100 - REASON_POSITIVE_THRESHOLD;
  const gapAgainst = (f: FactorEvidence) => REASON_NEGATIVE_THRESHOLD - f.componentScore / 100;

  const byWeightThenGap =
    (gap: (f: FactorEvidence) => number) =>
    (a: FactorEvidence, b: FactorEvidence): number => {
      if (b.effectiveWeight !== a.effectiveWeight) return b.effectiveWeight - a.effectiveWeight;
      return gap(b) - gap(a);
    };

  const sortedFor = [...positive].sort(byWeightThenGap(gapFor));
  const sortedAgainst = [...negative].sort(byWeightThenGap(gapAgainst));

  return {
    reasonsFor: sortedFor.slice(0, 3).map((f) => `${f.label} is a strength: ${f.rawValueLabel}.`),
    reasonsAgainst: sortedAgainst
      .slice(0, 3)
      .map((f) => `${f.label} is a weakness: ${f.rawValueLabel}.`),
  };
}

// ---------------------------------------------------------------------------
// rankCandidates
// ---------------------------------------------------------------------------

/**
 * Sorts by `overallScore` descending; ties broken by commute
 * `totalMinutes` ascending, then by rent `medianYen` ascending. Assigns
 * `rank` starting at 1 in the resulting order.
 */
export function rankCandidates(scored: readonly ScoredCandidate[]): NeighborhoodResult[] {
  const sorted = [...scored].sort((a, b) => {
    if (b.overallScore !== a.overallScore) return b.overallScore - a.overallScore;
    if (a.commute.totalMinutes !== b.commute.totalMinutes) {
      return a.commute.totalMinutes - b.commute.totalMinutes;
    }
    return a.rent.medianYen - b.rent.medianYen;
  });

  return sorted.map((candidate, index) => ({ ...candidate, rank: index + 1 }));
}

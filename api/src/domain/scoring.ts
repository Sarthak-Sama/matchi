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
import { percentile } from "./percentile.js";
import type { CommuteEstimateResult } from "./transit/commute.js";

export interface LifestyleMetricsInput {
  readonly normAmenitySupermarket: number;
  readonly normAmenityRestaurant: number;
  readonly normQuietness: number;
  readonly normAmenityConvenience: number;
  readonly normAmenityCuisineVariety: number;
  readonly normGreenSpace: number;
  readonly normAmenityLateNight: number;
  readonly normAmenityHealth: number;
  readonly supermarketCount: number;
  readonly restaurantCount: number;
  readonly cafeCount: number;
  readonly convenienceCount: number;
  readonly cuisineVarietyCount: number;
  readonly greenSpaceShare: number;
  readonly lateNightCount: number;
  readonly healthCount: number;
  readonly sourceDate: string | null;
  readonly confidence: Confidence;
}

export interface Candidate {
  readonly localityId: string;
  readonly nameEn: string;
  readonly nameJa: string;
  readonly wardCode: string;
  readonly wardNameEn: string;
  readonly wardNameJa: string;
  readonly centroid: { readonly lat: number; readonly lon: number };
  readonly polygon?: unknown | null;
  readonly nearbyStations?: readonly {
    readonly stationGroupId: string;
    readonly nameEn: string;
    readonly nameJa: string;
    readonly walkMinutes: number;
  }[];
  readonly rent: RentEstimateResult;
  readonly commute: CommuteEstimateResult | null;
  readonly lifestyle: LifestyleMetricsInput;

}

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

function roundToOneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

export function scoreAffordability(rentMedianYen: number, budgetYen: number): number {
  const fullScoreThreshold = budgetYen * AFFORDABILITY_FULL_SCORE_RATIO;

  if (rentMedianYen <= fullScoreThreshold) return 100;
  if (rentMedianYen >= budgetYen) return 0;

  return (100 * (budgetYen - rentMedianYen)) / (budgetYen - fullScoreThreshold);
}

export function scoreCommute(totalMinutes: number, maxCommuteMinutes: number): number {
  if (totalMinutes <= COMMUTE_FULL_SCORE_MINUTES) return 100;
  if (totalMinutes >= maxCommuteMinutes) return 0;

  return (
    (100 * (maxCommuteMinutes - totalMinutes)) / (maxCommuteMinutes - COMMUTE_FULL_SCORE_MINUTES)
  );
}

export interface LifestyleScoreResult {
  readonly score: number;
  readonly factors: readonly FactorEvidence[];
}

export function scoreLifestyle(
  metrics: LifestyleMetricsInput,
  preferences: OptimizationRequest["preferences"],
): LifestyleScoreResult {
  const selected = LIFESTYLE_AXIS_IDS.flatMap((id) => {
    const importance = preferences[id];
    return importance === undefined ? [] : [{ id, importance }];
  });

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

      explanation: `${rawValueLabel}, weighted at ${(effectiveWeight * 100).toFixed(1)}% of your overall score.`,
      direction: classifyDirection(componentScore),
    };
  });

  return { score, factors };
}

function classifyDirection(componentScore: number): FactorEvidence["direction"] {
  if (componentScore > REASON_POSITIVE_THRESHOLD * 100) return "positive";
  if (componentScore < REASON_NEGATIVE_THRESHOLD * 100) return "negative";
  return "neutral";
}

function normalizeCommute(commute: CommuteEstimateResult) {
  return {
    ...commute,
    mode: commute.mode ?? "transit",
    rangeMinutes: commute.rangeMinutes ?? { min: commute.totalMinutes, max: commute.totalMinutes },
    path: commute.path.map((hop) => ({ ...hop })),
  };
}

export type ScoredCandidate = Omit<NeighborhoodResult, "rank">;

export function scoreCandidate(
  candidate: Candidate,
  request: OptimizationRequest,
): ScoredCandidate {
  const commute = candidate.commute;
  if (!commute) {
    throw new Error(
      `scoreCandidate: candidate "${candidate.localityId}" has no commute result — it ` +
        `should have been excluded by applyHardFilters (the "disconnected" rule) before scoring.`,
    );
  }

  const affordabilityScore = scoreAffordability(candidate.rent.medianYen, request.monthlyBudgetYen);
  const commuteScore = scoreCommute(commute.totalMinutes, request.maxCommuteMinutes);

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

    sourceDate: null,
    confidence: commute.confidence,
    explanation: `A ${Math.round(commute.totalMinutes)} min commute (${COMMUTE_LABEL}) against a ${request.maxCommuteMinutes} min cap scores ${Math.round(commuteScore)}/100 on commute.`,
    direction: classifyDirection(commuteScore),
  };

  const factors: FactorEvidence[] = [affordabilityFactor, commuteFactor, ...lifestyleFactors];

  const roundedContributionSum = factors.reduce((sum, factor) => sum + factor.pointContribution, 0);
  const overallScore = Math.min(100, roundToOneDecimal(roundedContributionSum));

  const { reasonsFor, reasonsAgainst } = buildReasons(factors);

  return {
    localityId: candidate.localityId,
    nameEn: candidate.nameEn,
    nameJa: candidate.nameJa,
    wardCode: candidate.wardCode,
    wardNameEn: candidate.wardNameEn,
    wardNameJa: candidate.wardNameJa,
    centroid: candidate.centroid,
    polygon: candidate.polygon ?? null,
    nearbyStations: (candidate.nearbyStations ?? []).map((station) => ({ ...station })),
    overallScore,
    rent: candidate.rent,
    commute: normalizeCommute(commute),
    factors,
    reasonsFor,
    reasonsAgainst,
    catchmentLabel: CATCHMENT_LABEL,
  };
}

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

export function rankCandidates(scored: readonly ScoredCandidate[]): NeighborhoodResult[] {
  const sorted = [...scored].sort((a, b) => {
    if (b.overallScore !== a.overallScore) return b.overallScore - a.overallScore;
    if (a.commute.totalMinutes !== b.commute.totalMinutes) {
      return a.commute.totalMinutes - b.commute.totalMinutes;
    }
    if (a.rent.medianYen !== b.rent.medianYen) return a.rent.medianYen - b.rent.medianYen;
    return a.localityId.localeCompare(b.localityId);
  });

  return sorted.map((candidate, index) => ({ ...candidate, rank: index + 1 }));
}

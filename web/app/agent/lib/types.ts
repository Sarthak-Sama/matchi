// Type-only re-exports of the agent contracts.
//
// NEEDS (P1/orchestrator): `@tokyo/shared` does not export `./engine/types.js`
// from its index yet. Until it does, these are erased `import type`s straight
// from the source file (nothing runs at build time, so zod is not bundled).
// When shared/src/index.ts exports the engine types, change the one path below.
export type {
  AgentStateView,
  AgentStreamEvent,
  Anchor,
  AreaConfidence,
  BeliefSummary,
  Breakdown,
  BreakdownTerm,
  Comparison,
  Evidence,
  ExcludedSummary,
  FeatureKey,
  GroundingFailure,
  LoggedEvidence,
  MagnitudeTier,
  NextQuestion,
  ObserveResult,
  ParamKey,
  ParamSummary,
  Profile,
  ProfileResult,
  Recommendation,
  RelaxOption,
  ShortlistItem,
  Strength,
  WhyNot,
} from "../../../../shared/src/engine/types";

import type {
  BreakdownTerm,
  FeatureKey,
  ParamKey,
} from "../../../../shared/src/engine/types";

/** Display labels. Exhaustive records so a contract change fails typecheck. */
export const FEATURE_LABELS: Record<FeatureKey, string> = {
  supermarkets: "Supermarkets",
  dining: "Dining",
  konbini: "Convenience stores",
  cuisine_variety: "Cuisine variety",
  late_night: "Late-night options",
  health: "Health care",
  green_space: "Green space",
  residential_calm: "Residential calm",
  road_rail_exposure: "Road and rail noise",
  bars: "Bars",
  dining_reach: "Dining within reach",
  connectedness: "Connectedness",
  safety: "Safety",
};

export const FEATURE_KEY_LIST = Object.keys(FEATURE_LABELS) as FeatureKey[];

export const PARAM_LABELS: Record<ParamKey, string> = {
  c_t: "Value of time",
  ...FEATURE_LABELS,
  lambda_b: "Extra cost over budget",
  gamma: "Extra cost past commute cap",
};

export function termLabel(term: BreakdownTerm): string {
  switch (term) {
    case "rent":
      return "Rent";
    case "timeCost":
      return "Travel time";
    case "budgetPenalty":
      return "Over budget";
    case "capPenalty":
      return "Over commute cap";
    default:
      return FEATURE_LABELS[term];
  }
}

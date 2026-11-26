// Contracts for the Matchi recommendation engine (docs/plans/engine-spec.md)
// and the agent stream (docs/plans/agent-harness-plan.md). Types only, plus
// zod schemas for everything that crosses the model or network boundary.
import { z } from 'zod';

// ---------- Features and parameters ----------

export const FEATURE_KEYS = [
  'supermarkets',
  'dining',
  'konbini',
  'cuisine_variety',
  'late_night',
  'health',
  'green_space',
  'residential_calm',
  'road_rail_exposure',
  'bars',
  'dining_reach',
  'connectedness',
  // Appended last so the packed index of every earlier parameter is unchanged.
  'safety',
] as const;
export const FeatureKeySchema = z.enum(FEATURE_KEYS);
export type FeatureKey = z.infer<typeof FeatureKeySchema>;

/** theta = (c_T, w_1..w_13, lambda_B, gamma). Index order of the packed sample vector. */
export const PARAM_KEYS = ['c_t', ...FEATURE_KEYS, 'lambda_b', 'gamma'] as const;
export const ParamKeySchema = z.enum(PARAM_KEYS);
export type ParamKey = z.infer<typeof ParamKeySchema>;
export const PARAM_COUNT = PARAM_KEYS.length; // 16

export const ARCHETYPES = ['student', 'young_professional', 'couple', 'family', 'remote_worker'] as const;
export type Archetype = (typeof ARCHETYPES)[number];

export type FeatureSign = 'positive' | 'negative' | 'either';
export interface FeatureDef {
  key: FeatureKey;
  label: string;
  /** area_features columns summed to give x. */
  columns: readonly (keyof AreaFeatures)[];
  /** "Enough": s(h) = 0.9. null = derived from data (dining_reach: 75th percentile across areas). */
  h: number | null;
  sign: FeatureSign;
}

/**
 * One row of agent.area_features (subset the engine reads). Nullable per DDL.
 * E04: an area with null rent inputs (rent_per_sqm_yen, management_fee_yen),
 * any null lifestyle column, or null access values is excluded and counted in
 * ExcludedSummary. Null land_value_yen_per_sqm is allowed: multiplier 1.0 and
 * the wider rent noise (sigmaRentFar).
 */
export interface AreaFeatures {
  locality_id: string;
  name_en: string | null;
  name_ja: string;
  ward_code: string;
  ward_name_en: string | null;
  ward_name_ja: string | null;
  lat: number;
  lon: number;
  rent_per_sqm_yen: number | null;
  management_fee_yen: number | null;
  land_price_used_fallback: boolean | null;
  land_value_yen_per_sqm: number | null;
  land_value_nearest_m: number | null;
  supermarket_count: number;
  restaurant_count: number;
  cafe_count: number;
  convenience_count: number;
  cuisine_variety_count: number;
  late_night_count: number;
  health_count: number;
  green_space_share: number;
  residential_zoning_share: number | null;
  road_rail_exposure_share: number | null;
  bar_count: number | null;
  line_count: number | null;
  reach_restaurant: number | null;
  nearest_station_walk_min: number | null;
  access_confidence: 'high' | 'medium' | 'low' | null;
  /** Residents, 2020 census. Optional so older fixtures stay valid; null or absent means unknown. */
  population?: number | null;
  /** Earthquake risk rank 1 (safest) to 5. Shown on cards; the engine reads safety_score only. */
  quake_rank?: number | null;
  /** Share of the area in deep (0.5 m or more) flood zones, 0 to 1. Shown on cards. */
  flood_share?: number | null;
  /** Reported offences per 1,000 residents. Shown on cards; never a utility input (inflated where few live). */
  crime_per_1k?: number | null;
  /** 0 (least safe) to 1, combining the three above. Null means no data: the feature takes the median. */
  safety_score?: number | null;
  nearest_station_name_ja?: string | null;
  nearest_station_name_en?: string | null;
  /** Listing reference rents behind the ward's market adjustment; 0 = city-wide factor. */
  rent_market_refs?: number | null;
}

export const PeriodSchema = z.enum(['peak', 'offpeak']);
export type Period = z.infer<typeof PeriodSchema>;

/**
 * E02: the engine does no routing. The API computes, per anchor id, one-way
 * door-to-door minutes for every area, aligned to the `areas` array given to
 * createEngine (same length, same order). NaN = unreachable from that anchor.
 */
export type AnchorTimes = Record<string, Float64Array | number[]>;
/** api/src/agent/anchor-times.ts (P3). Anchors it cannot route go in `refused`, with no vector. */
export type ComputeAnchorTimes = (
  anchors: readonly Anchor[],
  areas: readonly AreaFeatures[],
) => Promise<{ times: AnchorTimes; refused: RefusedAnchor[] }>;

export interface ModelParams {
  rentElasticity: number; // 0.356
  /** Mid size in m2 per layout id (from LAYOUTS). */
  layoutAreaSqm: Readonly<Record<string, number>>;
  /** [min, max] clamp on the land-value rent multiplier (model_params rent_local_multiplier_min/max). */
  rentClamp?: readonly [number, number];
  /** Commute model error per path confidence (agent.commute_error_model). Empty or absent when no reference journeys are loaded. */
  commuteError?: Readonly<Partial<Record<'high' | 'medium' | 'low', CommuteErrorBand>>>;
  /** Private-rental rent per tatami relative to all sizes, by living-room size class, ascending tatamiMin. Classes without a published median are left out. */
  rentSizeCurve?: readonly RentSizeClass[];
  /** ward_code -> interquartile ratio (75th / 25th percentile rent) of the ward's rented dwellings, from the survey rent bands. */
  rentSpreadByWard?: Readonly<Record<string, number>>;
  /** Choice noise beta and statement noise tau as shares of scale (model_params evidence_beta_share / evidence_tau_share). */
  betaShare?: number;
  tauShare?: number;
}

export interface CommuteErrorBand {
  n: number;
  meanErrorMinutes: number;
  maeMinutes: number;
  p90AbsErrorMinutes: number;
}

export interface RentSizeClass {
  /** Living-room space in tatami, lower bound inclusive. */
  tatamiMin: number;
  /** Upper bound exclusive; null for the top class. */
  tatamiMax: number | null;
  relativeToAll: number;
}

export interface EngineDefaults {
  samples: number; // 4000
  shortlistSize: number; // 5
  stopRiskShare: number; // 0.01
  maxQuestions: number; // 6
  /** Stop once the best question is worth less than this share of scale (R3). */
  minEvoiShare: number; // 0.003
  surpriseThreshold: number; // 0.15
  sigmaRentNear: number; // 0.08
  sigmaRentFar: number; // 0.12
  travelNoiseShare: number; // 0.15
  travelNoiseMinMinutes: number; // 3
  essFloor: number; // 200
}

// ---------- Profile ----------

export const LimitSchema = z.object({ value: z.number().positive(), firm: z.boolean() });
export type Limit = z.infer<typeof LimitSchema>;

export const AnchorSchema = z.object({
  id: z.string().min(1),
  label: z.string(),
  /** Station id from `lookup`, or a point. Exactly one is expected. */
  stationId: z.string().optional(),
  point: z.object({ lat: z.number(), lon: z.number() }).optional(),
  tripsPerWeek: z.number().positive(),
  period: PeriodSchema.default('peak'),
  /** Flags the result: last trains are not in the data. */
  lateReturn: z.boolean().optional(),
  /** One-way minutes cap for this anchor. The main anchor's cap may instead be profile.commuteCap. */
  cap: LimitSchema.optional(),
});
export type Anchor = z.infer<typeof AnchorSchema>;

export const ProfileSchema = z.object({
  /** First anchor is the main anchor (T_1). */
  anchors: z.array(AnchorSchema).default([]),
  /** Layout id as in LAYOUTS. */
  layout: z.string().optional(),
  /** Monthly yen. */
  budget: LimitSchema.optional(),
  /** One-way minutes to the main anchor (kept for older sessions; anchors[0].cap wins when both are set). */
  commuteCap: LimitSchema.optional(),
  /** Multipliers on h per feature ("lots, not just enough"). */
  enoughMultipliers: z.partialRecord(FeatureKeySchema, z.number().positive()).default({}),
});
export type Profile = z.infer<typeof ProfileSchema>;

export interface RefusedAnchor {
  anchorId: string;
  /** 'no_times' is set by the engine when setProfile gets no vector for an anchor. */
  reason: 'outside_coverage' | 'no_station_within_1500m' | 'unknown_station' | 'no_times';
  message: string;
}
export interface ProfileResult {
  profile: Profile;
  refusedAnchors: RefusedAnchor[];
  feasibleCount: number;
  missing: ('anchor' | 'trips_per_week' | 'layout' | 'budget')[];
}

// ---------- Evidence ----------

export const StrengthSchema = z.enum(['weak', 'normal', 'strong']);
export type Strength = z.infer<typeof StrengthSchema>;
export const STRENGTH_ALPHA: Readonly<Record<Strength, number>> = { weak: 0.5, normal: 1, strong: 1.5 };

/** Who produced an item: a tap on the page, or the model reading free text. Stamped by the server. */
export const EvidenceSourceSchema = z.enum(['tap', 'text']);
export type EvidenceSource = z.infer<typeof EvidenceSourceSchema>;
/** Lapse rate epsilon per source: a tap is rarely a slip, a reading of free text more often is. */
export const SOURCE_EPSILON: Readonly<Record<EvidenceSource, number>> = { tap: 0.02, text: 0.1 };

export const MagnitudeTierSchema = z.enum(['low', 'medium', 'high', 'essential']);
export type MagnitudeTier = z.infer<typeof MagnitudeTierSchema>;
export const MAGNITUDE_TIER_SHARE: Readonly<Record<MagnitudeTier, number>> = {
  low: 0.01,
  medium: 0.02,
  high: 0.04,
  essential: 0.08,
};

const modelEvidenceBase = {
  /** Assigned by the engine in observe() when absent. */
  id: z.string().optional(),
  strength: StrengthSchema.default('normal'),
  /** The person's words; shown on the chip. */
  quote: z.string().optional(),
};
const evidenceBase = {
  ...modelEvidenceBase,
  /** Absent means 'text', so stored sessions from before the field still parse. */
  source: EvidenceSourceSchema.optional(),
};
const areaId = z.string().min(1);

function evidenceUnion<B extends typeof modelEvidenceBase>(base: B) {
  return z.discriminatedUnion('type', [
    z.object({ ...base, type: z.literal('prefer_area'), a: areaId, b: areaId }),
    z.object({ ...base, type: z.literal('pick_from_set'), chosen: areaId, set: z.array(areaId).min(2) }),
    z.object({ ...base, type: z.literal('reject_area'), rejected: areaId, set: z.array(areaId).min(2) }),
    z.object({ ...base, type: z.literal('direction'), feature: FeatureKeySchema, sign: z.union([z.literal(1), z.literal(-1)]) }),
    z.object({ ...base, type: z.literal('magnitude'), feature: FeatureKeySchema, tier: MagnitudeTierSchema }),
    z.object({ ...base, type: z.literal('compare_importance'), more: FeatureKeySchema, less: FeatureKeySchema }),
    z.object({
      ...base,
      type: z.literal('time_tradeoff'),
      yen: z.number().positive(),
      /** One-way minutes saved. */
      minutes: z.number().positive(),
      accept: z.boolean(),
      /** Defaults to the main anchor's trips per week. */
      tripsPerWeek: z.number().positive().optional(),
    }),
    z.object({ ...base, type: z.literal('like_area'), area: areaId }),
    z.object({ ...base, type: z.literal('dislike_area'), area: areaId }),
  ]);
}
export const EvidenceSchema = evidenceUnion(evidenceBase);
/** What the model may send: no source, which the server stamps. Unknown keys such as a source are stripped. */
export const ModelEvidenceSchema = evidenceUnion(modelEvidenceBase);
export type Evidence = z.infer<typeof EvidenceSchema>;
export type EvidenceType = Evidence['type'];
/** An item in the log: id is always set. */
export type LoggedEvidence = Evidence & { id: string };

export interface EngineError {
  code: 'invalid_evidence' | 'unknown_area' | 'unknown_evidence_id' | 'profile_incomplete';
  message: string;
}
export type ObserveResult =
  | { ok: true; id: string; predictive: number; surprising: boolean; conflictsWith?: string }
  | { ok: false; error: EngineError };

// ---------- Belief ----------

/** 4,000 weighted samples, packed row-major: theta[i * PARAM_COUNT + p]. */
export interface Belief {
  n: number;
  theta: Float64Array;
  archetype: Uint8Array; // index into ARCHETYPES
  weights: Float64Array; // sums to 1
  /** Scale B: the budget, or median modelled rent of reachable areas. */
  scale: number;
  /** R1: the samples were resampled and moved, so the weights are uniform again. */
  rejuvenated?: boolean;
  /** R1: ESS of the replayed weights before the move; confidence and stopping read this. */
  essBeforeMove?: number;
}
export interface ParamSummary {
  param: ParamKey;
  median: number;
  p10: number;
  p90: number;
  /** The three above divided by scale (c_t, w_j only; null for lambda_b, gamma). */
  shareOfBudget: { median: number; p10: number; p90: number } | null;
}
export interface BeliefSummary {
  params: ParamSummary[];
  ess: number;
  lowConfidence: boolean; // ess < essFloor
  scale: number;
}

// ---------- Recommendation ----------

/** Yen per month at the weighted mean parameters. Sums to total. */
export interface Breakdown {
  rent: number; // negative
  timeCost: number; // negative
  features: Record<FeatureKey, number>;
  budgetPenalty: number; // <= 0
  capPenalty: number; // <= 0
  total: number;
}
export type BreakdownTerm = 'rent' | 'timeCost' | 'budgetPenalty' | 'capPenalty' | FeatureKey;

export interface AreaConfidence {
  rent: 'near_price_point' | 'distant_price_point' | 'ward_fallback';
  landValueNearestM: number | null;
  access: 'high' | 'medium' | 'low' | null;
  commuteBandMinutes: number;
  lateReturnNotCovered: boolean;
}
/** Crime relative to other areas (terciles of reported offences per 1,000 residents); never the raw rate. */
export type CrimeBand = 'low' | 'typical' | 'high';
export interface AreaSafety {
  /** 1 (safest) to 5. */
  quakeRank: number | null;
  /** Share of the area in deep flood zones, 0 to 1. */
  floodShare: number | null;
  crimeBand: CrimeBand | null;
}
export interface ShortlistItem {
  localityId: string;
  nameEn: string | null;
  nameJa: string;
  wardNameEn: string | null;
  lat: number;
  lon: number;
  nearestStation: { nameJa: string; nameEn: string | null } | null;
  /** Null when none of the three safety figures is known for the area. */
  safety: AreaSafety | null;
  rentYen: number;
  /** One-way minutes to the main anchor; null with no anchor. */
  commuteMinutes: number | null;
  monthlyTravelHours: number;
  pBest: number;
  regretYen: number;
  role: { param: ParamKey; direction: 'higher' | 'lower' } | null;
  breakdown: Breakdown;
  /** breakdown minus the median feasible area's, per term. */
  vsMedian: Breakdown;
  confidence: AreaConfidence;
  similarNearby?: string[];
}
/** evoiYen: expected value of the answer, yen per month (R2). */
export type NextQuestion =
  | { kind: 'profile_fact'; missing: 'anchor' | 'trips_per_week' | 'layout' | 'budget' }
  | { kind: 'pick_from_shortlist'; set: string[] }
  | { kind: 'pair'; a: string; b: string; pABeatsB: number; evoiYen?: number }
  /** Would you pay `yen` more a month to save `minutes` one way, at the main anchor's trips per week? */
  | { kind: 'time_tradeoff'; yen: number; minutes: number; evoiYen: number };
/** Count per reason; an area is counted once, under the first reason in this order. */
export interface ExcludedSummary {
  /** Fewer than 100 residents (offices, parks, port land); unknown population is not excluded. */
  uninhabited: number;
  /** Null rent_per_sqm_yen or management_fee_yen. */
  nullRent: number;
  /** Any null lifestyle column (zoning share, exposure share, bar_count, ...). */
  nullLifestyle: number;
  /** Null access columns (line_count, reach_restaurant). */
  missingAccess: number;
  /** NaN minutes for at least one anchor in AnchorTimes. */
  disconnected: number;
  overBudgetFirm: number;
  overCommuteCapFirm: number;
}
export interface RelaxOption {
  limit: 'budget' | 'commute_cap';
  /** commute_cap only: the anchor whose cap is raised. */
  anchorId?: string;
  /** 0.05 | 0.10 | 0.20 share for budget; 5 | 10 | 15 minutes for commute cap. */
  step: number;
  newValue: number;
  areasGained: number;
  yenGained: number;
  binding: boolean;
}
export interface Recommendation {
  shortlist: ShortlistItem[]; // ordered by pBest desc
  feasibleCount: number;
  riskYen: number;
  shouldStop: boolean;
  stopReason: 'risk_below_threshold' | 'question_limit' | 'nothing_left_to_learn' | null;
  nextQuestion: NextQuestion | null;
  excluded: ExcludedSummary;
  /** Attached when fewer than k areas are feasible. */
  relax?: RelaxOption[];
  /** "If I'm wrong about you". */
  alternative?: { localityId: string; weight: number; param: ParamKey } | null;
  ess: number;
}

// ---------- Explanations ----------

export type WhyNot =
  | { kind: 'unknown_area'; localityId: string }
  | { kind: 'is_top_pick'; localityId: string }
  | {
      kind: 'fails_firm_limit';
      localityId: string;
      limit: 'budget' | 'commute_cap' | 'uninhabited' | 'null_rent' | 'null_lifestyle' | 'no_access' | 'disconnected';
      by: number;
      unit: 'yen' | 'minutes' | 'none';
      /** commute_cap only: the anchor whose cap is missed. */
      anchorId?: string;
    }
  | { kind: 'wins_for_some'; localityId: string; weight: number; param: ParamKey; ratio: number }
  | { kind: 'needs_weight_change'; localityId: string; term: BreakdownTerm; factor: number; gapYen: number }
  | { kind: 'dominated'; localityId: string; gapYen: number };

export interface Comparison {
  a: string;
  b: string;
  /** a minus b, yen per month, per term. */
  diff: Breakdown;
  pABeatsB: number;
}

// ---------- Session state and stream ----------

export const SessionStateSchema = z.object({
  profile: ProfileSchema,
  evidence: z.array(EvidenceSchema),
  seed: z.number().int(),
  /** Derived from the evidence on snapshot; ignored on restore (kept so stored sessions parse). */
  questionsAsked: z.number().int().nonnegative().default(0),
});
export type SessionState = z.infer<typeof SessionStateSchema>;

/**
 * Payload of the `state` stream event and the body the direct (non-chat)
 * routes return. Derived values are recomputed, never stored.
 */
export interface AgentStateView {
  profile: Profile;
  /** Evidence chips. */
  evidence: LoggedEvidence[];
  belief: BeliefSummary;
  /** Holds the shortlist; null until the profile allows one. */
  recommendation: Recommendation | null;
  /** Value at risk, yen per month; copy of recommendation.riskYen. */
  riskYen: number | null;
  /** Copy of recommendation.excluded. */
  excluded: ExcludedSummary | null;
}
export interface GroundingFailure {
  figure: string;
  context: string;
}
export type AgentStreamEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool_call'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; id: string; name: string; ok: boolean; result: unknown }
  | { type: 'state'; state: AgentStateView }
  | { type: 'grounding'; pass: boolean; failures: GroundingFailure[] }
  | { type: 'done' }
  | { type: 'error'; message: string; code?: string };

export const AgentStreamEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), delta: z.string() }),
  z.object({ type: z.literal('tool_call'), id: z.string(), name: z.string(), input: z.unknown() }),
  z.object({ type: z.literal('tool_result'), id: z.string(), name: z.string(), ok: z.boolean(), result: z.unknown() }),
  z.object({ type: z.literal('state'), state: z.custom<AgentStateView>() }),
  z.object({ type: z.literal('grounding'), pass: z.boolean(), failures: z.array(z.object({ figure: z.string(), context: z.string() })) }),
  z.object({ type: z.literal('done') }),
  z.object({ type: z.literal('error'), message: z.string(), code: z.string().optional() }),
]);

// ---------- Module export signatures ----------

/** rng.ts */
export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  normal(): number;
  lognormal(mu: number, sigma: number): number;
  /** Integer in [0, n). */
  int(n: number): number;
}
export type CreateRng = (seed: number) => Rng;

/** features.ts. Everything recommend/evidence need, precomputed for a profile. */
export interface AreaContext {
  areas: readonly AreaFeatures[];
  /** locality_id -> index into areas. */
  index: ReadonlyMap<string, number>;
  /** R(a), yen; NaN when rent inputs are missing. */
  rent: Float64Array;
  /** One-way minutes per anchor, in profile.anchors order: minutes[m][a], copied from AnchorTimes; NaN = unreachable. */
  minutes: Float64Array[];
  /** s_j(x_aj), row-major: sat[a * FEATURE_KEYS.length + j]. */
  sat: Float64Array;
  sigmaRent: Float64Array;
  /** Calibrated sd of the commute estimate in minutes, by the area's access confidence; NaN = uncalibrated (use the fallback band). */
  commuteSigma: Float64Array;
  /** ModelParams.betaShare / tauShare; absent = the engine's fallback constants. */
  betaShare?: number;
  tauShare?: number;
  /** 1 = passes every firm limit and has access values. */
  feasible: Uint8Array;
  excluded: ExcludedSummary;
  /** Budget, or median modelled rent of reachable areas. */
  scale: number;
}
export type Saturate = (x: number, h: number) => number;
export type FeatureTable = readonly FeatureDef[];
export type ModelledRent = (area: AreaFeatures, wardMedianLandValue: number | null, layoutAreaSqm: number, params: ModelParams) => number;
export type MonthlyHours = (oneWayMinutes: number, tripsPerWeek: number) => number;
export type BuildAreaContext = (areas: readonly AreaFeatures[], params: ModelParams, profile: Profile, anchorTimes: AnchorTimes) => AreaContext;

/** belief.ts */
export type SamplePrior = (scale: number, seed: number, n?: number) => Belief;
export type EffectiveSampleSize = (weights: Float64Array) => number;
/** Prior times every likelihood in the log; returns a new Belief with fresh weights. epsilon overrides the per-item SOURCE_EPSILON. */
export type Replay = (prior: Belief, log: readonly LoggedEvidence[], likelihood: Likelihood, epsilon?: number) => Belief;
export type SummarizeBelief = (belief: Belief, essFloor?: number) => BeliefSummary;

/**
 * recommend.ts. `u` is NOISE-FREE, u[i * nAreas + a]: EUS, the greedy
 * shortlist, likelihoods and question choice read it. Rent and travel-time
 * noise exists only in `noisy`, one matrix over the candidate set C (top 40
 * feasible by expected utility plus the greedy shortlist), which P_best,
 * regret, Risk and compare all read (R5).
 */
export interface UtilityMatrix {
  u: Float32Array;
  nSamples: number;
  nAreas: number;
  /** Empty until attached (attachNoisy); the engine caches it per belief and profile version. */
  noisy: {
    /** Area indices in C. */
    areaIdx: Int32Array;
    /** u[i * areaIdx.length + c] for column c = position in areaIdx. */
    u: Float32Array;
  };
}
/** Noisy utilities for an arbitrary area list; an area's values do not depend on which other areas are listed. */
export type NoisyUtilities = (belief: Belief, ctx: AreaContext, profile: Profile, seed: number, areaIdx: readonly number[]) => UtilityMatrix['noisy'];
export type BuildUtilities = (belief: Belief, ctx: AreaContext, profile: Profile, seed: number) => UtilityMatrix;

/** evidence.ts: fills out[i] with L_e(theta_i) in [0, 1]. Uses util.u (noise-free). */
export type Likelihood = (e: Evidence, belief: Belief, util: UtilityMatrix, ctx: AreaContext, profile: Profile, out: Float64Array) => void;
/** p_e under the current weights. */
export type Predictive = (weights: Float64Array, likelihoods: Float64Array, epsilon?: number) => number;
export type SurpriseThreshold = (e: Evidence) => number;

/** recommend.ts */
export type GreedyShortlist = (util: UtilityMatrix, weights: Float64Array, feasible: Uint8Array, k: number) => number[];
/** Length nAreas; zero outside util.noisy.areaIdx; sums to 1. Risk reads util.noisy too. */
export type PBest = (util: UtilityMatrix, weights: Float64Array, feasible: Uint8Array) => Float64Array;
export type RiskOfSet = (util: UtilityMatrix, weights: Float64Array, feasible: Uint8Array, set: readonly number[]) => number;
/** opts.log: the evidence so far; pairs already asked as prefer_area are not asked again. */
export type Recommend = (
  belief: Belief,
  util: UtilityMatrix,
  ctx: AreaContext,
  profile: Profile,
  opts: { k: number; questionsAsked: number; defaults: EngineDefaults; log?: readonly Evidence[] },
) => Recommendation;

/** explain.ts */
export type BreakdownAt = (areaIdx: number, belief: Belief, ctx: AreaContext, profile: Profile) => Breakdown;
export type ExplainWhyNot = (localityId: string, belief: Belief, util: UtilityMatrix, ctx: AreaContext, profile: Profile) => WhyNot;
export type ExplainCompare = (a: string, b: string, belief: Belief, util: UtilityMatrix, ctx: AreaContext, profile: Profile) => Comparison;
/** Needs to rebuild contexts for relaxed profiles, hence the raw inputs. */
export type ExplainRelax = (areas: readonly AreaFeatures[], params: ModelParams, profile: Profile, anchorTimes: AnchorTimes, belief: Belief, seed: number) => RelaxOption[];

/** index.ts */
export interface Engine {
  /** Every anchor in p needs a vector in anchorTimes; one without is refused ('no_times') and ignored. */
  setProfile(p: Profile, anchorTimes: AnchorTimes): ProfileResult;
  observe(e: Evidence): ObserveResult;
  removeEvidence(id: string): void;
  recommend(k?: number): Recommendation;
  whyNot(localityId: string): WhyNot;
  relax(): RelaxOption[];
  compare(a: string, b: string): Comparison;
  beliefSummary(): BeliefSummary;
  snapshot(): SessionState;
  /** AnchorTimes are not in SessionState; the API recomputes them and passes them here. */
  restore(s: SessionState, anchorTimes: AnchorTimes): void;
}
export type CreateEngine = (areas: AreaFeatures[], params: ModelParams, seed: number) => Engine;

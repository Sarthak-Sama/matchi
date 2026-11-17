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
] as const;
export const FeatureKeySchema = z.enum(FEATURE_KEYS);
export type FeatureKey = z.infer<typeof FeatureKeySchema>;

/** theta = (c_T, w_1..w_12, lambda_B, gamma). Index order of the packed sample vector. */
export const PARAM_KEYS = ['c_t', ...FEATURE_KEYS, 'lambda_b', 'gamma'] as const;
export const ParamKeySchema = z.enum(PARAM_KEYS);
export type ParamKey = z.infer<typeof ParamKeySchema>;
export const PARAM_COUNT = PARAM_KEYS.length; // 15

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

/** One row of agent.area_features (subset the engine reads). Nullable per DDL. */
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
}

export const PeriodSchema = z.enum(['peak', 'offpeak']);
export type Period = z.infer<typeof PeriodSchema>;

/** Station access of one of a locality's 9 sample points: its 3 nearest stations. */
export interface SamplePointAccess {
  stations: readonly { stationId: string; walkMin: number }[];
}
/** Station-to-station minutes plus locality access; built by api feature-store. */
export interface TravelMatrix {
  /** null when the pair is not connected. */
  stationMinutes(from: string, to: string, period: Period): number | null;
  /** Empty array when the locality has no access values (excluded from F). */
  localityAccess(localityId: string): readonly SamplePointAccess[];
  /** Nearest station(s) to a point within 1,500 m; empty = outside coverage. */
  stationsNear(lat: number, lon: number): readonly { stationId: string; walkMin: number }[];
}

export interface ModelParams {
  rentElasticity: number; // 0.356
  /** Mid size in m2 per layout id (from LAYOUTS). */
  layoutAreaSqm: Readonly<Record<string, number>>;
}

export interface EngineDefaults {
  samples: number; // 4000
  shortlistSize: number; // 5
  betaShare: number; // 0.03
  tauShare: number; // 0.01
  epsilon: number; // 0.05
  stopRiskShare: number; // 0.01
  maxQuestions: number; // 6
  minEvoiShare: number; // 0.003
  surpriseThreshold: number; // 0.15
  sigmaRentNear: number; // 0.08
  sigmaRentFar: number; // 0.12
  travelNoiseShare: number; // 0.15
  travelNoiseMinMinutes: number; // 3
  rentClamp: readonly [number, number]; // [0.7, 1.4]
  essFloor: number; // 200
}

// ---------- Profile ----------

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
});
export type Anchor = z.infer<typeof AnchorSchema>;

export const LimitSchema = z.object({ value: z.number().positive(), firm: z.boolean() });
export type Limit = z.infer<typeof LimitSchema>;

export const ProfileSchema = z.object({
  /** First anchor is the main anchor (T_1). */
  anchors: z.array(AnchorSchema).default([]),
  /** Layout id as in LAYOUTS. */
  layout: z.string().optional(),
  /** Monthly yen. */
  budget: LimitSchema.optional(),
  /** One-way minutes to the main anchor. */
  commuteCap: LimitSchema.optional(),
  /** Multipliers on h per feature ("lots, not just enough"). */
  enoughMultipliers: z.partialRecord(FeatureKeySchema, z.number().positive()).default({}),
});
export type Profile = z.infer<typeof ProfileSchema>;

export interface RefusedAnchor {
  anchorId: string;
  reason: 'outside_coverage' | 'no_station_within_1500m' | 'unknown_station';
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
export const STRENGTH_ALPHA: Readonly<Record<Strength, number>> = { weak: 0.5, normal: 1, strong: 2 };

export const MagnitudeTierSchema = z.enum(['low', 'medium', 'high', 'essential']);
export type MagnitudeTier = z.infer<typeof MagnitudeTierSchema>;
export const MAGNITUDE_TIER_SHARE: Readonly<Record<MagnitudeTier, number>> = {
  low: 0.01,
  medium: 0.02,
  high: 0.04,
  essential: 0.08,
};

const evidenceBase = {
  /** Assigned by the engine in observe() when absent. */
  id: z.string().optional(),
  strength: StrengthSchema.default('normal'),
  /** The person's words; shown on the chip. */
  quote: z.string().optional(),
};
const areaId = z.string().min(1);

export const EvidenceSchema = z.discriminatedUnion('type', [
  z.object({ ...evidenceBase, type: z.literal('prefer_area'), a: areaId, b: areaId }),
  z.object({ ...evidenceBase, type: z.literal('pick_from_set'), chosen: areaId, set: z.array(areaId).min(2) }),
  z.object({ ...evidenceBase, type: z.literal('reject_area'), rejected: areaId, set: z.array(areaId).min(2) }),
  z.object({ ...evidenceBase, type: z.literal('direction'), feature: FeatureKeySchema, sign: z.union([z.literal(1), z.literal(-1)]) }),
  z.object({ ...evidenceBase, type: z.literal('magnitude'), feature: FeatureKeySchema, tier: MagnitudeTierSchema }),
  z.object({ ...evidenceBase, type: z.literal('compare_importance'), more: FeatureKeySchema, less: FeatureKeySchema }),
  z.object({
    ...evidenceBase,
    type: z.literal('time_tradeoff'),
    yen: z.number().positive(),
    /** One-way minutes saved. */
    minutes: z.number().positive(),
    accept: z.boolean(),
    /** Defaults to the main anchor's trips per week. */
    tripsPerWeek: z.number().positive().optional(),
  }),
  z.object({ ...evidenceBase, type: z.literal('like_area'), area: areaId }),
  z.object({ ...evidenceBase, type: z.literal('dislike_area'), area: areaId }),
]);
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
export interface ShortlistItem {
  localityId: string;
  nameEn: string | null;
  nameJa: string;
  wardNameEn: string | null;
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
export type NextQuestion =
  | { kind: 'profile_fact'; missing: 'anchor' | 'trips_per_week' | 'layout' | 'budget' }
  | { kind: 'pick_from_shortlist'; set: string[] }
  | { kind: 'pair'; a: string; b: string; pABeatsB: number; evoiYen?: number };
export interface ExcludedSummary {
  missingAccess: number;
  disconnected: number;
  overBudgetFirm: number;
  overCommuteCapFirm: number;
}
export interface RelaxOption {
  limit: 'budget' | 'commute_cap';
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
  stopReason: 'risk_below_threshold' | 'question_limit' | null;
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
  | { kind: 'fails_firm_limit'; localityId: string; limit: 'budget' | 'commute_cap' | 'no_access' | 'disconnected'; by: number; unit: 'yen' | 'minutes' | 'none' }
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
  questionsAsked: z.number().int().nonnegative().default(0),
});
export type SessionState = z.infer<typeof SessionStateSchema>;

/** Payload of the `state` stream event. Derived values are recomputed, never stored. */
export interface AgentStateView {
  profile: Profile;
  evidence: LoggedEvidence[];
  belief: BeliefSummary;
  recommendation: Recommendation | null;
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
  /** One-way minutes per anchor: minutes[m][a]; NaN when no access or disconnected. */
  minutes: Float64Array[];
  /** s_j(x_aj), row-major: sat[a * FEATURE_KEYS.length + j]. */
  sat: Float64Array;
  sigmaRent: Float64Array;
  /** 1 = passes every firm limit and has access values. */
  feasible: Uint8Array;
  excluded: ExcludedSummary;
  /** Budget, or median modelled rent of reachable areas. */
  scale: number;
}
export type Saturate = (x: number, h: number) => number;
export type FeatureTable = readonly FeatureDef[];
export type ModelledRent = (area: AreaFeatures, wardMedianLandValue: number | null, layoutAreaSqm: number, params: ModelParams) => number;
export type AnchorMinutes = (area: AreaFeatures, anchor: Anchor, matrix: TravelMatrix) => number | null;
export type MonthlyHours = (oneWayMinutes: number, tripsPerWeek: number) => number;
export type BuildAreaContext = (areas: readonly AreaFeatures[], matrix: TravelMatrix, params: ModelParams, profile: Profile) => AreaContext;

/** belief.ts */
export type SamplePrior = (scale: number, seed: number, n?: number) => Belief;
export type EffectiveSampleSize = (weights: Float64Array) => number;
/** Prior times every likelihood in the log; returns a new Belief with fresh weights. */
export type Replay = (prior: Belief, log: readonly LoggedEvidence[], likelihood: Likelihood, epsilon?: number) => Belief;
export type SummarizeBelief = (belief: Belief, essFloor?: number) => BeliefSummary;

/** recommend.ts: U[i * nAreas + a], Float32Array, with per-sample rent and time noise. */
export interface UtilityMatrix {
  u: Float32Array;
  nSamples: number;
  nAreas: number;
}
export type BuildUtilities = (belief: Belief, ctx: AreaContext, profile: Profile, seed: number) => UtilityMatrix;

/** evidence.ts: fills out[i] with L_e(theta_i) in [0, 1]. */
export type Likelihood = (e: Evidence, belief: Belief, util: UtilityMatrix, ctx: AreaContext, profile: Profile, out: Float64Array) => void;
/** p_e under the current weights. */
export type Predictive = (weights: Float64Array, likelihoods: Float64Array, epsilon?: number) => number;
export type SurpriseThreshold = (e: Evidence) => number;

/** recommend.ts */
export type GreedyShortlist = (util: UtilityMatrix, weights: Float64Array, feasible: Uint8Array, k: number) => number[];
export type PBest = (util: UtilityMatrix, weights: Float64Array, feasible: Uint8Array) => Float64Array;
export type RiskOfSet = (util: UtilityMatrix, weights: Float64Array, feasible: Uint8Array, set: readonly number[]) => number;
export type Recommend = (belief: Belief, util: UtilityMatrix, ctx: AreaContext, profile: Profile, opts: { k: number; questionsAsked: number; defaults: EngineDefaults }) => Recommendation;

/** explain.ts */
export type BreakdownAt = (areaIdx: number, belief: Belief, ctx: AreaContext, profile: Profile) => Breakdown;
export type ExplainWhyNot = (localityId: string, belief: Belief, util: UtilityMatrix, ctx: AreaContext, profile: Profile) => WhyNot;
export type ExplainCompare = (a: string, b: string, belief: Belief, util: UtilityMatrix, ctx: AreaContext, profile: Profile) => Comparison;
/** Needs to rebuild contexts for relaxed profiles, hence the raw inputs. */
export type ExplainRelax = (areas: readonly AreaFeatures[], matrix: TravelMatrix, params: ModelParams, profile: Profile, belief: Belief, seed: number) => RelaxOption[];

/** index.ts */
export interface Engine {
  setProfile(p: Profile): ProfileResult;
  observe(e: Evidence): ObserveResult;
  removeEvidence(id: string): void;
  recommend(k?: number): Recommendation;
  whyNot(localityId: string): WhyNot;
  relax(): RelaxOption[];
  compare(a: string, b: string): Comparison;
  beliefSummary(): BeliefSummary;
  snapshot(): SessionState;
  restore(s: SessionState): void;
}
export type CreateEngine = (areas: AreaFeatures[], matrix: TravelMatrix, params: ModelParams, seed: number) => Engine;

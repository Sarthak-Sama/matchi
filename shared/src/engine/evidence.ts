// Evidence likelihoods, predictive probability and surprise
// (docs/plans/engine-spec.md, "Evidence"). E01: every likelihood reads the
// noise-free util.u. Pure and deterministic.
import { FEATURE_OFFSET, C_T_INDEX, LAMBDA_B_INDEX, DEFAULT_EPSILON } from './belief.js';
import { monthlyHours } from './features.js';
import {
  FEATURE_KEYS,
  MAGNITUDE_TIER_SHARE,
  PARAM_COUNT,
  type AreaContext,
  type EngineError,
  type Evidence,
  type FeatureKey,
  type Likelihood,
  type Predictive,
  type Profile,
  type SurpriseThreshold,
  type UtilityMatrix,
} from './types.js';

/** Choice noise beta and statement noise tau, as shares of scale. */
export const BETA_SHARE = 0.03;
export const TAU_SHARE = 0.01;
/** Width of the magnitude kernel in log space. */
export const MAGNITUDE_LOG_SD = 0.6;
/** Surprise threshold for two-outcome items. */
export const SURPRISE_TWO_OUTCOME = 0.15;

const sigmoid = (z: number): number => (z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z)));

const featureParam = (key: FeatureKey): number => FEATURE_OFFSET + FEATURE_KEYS.indexOf(key);

/** Trips per week a time_tradeoff item refers to: its own, else the main anchor's (E10). */
export function tradeoffTrips(e: Extract<Evidence, { type: 'time_tradeoff' }>, profile: Profile): number | null {
  const n = e.tripsPerWeek ?? profile.anchors[0]?.tripsPerWeek;
  return n !== undefined && n > 0 ? n : null;
}

/** Area ids an item names. */
export function evidenceAreas(e: Evidence): string[] {
  switch (e.type) {
    case 'prefer_area':
      return [e.a, e.b];
    case 'pick_from_set':
      return [e.chosen, ...e.set];
    case 'reject_area':
      return [e.rejected, ...e.set];
    case 'like_area':
    case 'dislike_area':
      return [e.area];
    default:
      return [];
  }
}

/**
 * Checks an item against the current context before it is applied. Unknown
 * area -> unknown_area. An area with no utility (null inputs, disconnected)
 * -> invalid_evidence (E11). time_tradeoff with no trips -> profile_incomplete.
 * `util` is optional: without it only id membership is checked.
 */
export function validateEvidence(e: Evidence, ctx: AreaContext, profile: Profile, util?: UtilityMatrix): EngineError | null {
  for (const id of evidenceAreas(e)) {
    const a = ctx.index.get(id);
    if (a === undefined) return { code: 'unknown_area', message: `No area with id ${id}` };
    if (util && util.nSamples > 0 && !Number.isFinite(util.u[a]!)) {
      return { code: 'invalid_evidence', message: `Area ${id} has missing data or is unreachable, so it cannot be scored` };
    }
  }
  if (e.type === 'pick_from_set' && !e.set.includes(e.chosen)) {
    return { code: 'invalid_evidence', message: 'chosen must be one of set' };
  }
  if (e.type === 'reject_area' && !e.set.includes(e.rejected)) {
    return { code: 'invalid_evidence', message: 'rejected must be one of set' };
  }
  if (e.type === 'prefer_area' && e.a === e.b) return { code: 'invalid_evidence', message: 'a and b must differ' };
  if (e.type === 'compare_importance' && e.more === e.less) {
    return { code: 'invalid_evidence', message: 'more and less must differ' };
  }
  if (e.type === 'time_tradeoff') {
    if (!(e.yen > 0) || !(e.minutes > 0)) return { code: 'invalid_evidence', message: 'yen and minutes must be positive' };
    if (tradeoffTrips(e, profile) === null) {
      return { code: 'profile_incomplete', message: 'time_tradeoff needs tripsPerWeek or a main anchor' };
    }
  }
  return null;
}

/** log of the softmax probability of `pick` among `members` (E05: log-sum-exp). */
function logChoice(u: Float32Array, row: number, pick: number, members: readonly number[], beta: number): number {
  let max = -Infinity;
  for (const m of members) {
    const v = u[row + m]!;
    if (v > max) max = v;
  }
  let sum = 0;
  for (const m of members) sum += Math.exp((u[row + m]! - max) / beta);
  return (u[row + pick]! - max) / beta - Math.log(sum);
}

/** Index of each id, dropping ids that have no utility. */
function scorableIndices(ids: readonly string[], ctx: AreaContext, util: UtilityMatrix): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  for (const id of ids) {
    const a = ctx.index.get(id);
    if (a === undefined || seen.has(a)) continue;
    if (util.nSamples > 0 && !Number.isFinite(util.u[a]!)) continue;
    seen.add(a);
    out.push(a);
  }
  return out;
}

/**
 * q(x)^2 or (1 - q(x))^2 per sample. q is the percentile rank of
 * V(x) = U(x) + R(x) + lambda_B [R(x) - B]+ (E11) among all areas with a
 * utility, ignoring firm limits; q = (below + ties/2 + 0.5) / m.
 */
function likeArea(x: number, like: boolean, belief: { theta: Float64Array }, util: UtilityMatrix, ctx: AreaContext, profile: Profile, out: Float64Array): void {
  const nA = util.nAreas;
  const B = profile.budget?.value;
  const members: number[] = [];
  for (let a = 0; a < nA; a++) if (util.nSamples > 0 && Number.isFinite(util.u[a]!)) members.push(a);
  const m = members.length;
  const add = new Float64Array(nA);
  const over = new Float64Array(nA);
  for (const a of members) {
    add[a] = ctx.rent[a]!;
    over[a] = B !== undefined ? Math.max(0, ctx.rent[a]! - B) : 0;
  }
  for (let i = 0; i < util.nSamples; i++) {
    const row = i * nA;
    const lambda = belief.theta[i * PARAM_COUNT + LAMBDA_B_INDEX]!;
    const vx = util.u[row + x]! + add[x]! + lambda * over[x]!;
    let below = 0;
    let ties = 0;
    for (const a of members) {
      if (a === x) continue;
      const v = util.u[row + a]! + add[a]! + lambda * over[a]!;
      if (v < vx) below++;
      else if (v === vx) ties++;
    }
    const q = (below + ties / 2 + 0.5) / m;
    out[i] = like ? q * q : (1 - q) * (1 - q);
  }
}

/** Fills out[i] with L_e(theta_i) in [0, 1]. Uninformative items (an area that lost its utility after a profile change) give 1 everywhere. */
export const likelihood: Likelihood = (e, belief, util, ctx, profile, out) => {
  const n = belief.n;
  const B = belief.scale;
  const beta = BETA_SHARE * B;
  const tau = TAU_SHARE * B;
  const nA = util.nAreas;
  const th = belief.theta;
  switch (e.type) {
    case 'prefer_area': {
      const idx = scorableIndices([e.a, e.b], ctx, util);
      const a = ctx.index.get(e.a);
      const b = ctx.index.get(e.b);
      if (idx.length < 2 || a === undefined || b === undefined) return void out.fill(1);
      for (let i = 0; i < n; i++) out[i] = sigmoid((util.u[i * nA + a]! - util.u[i * nA + b]!) / beta);
      return;
    }
    case 'pick_from_set':
    case 'reject_area': {
      const pickId = e.type === 'pick_from_set' ? e.chosen : e.rejected;
      const members = scorableIndices(e.set, ctx, util);
      const pick = ctx.index.get(pickId);
      if (pick === undefined || !members.includes(pick) || members.length < 2) return void out.fill(1);
      for (let i = 0; i < n; i++) {
        const p = Math.exp(logChoice(util.u, i * nA, pick, members, beta));
        out[i] = e.type === 'pick_from_set' ? p : 1 - p;
      }
      return;
    }
    case 'direction': {
      const p = featureParam(e.feature);
      for (let i = 0; i < n; i++) out[i] = sigmoid((e.sign * th[i * PARAM_COUNT + p]!) / tau);
      return;
    }
    case 'magnitude': {
      const p = featureParam(e.feature);
      const target = Math.log(B * MAGNITUDE_TIER_SHARE[e.tier]);
      const floor = 1e-9 * B; // E22: ln|w| at w = 0
      const denom = 2 * MAGNITUDE_LOG_SD * MAGNITUDE_LOG_SD;
      for (let i = 0; i < n; i++) {
        const d = Math.log(Math.max(Math.abs(th[i * PARAM_COUNT + p]!), floor)) - target;
        out[i] = Math.exp(-(d * d) / denom);
      }
      return;
    }
    case 'compare_importance': {
      const pm = featureParam(e.more);
      const pl = featureParam(e.less);
      for (let i = 0; i < n; i++) {
        const row = i * PARAM_COUNT;
        out[i] = sigmoid((Math.abs(th[row + pm]!) - Math.abs(th[row + pl]!)) / tau);
      }
      return;
    }
    case 'time_tradeoff': {
      const trips = tradeoffTrips(e, profile);
      const hours = trips === null ? 0 : monthlyHours(e.minutes, trips);
      if (!(hours > 0) || !(e.yen > 0)) return void out.fill(1); // E10
      const cStar = e.yen / hours;
      const sign = e.accept ? 1 : -1;
      for (let i = 0; i < n; i++) out[i] = sigmoid((sign * (th[i * PARAM_COUNT + C_T_INDEX]! - cStar)) / (0.25 * cStar));
      return;
    }
    case 'like_area':
    case 'dislike_area': {
      const x = ctx.index.get(e.area);
      if (x === undefined || util.nSamples === 0 || !Number.isFinite(util.u[x]!)) return void out.fill(1);
      likeArea(x, e.type === 'like_area', belief, util, ctx, profile, out);
      return;
    }
  }
};

/**
 * Binds a likelihood to one util/ctx/profile, for replay (whose signature
 * carries only prior, log and likelihood). The bound function ignores the
 * util/ctx/profile arguments it is called with.
 */
export function bindLikelihood(util: UtilityMatrix, ctx: AreaContext, profile: Profile): Likelihood {
  return (e, belief, _u, _c, _p, out) => likelihood(e, belief, util, ctx, profile, out);
}

/** p_e = sum_i pi_i ((1 - eps) L_i + eps). Strength alpha is not applied (spec). */
export const predictive: Predictive = (weights, likelihoods, epsilon = DEFAULT_EPSILON) => {
  let p = 0;
  for (let i = 0; i < weights.length; i++) {
    const l = likelihoods[i]!;
    const c = l > 1 ? 1 : l > 0 ? l : 0;
    p += weights[i]! * ((1 - epsilon) * c + epsilon);
  }
  return p;
};

/**
 * E06: 0.15 for two-outcome items, half of chance for a pick among n
 * (0.5 / n), and half of (n - 1) / n for a reject among n. E07: magnitude,
 * like_area and dislike_area are not outcome probabilities, so they are
 * exempt (threshold 0, never surprising).
 */
export const surpriseThreshold: SurpriseThreshold = (e) => {
  switch (e.type) {
    case 'pick_from_set':
      return 0.5 / new Set(e.set).size;
    case 'reject_area': {
      const n = new Set(e.set).size;
      return (0.5 * (n - 1)) / n;
    }
    case 'magnitude':
    case 'like_area':
    case 'dislike_area':
      return 0;
    default:
      return SURPRISE_TWO_OUTCOME;
  }
};

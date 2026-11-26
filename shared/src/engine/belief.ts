// The belief about the person: prior sampling, archetypes, effective sample
// size, replay and the summary (docs/plans/engine-spec.md, "The belief about
// the person"). Seeded; no DB, no model.
import { createRng } from './rng.js';
import {
  ARCHETYPES,
  FEATURE_KEYS,
  PARAM_COUNT,
  PARAM_KEYS,
  SOURCE_EPSILON,
  STRENGTH_ALPHA,
  type AreaContext,
  type Archetype,
  type Belief,
  type EffectiveSampleSize,
  type EvidenceSource,
  type FeatureKey,
  type ParamKey,
  type ParamSummary,
  type Profile,
  type Replay,
  type SamplePrior,
  type SummarizeBelief,
  type UtilityMatrix,
} from './types.js';

export const DEFAULT_SAMPLES = 4000;
export const DEFAULT_ESS_FLOOR = 200;

/** Index of each parameter in a packed sample. */
export const C_T_INDEX = 0;
export const FEATURE_OFFSET = 1;
export const LAMBDA_B_INDEX = FEATURE_OFFSET + FEATURE_KEYS.length; // 14
export const GAMMA_INDEX = LAMBDA_B_INDEX + 1; // 15

/** c_T median = scale / 133 (rent a third of pay, 160 paid hours, time at 40% of hourly pay). */
export const C_T_DIVISOR = 133;
export const C_T_SIGMA = 0.7;
export const W_SIGMA = 0.8;
/** Standard deviation of the either-sign weight (bars), as a share of scale. */
export const BARS_SD_SHARE = 0.03;
export const LAMBDA_B_SIGMA = 0.7;
export const GAMMA_MEDIAN = 3;
export const GAMMA_SIGMA = 0.5;

/** Archetype medians, percent of budget, in FEATURE_KEYS order (spec table; hand-set starting values; safety is a modest D10 addition). */
export const ARCHETYPE_PERCENT: Readonly<Record<Archetype, Readonly<Record<FeatureKey, number>>>> = {
  student: { supermarkets: 3, dining: 2, konbini: 3, cuisine_variety: 1, late_night: 3, health: 1, green_space: 1, residential_calm: 1, road_rail_exposure: -1, bars: 2, dining_reach: 2, connectedness: 2, safety: 1 },
  young_professional: { supermarkets: 2, dining: 4, konbini: 3, cuisine_variety: 3, late_night: 3, health: 1, green_space: 2, residential_calm: 2, road_rail_exposure: -2, bars: 2, dining_reach: 3, connectedness: 3, safety: 1 },
  couple: { supermarkets: 4, dining: 4, konbini: 1, cuisine_variety: 3, late_night: 1, health: 2, green_space: 3, residential_calm: 3, road_rail_exposure: -3, bars: 0, dining_reach: 2, connectedness: 2, safety: 2 },
  family: { supermarkets: 5, dining: 2, konbini: 1, cuisine_variety: 1, late_night: 0.5, health: 4, green_space: 5, residential_calm: 5, road_rail_exposure: -4, bars: -3, dining_reach: 1, connectedness: 1, safety: 3 },
  remote_worker: { supermarkets: 4, dining: 4, konbini: 2, cuisine_variety: 2, late_night: 1, health: 2, green_space: 4, residential_calm: 4, road_rail_exposure: -4, bars: 0, dining_reach: 2, connectedness: 1, safety: 2 },
};
/** Multiplier on the c_T median per archetype. */
export const ARCHETYPE_TIME_MULTIPLIER: Readonly<Record<Archetype, number>> = {
  student: 0.7,
  young_professional: 1.3,
  couple: 1.0,
  family: 1.0,
  remote_worker: 0.5,
};

const EITHER_SIGN: ReadonlySet<FeatureKey> = new Set<FeatureKey>(['bars']);

/** Features drawn from their own stream, so adding them left every earlier draw of a seed unchanged. */
const LATE_FEATURES: ReadonlySet<FeatureKey> = new Set<FeatureKey>(['safety']);
const LATE_STREAM_SALT = 0x5afe7e11;

/**
 * n weighted samples of theta, weights 1/n. Every yen parameter is a fraction
 * of `scale` and the draw order does not depend on it, so the same seed with a
 * different scale is a deterministic rescale (E08).
 */
export const samplePrior: SamplePrior = (scale, seed, n = DEFAULT_SAMPLES) => {
  const rng = createRng(seed);
  const lateRng = createRng((seed ^ LATE_STREAM_SALT) >>> 0);
  const theta = new Float64Array(n * PARAM_COUNT);
  const archetype = new Uint8Array(n);
  const weights = new Float64Array(n).fill(n > 0 ? 1 / n : 0);
  for (let i = 0; i < n; i++) {
    const k = rng.int(ARCHETYPES.length);
    const name = ARCHETYPES[k]!;
    const percent = ARCHETYPE_PERCENT[name];
    const row = i * PARAM_COUNT;
    archetype[i] = k;
    theta[row + C_T_INDEX] = (scale / C_T_DIVISOR) * ARCHETYPE_TIME_MULTIPLIER[name] * rng.lognormal(0, C_T_SIGMA);
    for (let j = 0; j < FEATURE_KEYS.length; j++) {
      const key = FEATURE_KEYS[j]!;
      const centre = scale * (percent[key] / 100);
      const r = LATE_FEATURES.has(key) ? lateRng : rng;
      theta[row + FEATURE_OFFSET + j] = EITHER_SIGN.has(key)
        ? centre + BARS_SD_SHARE * scale * r.normal()
        : centre * r.lognormal(0, W_SIGMA); // sign comes from the archetype percent
    }
    theta[row + LAMBDA_B_INDEX] = rng.lognormal(0, LAMBDA_B_SIGMA);
    theta[row + GAMMA_INDEX] = rng.lognormal(Math.log(GAMMA_MEDIAN), GAMMA_SIGMA);
  }
  return { n, theta, archetype, weights, scale };
};

/** ESS = 1 / sum of squared weights. */
export const effectiveSampleSize: EffectiveSampleSize = (weights) => {
  let s = 0;
  for (let i = 0; i < weights.length; i++) s += weights[i]! * weights[i]!;
  return s > 0 ? 1 / s : 0;
};

// The Replay signature carries no util/ctx/profile, so `likelihood` must be
// already bound to them (evidence.ts `bindLikelihood`). These placeholders
// fill the three positions; the unbound `likelihood` rejects them with a
// clear error rather than reading undefined.
const UNBOUND_UTIL = undefined as unknown as UtilityMatrix;
const UNBOUND_CTX = undefined as unknown as AreaContext;
const UNBOUND_PROFILE = undefined as unknown as Profile;

/**
 * Prior times every likelihood in the log:
 * pi_i proportional to prior_i * prod_e ((1 - eps_e) L_e(theta_i) + eps_e)^alpha_e,
 * eps_e = SOURCE_EPSILON[source] unless `epsilon` overrides it (R4).
 * E05: accumulated as log weights, normalised once. E17: items are applied in
 * id order, so any log order gives bit-identical weights.
 * `likelihood` must be bound to its util/ctx/profile (bindLikelihood).
 */
export const replay: Replay = (prior, log, likelihood, epsilon) => {
  const n = prior.n;
  const logw = new Float64Array(n);
  for (let i = 0; i < n; i++) logw[i] = Math.log(prior.weights[i]!);

  const ordered = [...log].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const out = new Float64Array(n);
  for (const e of ordered) {
    out.fill(0);
    likelihood(e, prior, UNBOUND_UTIL, UNBOUND_CTX, UNBOUND_PROFILE, out);
    const alpha = STRENGTH_ALPHA[e.strength ?? 'normal'] ?? 1;
    const eps = epsilon ?? itemEpsilon(e);
    for (let i = 0; i < n; i++) {
      const l = out[i]!;
      const clamped = l > 1 ? 1 : l > 0 ? l : 0; // NaN -> 0: the floor alone applies
      logw[i] = logw[i]! + alpha * Math.log((1 - eps) * clamped + eps);
    }
  }

  let max = -Infinity;
  for (let i = 0; i < n; i++) if (logw[i]! > max) max = logw[i]!;
  const weights = new Float64Array(n);
  if (!Number.isFinite(max)) {
    weights.set(prior.weights); // eps = 0 and everything ruled out: keep the prior
  } else {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.exp(logw[i]! - max);
      weights[i] = w;
      sum += w;
    }
    for (let i = 0; i < n; i++) weights[i] = weights[i]! / sum;
  }
  return { n, theta: prior.theta, archetype: prior.archetype, weights, scale: prior.scale };
};

/** Lapse rate of one item: by who produced it, text when unstated (R4). */
export function itemEpsilon(e: { source?: EvidenceSource }): number {
  return SOURCE_EPSILON[e.source ?? 'text'];
}

/** Weighted quantiles of one parameter: smallest value whose cumulative weight reaches q. */
function weightedQuantiles(belief: Belief, p: number, qs: readonly number[]): number[] {
  const n = belief.n;
  const order = new Uint32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  const value = (i: number): number => belief.theta[i * PARAM_COUNT + p]!;
  order.sort((a, b) => value(a) - value(b));
  let total = 0;
  for (let i = 0; i < n; i++) total += belief.weights[i]!;
  const out = qs.map(() => NaN);
  let cum = 0;
  let next = 0;
  for (let k = 0; k < n && next < qs.length; k++) {
    const i = order[k]!;
    cum += belief.weights[i]!;
    while (next < qs.length && cum >= qs[next]! * total - 1e-12) {
      out[next] = value(i);
      next++;
    }
  }
  if (n > 0) for (; next < qs.length; next++) out[next] = value(order[n - 1]!);
  return out;
}

/** Weighted median and 10th to 90th percentile per parameter, plus ESS. */
export const summarizeBelief: SummarizeBelief = (belief, essFloor = DEFAULT_ESS_FLOOR) => {
  const params: ParamSummary[] = PARAM_KEYS.map((param, p) => {
    const [p10, median, p90] = weightedQuantiles(belief, p, [0.1, 0.5, 0.9]) as [number, number, number];
    const yen = p !== LAMBDA_B_INDEX && p !== GAMMA_INDEX;
    return {
      param,
      median,
      p10,
      p90,
      shareOfBudget: yen
        ? { median: median / belief.scale, p10: p10 / belief.scale, p90: p90 / belief.scale }
        : null,
    };
  });
  const ess = effectiveSampleSize(belief.weights);
  return { params, ess, lowConfidence: ess < essFloor, scale: belief.scale };
};

/**
 * The parameter that most distinguishes the samples in `mask` from all
 * samples: largest |mean within - mean overall| / overall sd (E13). ratio is
 * mean within / mean overall (0 when the overall mean is 0).
 */
export function distinguishingParam(belief: Belief, mask: Uint8Array): { param: ParamKey; direction: 'higher' | 'lower'; weight: number; ratio: number } | null {
  const { mean, sd } = weightedMoments(belief);
  const within = new Float64Array(PARAM_COUNT);
  let weight = 0;
  for (let i = 0; i < belief.n; i++) {
    if (!mask[i]) continue;
    const w = belief.weights[i]!;
    weight += w;
    for (let p = 0; p < PARAM_COUNT; p++) within[p] = within[p]! + w * belief.theta[i * PARAM_COUNT + p]!;
  }
  if (!(weight > 0)) return null;
  let best = 0;
  let bestZ = -1;
  for (let p = 0; p < PARAM_COUNT; p++) {
    within[p] = within[p]! / weight;
    const z = sd[p]! > 0 ? Math.abs(within[p]! - mean[p]!) / sd[p]! : 0;
    if (z > bestZ) {
      bestZ = z;
      best = p;
    }
  }
  const direction = within[best]! >= mean[best]! ? 'higher' : 'lower';
  const ratio = mean[best]! !== 0 ? within[best]! / mean[best]! : 0;
  return { param: PARAM_KEYS[best]!, direction, weight, ratio };
}

/** Weighted mean and standard deviation of every parameter, plus the mean of gamma * c_T (for exact expected U). */
export function weightedMoments(belief: Belief): { mean: Float64Array; sd: Float64Array; gammaCt: number } {
  const mean = new Float64Array(PARAM_COUNT);
  const sq = new Float64Array(PARAM_COUNT);
  let gammaCt = 0;
  let total = 0;
  for (let i = 0; i < belief.n; i++) {
    const w = belief.weights[i]!;
    total += w;
    const row = i * PARAM_COUNT;
    for (let p = 0; p < PARAM_COUNT; p++) {
      const v = belief.theta[row + p]!;
      mean[p] = mean[p]! + w * v;
      sq[p] = sq[p]! + w * v * v;
    }
    gammaCt += w * belief.theta[row + GAMMA_INDEX]! * belief.theta[row + C_T_INDEX]!;
  }
  const sd = new Float64Array(PARAM_COUNT);
  if (total > 0) {
    for (let p = 0; p < PARAM_COUNT; p++) {
      mean[p] = mean[p]! / total;
      sd[p] = Math.sqrt(Math.max(0, sq[p]! / total - mean[p]! * mean[p]!));
    }
    gammaCt /= total;
  }
  return { mean, sd, gammaCt };
}

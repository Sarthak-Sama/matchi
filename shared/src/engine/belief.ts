// The belief about the person: prior sampling, archetypes, effective sample
// size, replay and the summary (docs/plans/engine-spec.md, "The belief about
// the person"). Seeded; no DB, no model.
// rejuvenate() reads evidence.ts and recommend.ts, which import constants
// from here; the cycle is safe because nothing is read at module load.
import { bindLikelihood } from './evidence.js';
import { noiseFreeUtilities } from './recommend.js';
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
  type Likelihood,
  type LoggedEvidence,
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
/** The one parameter that can take either sign; every other one keeps its sign. */
const BARS_INDEX = FEATURE_OFFSET + FEATURE_KEYS.indexOf('bars');

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
  addLogLikelihood(logw, prior, log, likelihood, epsilon);

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

/** logw[i] += sum_e alpha_e log((1 - eps_e) L_e(theta_i) + eps_e), items in id order (E17). */
function addLogLikelihood(logw: Float64Array, belief: Belief, log: readonly LoggedEvidence[], likelihood: Likelihood, epsilon?: number): void {
  const n = belief.n;
  const ordered = [...log].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const out = new Float64Array(n);
  for (const e of ordered) {
    out.fill(0);
    likelihood(e, belief, UNBOUND_UTIL, UNBOUND_CTX, UNBOUND_PROFILE, out);
    const alpha = STRENGTH_ALPHA[e.strength ?? 'normal'] ?? 1;
    const eps = epsilon ?? itemEpsilon(e);
    for (let i = 0; i < n; i++) {
      const l = out[i]!;
      const clamped = l > 1 ? 1 : l > 0 ? l : 0; // NaN -> 0: the floor alone applies
      logw[i] = logw[i]! + alpha * Math.log((1 - eps) * clamped + eps);
    }
  }
}

/** Lapse rate of one item: by who produced it, text when unstated (R4). */
export function itemEpsilon(e: { source?: EvidenceSource }): number {
  return SOURCE_EPSILON[e.source ?? 'text'];
}

/** Rejuvenate when ESS falls below this share of n (R1). */
export const REJUVENATE_ESS_SHARE = 0.25;
export const MH_STEPS = 2;
/** Random-walk step per parameter, as a share of its weighted sd in walk coordinates. */
export const MH_STEP_SHARE = 0.3;

/** ESS before any rejuvenation move; after one the weights are uniform and ESS would always read n (R1). */
export function preMoveEss(belief: Belief): number {
  return belief.essBeforeMove ?? effectiveSampleSize(belief.weights);
}

/**
 * R1: when the replayed weights have collapsed (ESS < n / 4), resample and
 * move the samples with MH_STEPS Metropolis-Hastings steps that leave the
 * posterior invariant. `belief` is replay(prior, log); `util` is the
 * noise-free utility of the prior samples, left untouched. Returns the moved
 * belief (uniform weights) with its own noise-free utilities, or the inputs
 * unchanged when ESS is fine. Deterministic in (seed, log length).
 *
 * Target: the posterior density over the ORIGINAL parameters theta given the
 * fixed archetype k, pi(theta) = p(theta | k) * prod_e ((1 - eps_e) L_e + eps_e)^alpha_e,
 * the same product replay weights by. Proposal: a Gaussian random walk on
 * log|theta_p| (sign kept) for every parameter but bars, and on theta itself
 * for bars. That walk is symmetric in log space, not in theta, so the
 * Hastings ratio carries the Jacobian: q(theta | theta') / q(theta' | theta)
 * = prod_p |theta'_p| / |theta_p|. Acceptance:
 * log a = log pi(theta') - log pi(theta) + sum_p (log|theta'_p| - log|theta_p|).
 */
export function rejuvenate(
  belief: Belief,
  prior: Belief,
  util: UtilityMatrix,
  log: readonly LoggedEvidence[],
  ctx: AreaContext,
  profile: Profile,
  seed: number,
): { belief: Belief; util: UtilityMatrix } {
  const n = belief.n;
  const essBeforeMove = effectiveSampleSize(belief.weights);
  if (n === 0 || essBeforeMove >= REJUVENATE_ESS_SHARE * n) return { belief, util };

  const rng = createRng(moveSeed(seed, log.length));
  const step = walkSd(belief).map((sd) => MH_STEP_SHARE * sd);
  const logLik = new Float64Array(n);
  addLogLikelihood(logLik, prior, log, bindLikelihood(util, ctx, profile));

  // Systematic resampling: copies of prior samples carry their utility rows and log-likelihoods.
  const picks = systematicResample(belief.weights, rng.next());
  const nA = util.nAreas;
  const theta = new Float64Array(n * PARAM_COUNT);
  const archetype = new Uint8Array(n);
  const u = new Float32Array(n * nA);
  const curLik = new Float64Array(n);
  const curPrior = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const src = picks[i]!;
    theta.set(prior.theta.subarray(src * PARAM_COUNT, (src + 1) * PARAM_COUNT), i * PARAM_COUNT);
    archetype[i] = prior.archetype[src]!;
    u.set(util.u.subarray(src * nA, (src + 1) * nA), i * nA);
    curLik[i] = logLik[src]!;
  }
  const uniform = new Float64Array(n).fill(1 / n);
  const moved: Belief = { n, theta, archetype, weights: uniform, scale: prior.scale, rejuvenated: true, essBeforeMove };
  for (let i = 0; i < n; i++) curPrior[i] = logPriorDensity(moved, i);

  for (let s = 0; s < MH_STEPS; s++) {
    const proposal = new Float64Array(n * PARAM_COUNT);
    const logJacobian = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const row = i * PARAM_COUNT;
      for (let p = 0; p < PARAM_COUNT; p++) {
        const v = theta[row + p]!;
        const dz = step[p]! * rng.normal();
        if (p === BARS_INDEX) {
          proposal[row + p] = v + dz;
        } else {
          proposal[row + p] = v * Math.exp(dz); // log|v'| = log|v| + dz, sign kept
          logJacobian[i] = logJacobian[i]! + dz;
        }
      }
    }
    const proposed: Belief = { n, theta: proposal, archetype, weights: uniform, scale: prior.scale };
    const propUtil = noiseFreeUtilities(proposed, ctx, profile);
    const propLik = new Float64Array(n);
    addLogLikelihood(propLik, proposed, log, bindLikelihood(propUtil, ctx, profile));
    for (let i = 0; i < n; i++) {
      const propPrior = logPriorDensity(proposed, i);
      const logA = propLik[i]! + propPrior - curLik[i]! - curPrior[i]! + logJacobian[i]!;
      if (!(Math.log(rng.next()) < logA)) continue; // NaN rejects
      theta.set(proposal.subarray(i * PARAM_COUNT, (i + 1) * PARAM_COUNT), i * PARAM_COUNT);
      u.set(propUtil.u.subarray(i * nA, (i + 1) * nA), i * nA);
      curLik[i] = propLik[i]!;
      curPrior[i] = propPrior;
    }
  }

  return { belief: moved, util: { u, nSamples: n, nAreas: nA, noisy: { areaIdx: new Int32Array(0), u: new Float32Array(0) } } };
}

/** Seed of the resampling and move stream: one per (session seed, log length). */
function moveSeed(seed: number, logLength: number): number {
  return (Math.imul(seed ^ 0x2545f491, 0x9e3779b1) ^ Math.imul(logLength + 1, 0x85ebca6b)) >>> 0;
}

/** Indices of n draws by systematic resampling: one uniform offset u0 in [0, 1), points (k + u0) / n. */
function systematicResample(weights: Float64Array, u0: number): Uint32Array {
  const n = weights.length;
  let total = 0;
  for (let i = 0; i < n; i++) total += weights[i]!;
  const picks = new Uint32Array(n);
  let cum = weights[0]! / total;
  let src = 0;
  for (let k = 0; k < n; k++) {
    const point = (k + u0) / n;
    while (cum < point && src < n - 1) cum += weights[++src]! / total;
    picks[k] = src;
  }
  return picks;
}

/** Weighted sd of each parameter in the random walk's coordinates: log|theta| except bars. */
function walkSd(belief: Belief): number[] {
  const mean = new Float64Array(PARAM_COUNT);
  const sq = new Float64Array(PARAM_COUNT);
  let total = 0;
  for (let i = 0; i < belief.n; i++) {
    const w = belief.weights[i]!;
    total += w;
    for (let p = 0; p < PARAM_COUNT; p++) {
      const v = belief.theta[i * PARAM_COUNT + p]!;
      const x = p === BARS_INDEX ? v : Math.log(Math.abs(v));
      mean[p] = mean[p]! + w * x;
      sq[p] = sq[p]! + w * x * x;
    }
  }
  return Array.from(mean, (m, p) => {
    const mu = m / total;
    return Math.sqrt(Math.max(0, sq[p]! / total - mu * mu));
  });
}

/** log of the lognormal density of |x| at median `median` (x and median of one sign): density over x, not log x. */
function logLognormal(x: number, median: number, sigma: number): number {
  const lx = Math.log(Math.abs(x));
  const d = lx - Math.log(Math.abs(median));
  return -lx - (d * d) / (2 * sigma * sigma);
}

/**
 * log p(theta_i | archetype_i) over the original parameters, up to a constant
 * that depends only on the archetype and scale (the archetype never moves).
 * Mirrors samplePrior.
 */
function logPriorDensity(belief: Belief, i: number): number {
  const scale = belief.scale;
  const name = ARCHETYPES[belief.archetype[i]!]!;
  const percent = ARCHETYPE_PERCENT[name];
  const row = i * PARAM_COUNT;
  const th = belief.theta;
  let lp = logLognormal(th[row + C_T_INDEX]!, (scale / C_T_DIVISOR) * ARCHETYPE_TIME_MULTIPLIER[name], C_T_SIGMA);
  for (let j = 0; j < FEATURE_KEYS.length; j++) {
    const key = FEATURE_KEYS[j]!;
    const centre = scale * (percent[key] / 100);
    const v = th[row + FEATURE_OFFSET + j]!;
    if (EITHER_SIGN.has(key)) {
      const d = (v - centre) / (BARS_SD_SHARE * scale);
      lp -= (d * d) / 2;
    } else {
      lp += logLognormal(v, centre, W_SIGMA);
    }
  }
  lp += logLognormal(th[row + LAMBDA_B_INDEX]!, 1, LAMBDA_B_SIGMA);
  lp += logLognormal(th[row + GAMMA_INDEX]!, GAMMA_MEDIAN, GAMMA_SIGMA);
  return lp;
}

/** Weighted median of one parameter. */
export function weightedMedian(belief: Belief, p: number): number {
  return weightedQuantiles(belief, p, [0.5])[0]!;
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
  const ess = preMoveEss(belief);
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

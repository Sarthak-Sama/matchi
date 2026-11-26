// Hidden people for the simulation, drawn from a model the engine does not use.
// The engine's prior (belief.ts samplePrior) is never called here: weights are
// Dirichlet shares of an income-scaled pool (income is drawn independently of
// the budget), the value of travel time comes from a wage, archetypes are
// correlated bundles, and answers are Thurstone (probit) choices with random
// lapses rather than the engine's logistic choice model.
import { FEATURE_KEYS, PARAM_COUNT, createRng } from '@tokyo/shared';
import type { Belief, FeatureKey, Rng } from '@tokyo/shared';

export const HIDDEN_ARCHETYPES = ['student', 'family', 'remote_worker', 'other'] as const;
export type HiddenArchetype = (typeof HIDDEN_ARCHETYPES)[number];

const MEDIAN_INCOME_YEN = 280_000;
const INCOME_SIGMA = 0.35;
const PAID_HOURS_PER_MONTH = 160;
/** Share of monthly income spread over the area features. */
const FEATURE_POOL_SHARE = 0.12;
/** Value of an hour of travel, as a share of the hourly wage (median, then log sd). */
const TIME_VALUE_SHARE = 0.4;
const TIME_VALUE_SIGMA = 0.3;
const BASE_CONCENTRATION = 1.5;
/** Probit noise sd on the value of an option, as a share of the scale (the budget). */
export const PROBIT_SD_SHARE = 0.05;
export const LAPSE_RATE = 0.1;

interface Bundle {
  /** Share of the population. */
  share: number;
  incomeMultiplier: number;
  /** Multiplier on the value of travel time. */
  timeMultiplier: number;
  /** Multipliers on the Dirichlet concentration of a feature (1 when absent). */
  emphasis: Partial<Record<FeatureKey, number>>;
  /** Sign of the bars weight: 1 likes them, -1 dislikes them, 0 a coin flip. */
  barsSign: -1 | 0 | 1;
}

const BUNDLES: Record<HiddenArchetype, Bundle> = {
  student: {
    share: 0.2,
    incomeMultiplier: 0.45,
    timeMultiplier: 0.6,
    emphasis: { dining: 2.5, konbini: 2.5, late_night: 3, bars: 3, connectedness: 2.5, dining_reach: 2 },
    barsSign: 1,
  },
  family: {
    share: 0.25,
    incomeMultiplier: 1.3,
    timeMultiplier: 1,
    emphasis: { supermarkets: 3, health: 3, green_space: 3, residential_calm: 3, road_rail_exposure: 2, safety: 4 },
    barsSign: -1,
  },
  remote_worker: {
    share: 0.2,
    incomeMultiplier: 1,
    timeMultiplier: 0.3,
    emphasis: { green_space: 2.5, residential_calm: 2.5, dining: 2.5, supermarkets: 2, connectedness: 0.4 },
    barsSign: 0,
  },
  other: { share: 0.35, incomeMultiplier: 1, timeMultiplier: 1, emphasis: {}, barsSign: 0 },
};

/** Weights on these features are negative (a nuisance), as in the engine's utility. */
const NEGATIVE_FEATURES: ReadonlySet<FeatureKey> = new Set<FeatureKey>(['road_rail_exposure']);

export interface HiddenUser {
  archetype: HiddenArchetype;
  incomeYen: number;
  /** Packed like the engine's parameter vector: c_t, one weight per feature, lambda_b, gamma. */
  theta: number[];
}

/** Gamma(shape, 1) by Marsaglia and Tsang; shapes below 1 are boosted. */
function gamma(shape: number, rng: Rng): number {
  if (shape < 1) return gamma(shape + 1, rng) * Math.pow(rng.next() || 1e-12, 1 / shape);
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    const x = rng.normal();
    const v = Math.pow(1 + c * x, 3);
    if (v <= 0) continue;
    const u = rng.next() || 1e-12;
    if (Math.log(u) < 0.5 * x * x + d - d * v + d * Math.log(v)) return d * v;
  }
}

function dirichlet(concentration: readonly number[], rng: Rng): number[] {
  const draws = concentration.map((a) => gamma(a, rng));
  const total = draws.reduce((s, x) => s + x, 0);
  return draws.map((x) => x / total);
}

function drawArchetype(rng: Rng): HiddenArchetype {
  let u = rng.next();
  for (const name of HIDDEN_ARCHETYPES) {
    u -= BUNDLES[name].share;
    if (u < 0) return name;
  }
  return 'other';
}

function drawUser(rng: Rng): HiddenUser {
  const archetype = drawArchetype(rng);
  const bundle = BUNDLES[archetype];
  const incomeYen = MEDIAN_INCOME_YEN * bundle.incomeMultiplier * rng.lognormal(0, INCOME_SIGMA);
  const shares = dirichlet(
    FEATURE_KEYS.map((key) => BASE_CONCENTRATION * (bundle.emphasis[key] ?? 1)),
    rng,
  );
  const pool = FEATURE_POOL_SHARE * incomeYen;
  const barsSign = bundle.barsSign !== 0 ? bundle.barsSign : rng.next() < 0.5 ? -1 : 1;
  const theta = new Array<number>(PARAM_COUNT).fill(0);
  theta[0] = (incomeYen / PAID_HOURS_PER_MONTH) * TIME_VALUE_SHARE * bundle.timeMultiplier * rng.lognormal(0, TIME_VALUE_SIGMA);
  FEATURE_KEYS.forEach((key, j) => {
    const sign = NEGATIVE_FEATURES.has(key) ? -1 : key === 'bars' ? barsSign : 1;
    theta[1 + j] = sign * pool * shares[j]!;
  });
  theta[1 + FEATURE_KEYS.length] = rng.lognormal(Math.log(1.2), 0.5); // lambda_b
  theta[2 + FEATURE_KEYS.length] = rng.lognormal(Math.log(4), 0.5); // gamma
  return { archetype, incomeYen, theta };
}

export function generateUsers(n: number, seed: number): HiddenUser[] {
  const rng = createRng(seed);
  return Array.from({ length: n }, () => drawUser(rng));
}

/** The users as a uniform-weight belief, which is the shape the engine's utility builder takes. */
export function asBelief(users: readonly HiddenUser[], scale: number): Belief {
  const n = users.length;
  const theta = new Float64Array(n * PARAM_COUNT);
  users.forEach((user, i) => theta.set(user.theta, i * PARAM_COUNT));
  return { n, theta, archetype: new Uint8Array(n), weights: new Float64Array(n).fill(1 / n), scale };
}

/** Thurstone choice: the option with the highest value plus probit noise, or a uniformly random one on a lapse. Returns an index. */
export function chooseProbit(values: readonly number[], scale: number, rng: Rng): number {
  if (rng.next() < LAPSE_RATE) return rng.int(values.length);
  let best = 0;
  let bestScore = -Infinity;
  values.forEach((v, i) => {
    const score = v + PROBIT_SD_SHARE * scale * rng.normal();
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}

/** Would the person pay `yen` a month for `hoursSaved` hours of travel a month? Probit noise, with lapses. */
export function acceptsTradeoff(user: HiddenUser, yen: number, hoursSaved: number, scale: number, rng: Rng): boolean {
  if (rng.next() < LAPSE_RATE) return rng.next() < 0.5;
  return user.theta[0]! * hoursSaved - yen + PROBIT_SD_SHARE * scale * rng.normal() >= 0;
}

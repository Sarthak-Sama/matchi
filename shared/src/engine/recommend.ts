// Utility matrix, greedy shortlist, P_best, regret, risk, stop rule and next
// question (docs/plans/engine-spec.md, "The shortlist", "Ask or stop").
// E01: EUS, Risk, regret, the stop rule and question choice read the
// noise-free util.u; rent and travel noise exists only in util.noisy (P_best)
// and in noisyUtilities (compare).
import { C_T_INDEX, FEATURE_OFFSET, GAMMA_INDEX, LAMBDA_B_INDEX, distinguishingParam } from './belief.js';
import { breakdownAt, medianFeasibleArea, subtractBreakdown } from './explain.js';
import { areaTerms, capHours, travelHours } from './features.js';
import { createRng } from './rng.js';
import {
  FEATURE_KEYS,
  PARAM_COUNT,
  type AreaConfidence,
  type AreaContext,
  type Belief,
  type BuildUtilities,
  type EngineDefaults,
  type GreedyShortlist,
  type NextQuestion,
  type NoisyUtilities,
  type PBest,
  type Profile,
  type ProfileResult,
  type Recommend,
  type Recommendation,
  type RiskOfSet,
  type ShortlistItem,
  type UtilityMatrix,
} from './types.js';

export const DEFAULTS: EngineDefaults = {
  samples: 4000,
  shortlistSize: 5,
  betaShare: 0.03,
  tauShare: 0.01,
  epsilon: 0.05,
  stopRiskShare: 0.01,
  maxQuestions: 6,
  minQuestions: 2,
  minEvoiShare: 0.003,
  surpriseThreshold: 0.15,
  sigmaRentNear: 0.08,
  sigmaRentFar: 0.12,
  travelNoiseShare: 0.15,
  travelNoiseMinMinutes: 3,
  rentClamp: [0.7, 1.4],
  essFloor: 200,
};
/** Areas covered by util.noisy. */
export const NOISY_TOP = 20;
/** Shortcut pair question: only areas with P_best above this. */
export const PAIR_MIN_PBEST = 0.05;

const NF = FEATURE_KEYS.length;

/** Noise-free U for every sample and area; -Infinity where U is undefined (null inputs, disconnected). */
function noiseFreeU(belief: Belief, ctx: AreaContext, profile: Profile): Float32Array {
  const nA = ctx.areas.length;
  const terms = areaTerms(ctx, profile);
  const u = new Float32Array(belief.n * nA);
  const w = new Float64Array(NF);
  for (let i = 0; i < belief.n; i++) {
    const row = i * PARAM_COUNT;
    const c = belief.theta[row + C_T_INDEX]!;
    const lambda = belief.theta[row + LAMBDA_B_INDEX]!;
    const gamma = belief.theta[row + GAMMA_INDEX]!;
    for (let j = 0; j < NF; j++) w[j] = belief.theta[row + FEATURE_OFFSET + j]!;
    const out = i * nA;
    for (let a = 0; a < nA; a++) {
      if (!terms.scorable[a]) {
        u[out + a] = -Infinity;
        continue;
      }
      let v = -ctx.rent[a]! - c * terms.hours[a]! - lambda * terms.overBudget[a]! - gamma * c * terms.overCap[a]!;
      const s = a * NF;
      for (let j = 0; j < NF; j++) v += w[j]! * ctx.sat[s + j]!;
      u[out + a] = v;
    }
  }
  return u;
}

/** Weighted expected noise-free utility per area. */
export function expectedUtility(util: UtilityMatrix, weights: Float64Array): Float64Array {
  const nA = util.nAreas;
  const eu = new Float64Array(nA);
  for (let i = 0; i < util.nSamples; i++) {
    const w = weights[i]!;
    if (w === 0) continue;
    const row = i * nA;
    for (let a = 0; a < nA; a++) eu[a] = eu[a]! + w * util.u[row + a]!;
  }
  return eu;
}

/** Feasible areas with the highest expected noise-free utility, at most `top`. */
export function topFeasible(util: UtilityMatrix, weights: Float64Array, feasible: Uint8Array, top: number): number[] {
  const eu = expectedUtility(util, weights);
  const idx: number[] = [];
  for (let a = 0; a < util.nAreas; a++) if (feasible[a] && Number.isFinite(eu[a]!)) idx.push(a);
  idx.sort((x, y) => eu[y]! - eu[x]! || x - y);
  return idx.slice(0, top);
}

/** Per-area seed so the noise draws z for (sample, area) do not depend on which areas are requested. */
function areaSeed(seed: number, a: number): number {
  return (Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(a + 1, 0xc2b2ae35)) >>> 0;
}

/**
 * Noisy U for the given areas: R_i = R exp(sigma z - sigma^2 / 2) (E09,
 * mean-preserving), t_im = max(1, t + max(3, 0.15 t) z) with one travel z per
 * sample and area shared by all anchors (spec; E09 clamp at 1 minute).
 */
export const noisyUtilities: NoisyUtilities = (belief, ctx, profile, seed, areaIdx) => {
  const nC = areaIdx.length;
  const u = new Float32Array(belief.n * nC);
  const terms = areaTerms(ctx, profile);
  const tc = capHours(profile);
  const B = profile.budget?.value;
  const nM = ctx.minutes.length;
  const mins: number[] = new Array(nM).fill(0);
  for (let col = 0; col < nC; col++) {
    const a = areaIdx[col]!;
    if (!terms.scorable[a]) {
      for (let i = 0; i < belief.n; i++) u[i * nC + col] = -Infinity;
      continue;
    }
    const rng = createRng(areaSeed(seed, a));
    const sigma = ctx.sigmaRent[a]!;
    const s = a * NF;
    for (let i = 0; i < belief.n; i++) {
      const zR = rng.normal();
      const zT = rng.normal();
      const rent = ctx.rent[a]! * Math.exp(sigma * zR - (sigma * sigma) / 2);
      for (let m = 0; m < nM; m++) {
        const t = ctx.minutes[m]![a]!;
        mins[m] = Math.max(1, t + Math.max(DEFAULTS.travelNoiseMinMinutes, DEFAULTS.travelNoiseShare * t) * zT);
      }
      const th = travelHours(mins, profile);
      const row = i * PARAM_COUNT;
      const c = belief.theta[row + C_T_INDEX]!;
      let v =
        -rent -
        c * th.hours -
        belief.theta[row + LAMBDA_B_INDEX]! * (B !== undefined ? Math.max(0, rent - B) : 0) -
        belief.theta[row + GAMMA_INDEX]! * c * (tc !== null ? Math.max(0, th.main - tc) : 0);
      for (let j = 0; j < NF; j++) v += belief.theta[row + FEATURE_OFFSET + j]! * ctx.sat[s + j]!;
      u[i * nC + col] = v;
    }
  }
  return { areaIdx: Int32Array.from(areaIdx), u };
};

export const buildUtilities: BuildUtilities = (belief, ctx, profile, seed) => {
  const util: UtilityMatrix = {
    u: noiseFreeU(belief, ctx, profile),
    nSamples: belief.n,
    nAreas: ctx.areas.length,
    noisy: { areaIdx: new Int32Array(0), u: new Float32Array(0) },
  };
  return refreshNoisy(util, belief, ctx, profile, seed);
};

/** Rebuilds util.noisy for the current weights' top 20 (call after every replay). */
export function refreshNoisy(util: UtilityMatrix, belief: Belief, ctx: AreaContext, profile: Profile, seed: number): UtilityMatrix {
  const idx = topFeasible(util, belief.weights, ctx.feasible, NOISY_TOP);
  const same = idx.length === util.noisy.areaIdx.length && idx.every((a, c) => util.noisy.areaIdx[c] === a);
  if (same) return util;
  return { ...util, noisy: noisyUtilities(belief, ctx, profile, seed, idx) };
}

/** Per-sample maximum of u over the feasible areas (-Infinity when none). */
function maxOverFeasible(util: UtilityMatrix, feasible: Uint8Array): Float64Array {
  const nA = util.nAreas;
  const out = new Float64Array(util.nSamples).fill(-Infinity);
  for (let i = 0; i < util.nSamples; i++) {
    const row = i * nA;
    let m = -Infinity;
    for (let a = 0; a < nA; a++) if (feasible[a] && util.u[row + a]! > m) m = util.u[row + a]!;
    out[i] = m;
  }
  return out;
}

/** Greedy maximisation of EUS(S) over feasible areas, min(k, |F|) picks (E16). Returns picks in greedy order. */
export const greedyShortlist: GreedyShortlist = (util, weights, feasible, k) => {
  const nA = util.nAreas;
  const cur = new Float64Array(util.nSamples).fill(-Infinity);
  const chosen: number[] = [];
  const candidates: number[] = [];
  for (let a = 0; a < nA; a++) if (feasible[a] && Number.isFinite(util.u[a]!)) candidates.push(a);
  const picks = Math.min(Math.max(0, Math.floor(k)), candidates.length);
  for (let step = 0; step < picks; step++) {
    let best = -1;
    let bestVal = -Infinity;
    for (const a of candidates) {
      if (chosen.includes(a)) continue;
      let v = 0;
      for (let i = 0; i < util.nSamples; i++) {
        const x = util.u[i * nA + a]!;
        v += weights[i]! * (x > cur[i]! ? x : cur[i]!);
      }
      if (v > bestVal) {
        bestVal = v;
        best = a;
      }
    }
    if (best < 0) break;
    chosen.push(best);
    for (let i = 0; i < util.nSamples; i++) {
      const x = util.u[i * nA + best]!;
      if (x > cur[i]!) cur[i] = x;
    }
  }
  return chosen;
};

/** P_best over the noisy top-20 feasible areas; zero elsewhere; sums to 1 when any are feasible. */
export const pBest: PBest = (util, weights, feasible) => {
  const out = new Float64Array(util.nAreas);
  const { areaIdx, u } = util.noisy;
  const nC = areaIdx.length;
  for (let i = 0; i < util.nSamples; i++) {
    let best = -1;
    let bestVal = -Infinity;
    for (let c = 0; c < nC; c++) {
      if (!feasible[areaIdx[c]!]) continue;
      const v = u[i * nC + c]!;
      if (best < 0 || v > bestVal) {
        best = c;
        bestVal = v;
      }
    }
    if (best >= 0) out[areaIdx[best]!] = out[areaIdx[best]!]! + weights[i]!;
  }
  return out;
};

/** Risk(S) = sum_i pi_i (max_F u_i - max_S u_i), noise-free. 0 when nothing is feasible. */
export const riskOfSet: RiskOfSet = (util, weights, feasible, set) => {
  const maxF = maxOverFeasible(util, feasible);
  const nA = util.nAreas;
  let risk = 0;
  for (let i = 0; i < util.nSamples; i++) {
    if (!Number.isFinite(maxF[i]!)) continue;
    let m = -Infinity;
    for (const a of set) if (util.u[i * nA + a]! > m) m = util.u[i * nA + a]!;
    if (!Number.isFinite(m)) return Infinity; // empty set against a non-empty F
    risk += weights[i]! * Math.max(0, maxF[i]! - m);
  }
  return risk;
};

/** Noise-free P(a beats b) under the weights; ties count half. */
export function pABeatsB(util: UtilityMatrix, weights: Float64Array, a: number, b: number): number {
  let p = 0;
  for (let i = 0; i < util.nSamples; i++) {
    const x = util.u[i * util.nAreas + a]!;
    const y = util.u[i * util.nAreas + b]!;
    p += weights[i]! * (x > y ? 1 : x === y ? 0.5 : 0);
  }
  return p;
}

/** Profile facts the engine still needs, in asking order. trips_per_week is required by the anchor schema. */
export function missingFacts(profile: Profile, params?: { layoutAreaSqm: Readonly<Record<string, number>> }): ProfileResult['missing'] {
  const missing: ProfileResult['missing'] = [];
  if (profile.anchors.length === 0) missing.push('anchor');
  if (profile.anchors.some((a) => !(a.tripsPerWeek > 0))) missing.push('trips_per_week');
  if (!profile.layout || (params && params.layoutAreaSqm[profile.layout] === undefined)) missing.push('layout');
  if (!profile.budget) missing.push('budget');
  return missing;
}

function confidenceOf(a: number, ctx: AreaContext, profile: Profile): AreaConfidence {
  const area = ctx.areas[a]!;
  const rent: AreaConfidence['rent'] =
    area.land_value_yen_per_sqm == null || area.land_price_used_fallback === true
      ? 'ward_fallback'
      : ctx.sigmaRent[a]! <= DEFAULTS.sigmaRentNear
        ? 'near_price_point'
        : 'distant_price_point';
  const t1 = ctx.minutes[0]?.[a];
  return {
    rent,
    landValueNearestM: area.land_value_nearest_m,
    access: area.access_confidence,
    commuteBandMinutes: t1 !== undefined && Number.isFinite(t1) ? Math.max(DEFAULTS.travelNoiseMinMinutes, DEFAULTS.travelNoiseShare * t1) : 0,
    lateReturnNotCovered: profile.anchors.some((x) => x.lateReturn === true),
  };
}

export const recommend: Recommend = (belief, util, ctx, profile, opts) => {
  const { defaults } = opts;
  const k = Math.max(0, Math.floor(opts.k));
  const weights = belief.weights;
  const nA = util.nAreas;
  let feasibleCount = 0;
  for (let a = 0; a < nA; a++) if (ctx.feasible[a] && Number.isFinite(util.u[a]!)) feasibleCount++;

  const picks = greedyShortlist(util, weights, ctx.feasible, k);
  const pb = pBest(util, weights, ctx.feasible);
  const maxF = maxOverFeasible(util, ctx.feasible);
  const medianIdx = medianFeasibleArea(belief, ctx, profile);
  const medianBreakdown = medianIdx >= 0 ? breakdownAt(medianIdx, belief, ctx, profile) : null;
  const terms = areaTerms(ctx, profile);

  // Best-in-S per sample, for roles.
  const bestInS = new Int32Array(util.nSamples).fill(-1);
  for (let i = 0; i < util.nSamples; i++) {
    let m = -Infinity;
    for (const a of picks) {
      const v = util.u[i * nA + a]!;
      if (v > m) {
        m = v;
        bestInS[i] = a;
      }
    }
  }

  const items: ShortlistItem[] = picks.map((a) => {
    let regret = 0;
    for (let i = 0; i < util.nSamples; i++) regret += weights[i]! * Math.max(0, maxF[i]! - util.u[i * nA + a]!);
    const mask = new Uint8Array(util.nSamples);
    for (let i = 0; i < util.nSamples; i++) mask[i] = bestInS[i] === a ? 1 : 0;
    const role = picks.length > 1 ? distinguishingParam(belief, mask) : null;
    const breakdown = breakdownAt(a, belief, ctx, profile);
    const area = ctx.areas[a]!;
    const t1 = ctx.minutes[0]?.[a];
    return {
      localityId: area.locality_id,
      nameEn: area.name_en,
      nameJa: area.name_ja,
      wardNameEn: area.ward_name_en,
      rentYen: ctx.rent[a]!,
      commuteMinutes: t1 !== undefined ? t1 : null,
      monthlyTravelHours: terms.hours[a]!,
      pBest: pb[a]!,
      regretYen: regret,
      role: role ? { param: role.param, direction: role.direction } : null,
      breakdown,
      vsMedian: medianBreakdown ? subtractBreakdown(breakdown, medianBreakdown) : subtractBreakdown(breakdown, breakdown),
      confidence: confidenceOf(a, ctx, profile),
    };
  });
  const order = picks.map((a, r) => ({ a, r }));
  order.sort((x, y) => pb[y.a]! - pb[x.a]! || x.r - y.r);
  const shortlist = order.map(({ r }) => items[r]!);
  const ordered = order.map(({ a }) => a);

  const riskYen = picks.length > 0 ? riskOfSet(util, weights, ctx.feasible, picks) : 0;
  const scale = ctx.scale;
  // Stop rule (P8 deviation from the spec): the risk stop applies only once
  // minQuestions have been answered; the question limit and "no question can
  // be formed" stop at any time. riskYen itself is reported unchanged.
  const missing = missingFacts(profile);
  const canAsk = missing.length > 0 || ordered.length >= 2;
  const riskLow = picks.length > 0 && riskYen < defaults.stopRiskShare * scale;
  let stopReason: Recommendation['stopReason'] = null;
  let shouldStop = false;
  if (opts.questionsAsked >= defaults.maxQuestions) {
    stopReason = riskLow ? 'risk_below_threshold' : 'question_limit';
    shouldStop = true;
  } else if (riskLow && opts.questionsAsked >= defaults.minQuestions) {
    stopReason = 'risk_below_threshold';
    shouldStop = true;
  } else if (!canAsk) {
    // Fewer than two shortlisted areas: no question can be formed.
    stopReason = riskLow ? 'risk_below_threshold' : null;
    shouldStop = true;
  }

  let nextQuestion: NextQuestion | null = null;
  if (missing.length > 0) nextQuestion = { kind: 'profile_fact', missing: missing[0]! };
  else if (!shouldStop && ordered.length >= 2) {
    if (opts.questionsAsked === 0) {
      nextQuestion = { kind: 'pick_from_shortlist', set: ordered.map((a) => ctx.areas[a]!.locality_id) };
    } else {
      // TODO(E03): shortcut path only. Fewer than two above PAIR_MIN_PBEST:
      // fall back to the top two shortlisted areas by expected utility (P8).
      let pool = ordered.filter((a) => pb[a]! > PAIR_MIN_PBEST);
      if (pool.length < 2) {
        const eu = expectedUtility(util, weights);
        pool = [...ordered].sort((x, y) => eu[y]! - eu[x]! || x - y).slice(0, 2);
      }
      let best: { a: number; b: number; p: number } | null = null;
      for (let x = 0; x < pool.length; x++) {
        for (let y = x + 1; y < pool.length; y++) {
          const p = pABeatsB(util, weights, pool[x]!, pool[y]!);
          if (!best || Math.abs(p - 0.5) < Math.abs(best.p - 0.5)) best = { a: pool[x]!, b: pool[y]!, p };
        }
      }
      if (best) {
        nextQuestion = { kind: 'pair', a: ctx.areas[best.a]!.locality_id, b: ctx.areas[best.b]!.locality_id, pABeatsB: best.p };
      }
    }
  }

  // "If I'm wrong about you": among samples where the top pick is not the best feasible area.
  let alternative: Recommendation['alternative'] = null;
  const top = ordered[0];
  if (top !== undefined) {
    const wins = new Float64Array(nA);
    const winner = new Int32Array(util.nSamples).fill(-1);
    for (let i = 0; i < util.nSamples; i++) {
      let b = -1;
      let m = -Infinity;
      for (let a = 0; a < nA; a++) {
        if (!ctx.feasible[a]) continue;
        const v = util.u[i * nA + a]!;
        if (v > m) {
          m = v;
          b = a;
        }
      }
      if (b >= 0 && b !== top) {
        winner[i] = b;
        wins[b] = wins[b]! + weights[i]!;
      }
    }
    let alt = -1;
    for (let a = 0; a < nA; a++) if (wins[a]! > 0 && (alt < 0 || wins[a]! > wins[alt]!)) alt = a;
    if (alt >= 0) {
      const mask = new Uint8Array(util.nSamples);
      for (let i = 0; i < util.nSamples; i++) mask[i] = winner[i] === alt ? 1 : 0;
      const d = distinguishingParam(belief, mask);
      if (d) alternative = { localityId: ctx.areas[alt]!.locality_id, weight: wins[alt]!, param: d.param };
    }
  }

  let ess = 0;
  for (let i = 0; i < weights.length; i++) ess += weights[i]! * weights[i]!;
  return {
    shortlist,
    feasibleCount,
    riskYen,
    shouldStop,
    stopReason,
    nextQuestion,
    excluded: { ...ctx.excluded },
    alternative,
    ess: ess > 0 ? 1 / ess : 0,
  };
};

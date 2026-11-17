// Breakdowns, whyNot, compare and relax (docs/plans/engine-spec.md,
// "Explanations"). Computed from the same samples and utilities as the
// recommendation. Does not import recommend.ts (recommend imports this file).
import { C_T_INDEX, FEATURE_OFFSET, GAMMA_INDEX, LAMBDA_B_INDEX, distinguishingParam, weightedMoments } from './belief.js';
import { areaTerms, buildAreaContext, dataGap } from './features.js';
import {
  FEATURE_KEYS,
  type AreaContext,
  type Belief,
  type Breakdown,
  type BreakdownAt,
  type BreakdownTerm,
  type ExplainCompare,
  type ExplainRelax,
  type ExplainWhyNot,
  type FeatureKey,
  type Profile,
  type RelaxOption,
  type UtilityMatrix,
} from './types.js';

/** whyNot step 2: samples where x is best must carry at least this weight. */
export const WINS_FOR_SOME_MIN_WEIGHT = 0.01;
export const RELAX_BUDGET_STEPS = [0.05, 0.1, 0.2] as const;
export const RELAX_CAP_STEPS = [5, 10, 15] as const;

const NF = FEATURE_KEYS.length;

function emptyFeatures(): Record<FeatureKey, number> {
  return Object.fromEntries(FEATURE_KEYS.map((k) => [k, 0])) as Record<FeatureKey, number>;
}

/** Each term of U at the weighted mean parameters (E23: means, not medians). Sums to total. */
export const breakdownAt: BreakdownAt = (areaIdx, belief, ctx, profile) => {
  const { mean } = weightedMoments(belief);
  const terms = areaTerms(ctx, profile);
  const c = mean[C_T_INDEX]!;
  const features = emptyFeatures();
  let featureSum = 0;
  FEATURE_KEYS.forEach((k, j) => {
    const v = mean[FEATURE_OFFSET + j]! * ctx.sat[areaIdx * NF + j]!;
    features[k] = v;
    featureSum += v;
  });
  const rent = -ctx.rent[areaIdx]!;
  const timeCost = -c * terms.hours[areaIdx]!;
  const budgetPenalty = -mean[LAMBDA_B_INDEX]! * terms.overBudget[areaIdx]!;
  const capPenalty = -mean[GAMMA_INDEX]! * c * terms.overCap[areaIdx]!;
  return { rent, timeCost, features, budgetPenalty, capPenalty, total: rent + timeCost + featureSum + budgetPenalty + capPenalty };
};

export function subtractBreakdown(a: Breakdown, b: Breakdown): Breakdown {
  const features = emptyFeatures();
  for (const k of FEATURE_KEYS) features[k] = a.features[k] - b.features[k];
  return {
    rent: a.rent - b.rent,
    timeCost: a.timeCost - b.timeCost,
    features,
    budgetPenalty: a.budgetPenalty - b.budgetPenalty,
    capPenalty: a.capPenalty - b.capPenalty,
    total: a.total - b.total,
  };
}

/** Feasible area whose breakdown total at the mean parameters is the median (lower middle); -1 if none. */
export function medianFeasibleArea(belief: Belief, ctx: AreaContext, profile: Profile): number {
  const { mean, gammaCt } = weightedMoments(belief);
  const eu = meanUtility(mean, gammaCt, ctx, profile, false);
  const idx: number[] = [];
  for (let a = 0; a < ctx.areas.length; a++) if (ctx.feasible[a] && Number.isFinite(eu[a]!)) idx.push(a);
  if (idx.length === 0) return -1;
  idx.sort((x, y) => eu[x]! - eu[y]! || x - y);
  return idx[Math.floor((idx.length - 1) / 2)]!;
}

/**
 * U at given parameter moments per area. exact = true uses E[gamma c_T] for
 * the cap term, so it equals the weighted expected U (U is linear in c_T, w,
 * lambda and gamma c_T); false uses mean gamma times mean c_T (breakdown).
 */
function meanUtility(mean: Float64Array, gammaCt: number, ctx: AreaContext, profile: Profile, exact: boolean): Float64Array {
  const terms = areaTerms(ctx, profile);
  const c = mean[C_T_INDEX]!;
  const capCoef = exact ? gammaCt : mean[GAMMA_INDEX]! * c;
  const out = new Float64Array(ctx.areas.length);
  for (let a = 0; a < ctx.areas.length; a++) {
    if (!terms.scorable[a]) {
      out[a] = -Infinity;
      continue;
    }
    let v = -ctx.rent[a]! - c * terms.hours[a]! - mean[LAMBDA_B_INDEX]! * terms.overBudget[a]! - capCoef * terms.overCap[a]!;
    for (let j = 0; j < NF; j++) v += mean[FEATURE_OFFSET + j]! * ctx.sat[a * NF + j]!;
    out[a] = v;
  }
  return out;
}

/** Feasible area with the highest expected noise-free U; -1 if none. */
export function topPick(util: UtilityMatrix, belief: Belief, ctx: AreaContext): number {
  const nA = util.nAreas;
  const eu = new Float64Array(nA);
  for (let i = 0; i < util.nSamples; i++) {
    const w = belief.weights[i]!;
    if (w === 0) continue;
    for (let a = 0; a < nA; a++) eu[a] = eu[a]! + w * util.u[i * nA + a]!;
  }
  let best = -1;
  for (let a = 0; a < nA; a++) if (ctx.feasible[a] && Number.isFinite(eu[a]!) && (best < 0 || eu[a]! > eu[best]!)) best = a;
  return best;
}

/**
 * The spec's four steps. The top pick is the feasible area with the highest
 * expected U (the first greedy pick). Step 3 skips the rent and penalty terms
 * (E13: no weight to grow); when the gap G <= 0 or no term favours x, returns
 * `dominated` with gapYen = G.
 */
export const explainWhyNot: ExplainWhyNot = (localityId, belief, util, ctx, profile) => {
  const x = ctx.index.get(localityId);
  if (x === undefined) return { kind: 'unknown_area', localityId };

  if (!ctx.feasible[x]) {
    const gap = dataGap(ctx.areas[x]!);
    if (gap === 'nullRent' || !Number.isFinite(ctx.rent[x]!)) return { kind: 'fails_firm_limit', localityId, limit: 'null_rent', by: 0, unit: 'none' };
    if (gap === 'nullLifestyle') return { kind: 'fails_firm_limit', localityId, limit: 'null_lifestyle', by: 0, unit: 'none' };
    if (gap === 'missingAccess') return { kind: 'fails_firm_limit', localityId, limit: 'no_access', by: 0, unit: 'none' };
    if (ctx.minutes.some((row) => !Number.isFinite(row[x]!))) return { kind: 'fails_firm_limit', localityId, limit: 'disconnected', by: 0, unit: 'none' };
    const budget = profile.budget;
    if (budget?.firm && ctx.rent[x]! > budget.value) {
      return { kind: 'fails_firm_limit', localityId, limit: 'budget', by: ctx.rent[x]! - budget.value, unit: 'yen' };
    }
    const cap = profile.commuteCap;
    const t1 = ctx.minutes[0]?.[x];
    if (cap?.firm && t1 !== undefined && t1 > cap.value) {
      return { kind: 'fails_firm_limit', localityId, limit: 'commute_cap', by: t1 - cap.value, unit: 'minutes' };
    }
  }

  const top = topPick(util, belief, ctx);
  if (top === x) return { kind: 'is_top_pick', localityId };

  // Step 2: samples under which x is the best feasible area.
  const nA = util.nAreas;
  const mask = new Uint8Array(util.nSamples);
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
    mask[i] = b === x ? 1 : 0;
  }
  const d = distinguishingParam(belief, mask);
  if (d && d.weight >= WINS_FOR_SOME_MIN_WEIGHT) {
    return { kind: 'wins_for_some', localityId, weight: d.weight, param: d.param, ratio: d.ratio };
  }

  // Step 3 at the mean parameters.
  if (top < 0) return { kind: 'dominated', localityId, gapYen: 0 };
  const bx = breakdownAt(x, belief, ctx, profile);
  const bt = breakdownAt(top, belief, ctx, profile);
  const G = bt.total - bx.total;
  if (G > 0) {
    let best: { term: BreakdownTerm; factor: number } | null = null;
    const consider = (term: BreakdownTerm, D: number): void => {
      if (D > 0) {
        const factor = 1 + G / D;
        if (!best || factor < best.factor) best = { term, factor };
      }
    };
    consider('timeCost', bx.timeCost - bt.timeCost);
    for (const k of FEATURE_KEYS) consider(k, bx.features[k] - bt.features[k]);
    const found = best as { term: BreakdownTerm; factor: number } | null;
    if (found) return { kind: 'needs_weight_change', localityId, term: found.term, factor: found.factor, gapYen: G };
  }
  return { kind: 'dominated', localityId, gapYen: G };
};

/**
 * Term-by-term difference at the mean parameters plus P(a beats b) from
 * util.noisy when both areas are covered (the engine passes a util whose
 * noisy block covers exactly [a, b]); otherwise from noise-free util.u.
 * Unknown ids throw an Error with code 'unknown_area'.
 */
export const explainCompare: ExplainCompare = (a, b, belief, util, ctx, profile) => {
  const ia = ctx.index.get(a);
  const ib = ctx.index.get(b);
  if (ia === undefined || ib === undefined) {
    throw Object.assign(new Error(`No area with id ${ia === undefined ? a : b}`), { code: 'unknown_area' });
  }
  const diff = subtractBreakdown(breakdownAt(ia, belief, ctx, profile), breakdownAt(ib, belief, ctx, profile));
  const { areaIdx, u } = util.noisy;
  const ca = areaIdx.indexOf(ia);
  const cb = areaIdx.indexOf(ib);
  const nC = areaIdx.length;
  let p = 0;
  for (let i = 0; i < util.nSamples; i++) {
    const x = ca >= 0 && cb >= 0 ? u[i * nC + ca]! : util.u[i * util.nAreas + ia]!;
    const y = ca >= 0 && cb >= 0 ? u[i * nC + cb]! : util.u[i * util.nAreas + ib]!;
    p += belief.weights[i]! * (x > y ? 1 : x === y ? 0.5 : 0);
  }
  return { a, b, diff, pABeatsB: p };
};

/**
 * Fixed steps per limit that is set (E27: unset limits skipped). Gains are
 * against the current profile: areasGained = feasible count change,
 * yenGained = rise of the best expected U over the feasible set (exact
 * expected U from the parameter moments; 0 when nothing was feasible before
 * or after). The belief is kept as is (same samples and scale). binding marks
 * every step of the limit with the larger yen gain at its first step (ties:
 * more areas gained). `seed` is unused: no noise enters relax.
 */
export const explainRelax: ExplainRelax = (areas, params, profile, anchorTimes, belief, _seed) => {
  const { mean, gammaCt } = weightedMoments(belief);
  const evaluate = (p: Profile): { count: number; best: number } => {
    const ctx = buildAreaContext(areas, params, p, anchorTimes);
    const eu = meanUtility(mean, gammaCt, ctx, p, true);
    let count = 0;
    let best = -Infinity;
    for (let a = 0; a < areas.length; a++) {
      if (!ctx.feasible[a]) continue;
      count++;
      if (eu[a]! > best) best = eu[a]!;
    }
    return { count, best };
  };
  const base = evaluate(profile);
  const options: RelaxOption[] = [];
  const add = (limit: RelaxOption['limit'], step: number, newValue: number, p: Profile): void => {
    const r = evaluate(p);
    const yenGained = Number.isFinite(base.best) && Number.isFinite(r.best) ? Math.max(0, r.best - base.best) : 0;
    options.push({ limit, step, newValue, areasGained: r.count - base.count, yenGained, binding: false });
  };
  if (profile.budget) {
    for (const s of RELAX_BUDGET_STEPS) {
      const v = profile.budget.value * (1 + s);
      add('budget', s, v, { ...profile, budget: { ...profile.budget, value: v } });
    }
  }
  if (profile.commuteCap) {
    for (const s of RELAX_CAP_STEPS) {
      const v = profile.commuteCap.value + s;
      add('commute_cap', s, v, { ...profile, commuteCap: { ...profile.commuteCap, value: v } });
    }
  }
  const first = (limit: RelaxOption['limit']): RelaxOption | undefined => options.find((o) => o.limit === limit);
  const fb = first('budget');
  const fc = first('commute_cap');
  let binding: RelaxOption['limit'] | null = null;
  if (fb && fc) {
    binding = fb.yenGained > fc.yenGained || (fb.yenGained === fc.yenGained && fb.areasGained >= fc.areasGained) ? 'budget' : 'commute_cap';
  } else if (fb) binding = 'budget';
  else if (fc) binding = 'commute_cap';
  for (const o of options) o.binding = o.limit === binding;
  return options;
};

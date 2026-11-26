// Utility matrix, greedy shortlist, P_best, regret, risk, stop rule and next
// question (docs/plans/engine-spec.md, "The shortlist", "Ask or stop").
// E01: EUS, the greedy shortlist and question choice read the noise-free
// util.u. R5: P_best, regret, Risk and compare read one noisy matrix,
// util.noisy, over the candidate set C (attachNoisy).
import { C_T_INDEX, FEATURE_OFFSET, GAMMA_INDEX, LAMBDA_B_INDEX, distinguishingParam, itemEpsilon, preMoveEss, weightedMedian } from './belief.js';
import { likelihood, predictive } from './evidence.js';
import { breakdownAt, medianFeasibleArea, subtractBreakdown } from './explain.js';
import { NEAR_PRICE_POINT_M, areaTerms, capHours, monthlyHours, travelHours } from './features.js';
import { createRng } from './rng.js';
import {
  FEATURE_KEYS,
  PARAM_COUNT,
  type AreaConfidence,
  type AreaContext,
  type AreaFeatures,
  type AreaSafety,
  type Belief,
  type BuildUtilities,
  type CrimeBand,
  type EngineDefaults,
  type Evidence,
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
  stopRiskShare: 0.01,
  maxQuestions: 6,
  minEvoiShare: 0.001,
  surpriseThreshold: 0.15,
  sigmaRentNear: 0.08,
  sigmaRentFar: 0.12,
  travelNoiseShare: 0.15,
  travelNoiseMinMinutes: 3,
  essFloor: 200,
};
/** Feasible areas by expected utility in the candidate set C, besides the greedy shortlist. */
export const NOISY_CANDIDATES = 40;
/** Pair questions are formed among this many areas of C, by P_best (R2). */
export const PAIR_POOL = 6;
/** One-way minutes saved in the time_tradeoff probe. */
export const TRADEOFF_PROBE_MINUTES = 10;
/** The probe's yen is rounded to this, so it reads as a plain figure. */
export const TRADEOFF_PROBE_ROUND_YEN = 100;

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
 * Sd of the commute estimate in minutes: the calibrated error for the area's
 * access confidence (D4), else the fallback band max(3, 0.15 t).
 */
export function travelNoiseSd(ctx: AreaContext, a: number, minutes: number): number {
  const calibrated = ctx.commuteSigma[a]!;
  if (Number.isFinite(calibrated)) return calibrated;
  return Math.max(DEFAULTS.travelNoiseMinMinutes, DEFAULTS.travelNoiseShare * minutes);
}

/**
 * Noisy U for the given areas: R_i = R exp(sigma z - sigma^2 / 2) (E09,
 * mean-preserving), t_im = max(1, t + sd(t) z) with one travel z per sample
 * and area shared by all anchors (spec; E09 clamp at 1 minute).
 */
export const noisyUtilities: NoisyUtilities = (belief, ctx, profile, seed, areaIdx) => {
  const nC = areaIdx.length;
  const u = new Float32Array(belief.n * nC);
  const terms = areaTerms(ctx, profile);
  const caps = capHours(profile);
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
        mins[m] = Math.max(1, t + travelNoiseSd(ctx, a, t) * zT);
      }
      const th = travelHours(mins, profile, caps);
      const row = i * PARAM_COUNT;
      const c = belief.theta[row + C_T_INDEX]!;
      let v =
        -rent -
        c * th.hours -
        belief.theta[row + LAMBDA_B_INDEX]! * (B !== undefined ? Math.max(0, rent - B) : 0) -
        belief.theta[row + GAMMA_INDEX]! * c * th.overCap;
      for (let j = 0; j < NF; j++) v += belief.theta[row + FEATURE_OFFSET + j]! * ctx.sat[s + j]!;
      u[i * nC + col] = v;
    }
  }
  return { areaIdx: Int32Array.from(areaIdx), u };
};

/** Noise-free utilities only; util.noisy is empty until attachNoisy. */
export function noiseFreeUtilities(belief: Belief, ctx: AreaContext, profile: Profile): UtilityMatrix {
  return {
    u: noiseFreeU(belief, ctx, profile),
    nSamples: belief.n,
    nAreas: ctx.areas.length,
    noisy: { areaIdx: new Int32Array(0), u: new Float32Array(0) },
  };
}

/** C = the top NOISY_CANDIDATES feasible areas by expected utility, then any greedy pick not among them. */
export function candidateSet(util: UtilityMatrix, weights: Float64Array, feasible: Uint8Array, k: number): number[] {
  const c = topFeasible(util, weights, feasible, NOISY_CANDIDATES);
  for (const a of greedyShortlist(util, weights, feasible, k)) if (!c.includes(a)) c.push(a);
  return c;
}

/** util with util.noisy over C for the belief's weights and a shortlist of k (R5). */
export function attachNoisy(util: UtilityMatrix, belief: Belief, ctx: AreaContext, profile: Profile, seed: number, k: number): UtilityMatrix {
  const idx = candidateSet(util, belief.weights, ctx.feasible, k);
  return { ...util, noisy: noisyUtilities(belief, ctx, profile, seed, idx) };
}

/** Noise-free utilities plus the noisy matrix over C for the default shortlist size. */
export const buildUtilities: BuildUtilities = (belief, ctx, profile, seed) =>
  attachNoisy(noiseFreeUtilities(belief, ctx, profile), belief, ctx, profile, seed, DEFAULTS.shortlistSize);

/** Per-sample maximum of the noisy u over the feasible areas of C (-Infinity when none). */
function maxOverCandidates(util: UtilityMatrix, feasible: Uint8Array): Float64Array {
  const { areaIdx, u } = util.noisy;
  const nC = areaIdx.length;
  const out = new Float64Array(util.nSamples).fill(-Infinity);
  for (let i = 0; i < util.nSamples; i++) {
    let m = -Infinity;
    for (let c = 0; c < nC; c++) if (feasible[areaIdx[c]!] && u[i * nC + c]! > m) m = u[i * nC + c]!;
    out[i] = m;
  }
  return out;
}

/** Column of each area in util.noisy; -1 when the area is not in C. */
function noisyColumns(util: UtilityMatrix, areas: readonly number[]): number[] {
  return areas.map((a) => util.noisy.areaIdx.indexOf(a));
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

/** P_best over the feasible areas of C, noisy; zero elsewhere; sums to 1 when any are feasible. */
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

/**
 * Risk(S) = sum_i pi_i (max_C u_i - max_S u_i) on the noisy matrix over C
 * (R5). Members of S outside C are ignored. 0 when nothing in C is feasible.
 */
export const riskOfSet: RiskOfSet = (util, weights, feasible, set) => {
  const maxC = maxOverCandidates(util, feasible);
  const nC = util.noisy.areaIdx.length;
  const cols = noisyColumns(util, set).filter((c) => c >= 0);
  let risk = 0;
  for (let i = 0; i < util.nSamples; i++) {
    if (!Number.isFinite(maxC[i]!)) continue;
    let m = -Infinity;
    for (const c of cols) if (util.noisy.u[i * nC + c]! > m) m = util.noisy.u[i * nC + c]!;
    if (!Number.isFinite(m)) return Infinity; // empty set against a non-empty C
    risk += weights[i]! * Math.max(0, maxC[i]! - m);
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
      : area.land_value_nearest_m != null && area.land_value_nearest_m <= NEAR_PRICE_POINT_M
        ? 'near_price_point'
        : 'distant_price_point';
  const t1 = ctx.minutes[0]?.[a];
  return {
    rent,
    landValueNearestM: area.land_value_nearest_m,
    access: area.access_confidence,
    commuteBandMinutes: t1 !== undefined && Number.isFinite(t1) ? travelNoiseSd(ctx, a, t1) : 0,
    lateReturnNotCovered: profile.anchors.some((x) => x.lateReturn === true),
  };
}

/** Tercile cut points of the known crime rates; areas rank against each other, so business districts do not distort the bands. */
function crimeCuts(areas: readonly AreaFeatures[]): { low: number; high: number } | null {
  const rates = areas.flatMap((a) => (a.crime_per_1k != null && Number.isFinite(a.crime_per_1k) ? [a.crime_per_1k] : []));
  if (rates.length < 3) return null;
  rates.sort((x, y) => x - y);
  return { low: rates[Math.floor(rates.length / 3)]!, high: rates[Math.floor((2 * rates.length) / 3)]! };
}

function safetyOf(area: AreaFeatures, cuts: ReturnType<typeof crimeCuts>): AreaSafety | null {
  const rate = area.crime_per_1k;
  const crimeBand: CrimeBand | null =
    rate == null || !cuts ? null : rate < cuts.low ? 'low' : rate >= cuts.high ? 'high' : 'typical';
  const quakeRank = area.quake_rank ?? null;
  const floodShare = area.flood_share ?? null;
  return quakeRank === null && floodShare === null && crimeBand === null ? null : { quakeRank, floodShare, crimeBand };
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
  const maxC = maxOverCandidates(util, ctx.feasible);
  const pickCols = noisyColumns(util, picks);
  const nC = util.noisy.areaIdx.length;
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

  const cuts = crimeCuts(ctx.areas);
  const items: ShortlistItem[] = picks.map((a, r) => {
    // Regret on the noisy matrix over C (R5); a pick outside C has none to report.
    const col = pickCols[r]!;
    let regret = 0;
    if (col >= 0) {
      for (let i = 0; i < util.nSamples; i++) {
        if (Number.isFinite(maxC[i]!)) regret += weights[i]! * Math.max(0, maxC[i]! - util.noisy.u[i * nC + col]!);
      }
    }
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
      lat: area.lat,
      lon: area.lon,
      nearestStation: area.nearest_station_name_ja
        ? { nameJa: area.nearest_station_name_ja, nameEn: area.nearest_station_name_en ?? null }
        : null,
      safety: safetyOf(area, cuts),
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
  // Stop rule (R3): at the question limit, or once the best question is worth
  // less than minEvoiShare of scale while the pre-move ESS is trustworthy.
  // riskYen only labels the limit stop and is reported unchanged.
  const missing = missingFacts(profile);
  const best = ordered.length >= 2 ? bestQuestion(belief, util, ctx, profile, pb, opts.log ?? []) : null;
  const canAsk = missing.length > 0 || best !== null;
  const riskLow = picks.length > 0 && riskYen < defaults.stopRiskShare * scale;
  const evoiLow = (best === null || best.evoiYen < defaults.minEvoiShare * scale) && preMoveEss(belief) >= defaults.essFloor;
  let stopReason: Recommendation['stopReason'] = null;
  let shouldStop = false;
  if (opts.questionsAsked >= defaults.maxQuestions) {
    stopReason = riskLow ? 'risk_below_threshold' : 'question_limit';
    shouldStop = true;
  } else if (evoiLow) {
    stopReason = 'nothing_left_to_learn';
    shouldStop = true;
  } else if (!canAsk) {
    stopReason = riskLow ? 'risk_below_threshold' : null;
    shouldStop = true;
  }

  let nextQuestion: NextQuestion | null = null;
  if (missing.length > 0) nextQuestion = { kind: 'profile_fact', missing: missing[0]! };
  else if (!shouldStop && best) {
    nextQuestion =
      opts.questionsAsked === 0 ? { kind: 'pick_from_shortlist', set: ordered.map((a) => ctx.areas[a]!.locality_id) } : best.question;
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

  return {
    shortlist,
    feasibleCount,
    riskYen,
    shouldStop,
    stopReason,
    nextQuestion,
    excluded: { ...ctx.excluded },
    alternative,
    ess: preMoveEss(belief),
  };
};

/** Hypothetical answers are logged as the direct routes would log them (R2). */
const TAP = { strength: 'normal', source: 'tap' } as const;

type AskableQuestion = Extract<NextQuestion, { kind: 'pair' | 'time_tradeoff' }>;

/** A question the engine could ask: its answers as hypothetical taps, and the question given its EVOI. */
interface Probe {
  answers: Evidence[];
  question: (evoiYen: number) => AskableQuestion;
}

/** The candidate with the highest EVOI, first in candidate order on ties; null when there is none (R2). */
function bestQuestion(
  belief: Belief,
  util: UtilityMatrix,
  ctx: AreaContext,
  profile: Profile,
  pb: Float64Array,
  log: readonly Evidence[],
): { question: AskableQuestion; evoiYen: number } | null {
  const cols = Array.from(util.noisy.areaIdx).filter((a) => ctx.feasible[a]);
  if (cols.length === 0) return null;
  const now = bestExpectedUtility(util, belief.weights, cols);
  let best: { probe: Probe; value: number } | null = null;
  for (const probe of candidateQuestions(belief, util, ctx, profile, pb, cols, log)) {
    // EVOI >= 0 in exact arithmetic; the clamp drops rounding residue.
    const value = Math.max(0, valueAfterAnswer(probe.answers, belief, util, ctx, profile, cols) - now);
    if (!best || value > best.value) best = { probe, value };
  }
  return best ? { question: best.probe.question(best.value), evoiYen: best.value } : null;
}

/**
 * Pairs among the top PAIR_POOL feasible areas of C by P_best, skipping any
 * already in the log as prefer_area (either order), plus one time_tradeoff
 * probe priced at the posterior-median c_T (P(accept) near one half).
 */
function candidateQuestions(
  belief: Belief,
  util: UtilityMatrix,
  ctx: AreaContext,
  profile: Profile,
  pb: Float64Array,
  cols: readonly number[],
  log: readonly Evidence[],
): Probe[] {
  const asked = new Set<string>();
  for (const e of log) if (e.type === 'prefer_area') asked.add([e.a, e.b].sort().join('|'));
  const pool = [...cols].sort((x, y) => pb[y]! - pb[x]! || x - y).slice(0, PAIR_POOL);
  const probes: Probe[] = [];
  for (let x = 0; x < pool.length; x++) {
    for (let y = x + 1; y < pool.length; y++) {
      const a = ctx.areas[pool[x]!]!.locality_id;
      const b = ctx.areas[pool[y]!]!.locality_id;
      if (asked.has([a, b].sort().join('|'))) continue;
      const ia = pool[x]!;
      const ib = pool[y]!;
      probes.push({
        answers: [{ ...TAP, type: 'prefer_area', a, b }, { ...TAP, type: 'prefer_area', a: b, b: a }],
        question: (evoiYen) => ({ kind: 'pair', a, b, pABeatsB: pABeatsB(util, belief.weights, ia, ib), evoiYen }),
      });
    }
  }
  const trips = profile.anchors[0]?.tripsPerWeek;
  if (trips !== undefined && trips > 0) {
    const minutes = TRADEOFF_PROBE_MINUTES;
    const raw = weightedMedian(belief, C_T_INDEX) * monthlyHours(minutes, trips);
    const yen = Math.max(TRADEOFF_PROBE_ROUND_YEN, Math.round(raw / TRADEOFF_PROBE_ROUND_YEN) * TRADEOFF_PROBE_ROUND_YEN);
    probes.push({
      answers: [true, false].map((accept): Evidence => ({ ...TAP, type: 'time_tradeoff', yen, minutes, accept })),
      question: (evoiYen) => ({ kind: 'time_tradeoff', yen, minutes, evoiYen }),
    });
  }
  return probes;
}


/**
 * sum_ans P(ans) max_x E[U_x | ans], x over `cols`, noise-free u; EVOI is this
 * minus max_x E[U_x] (R2).
 * pi(. | ans) is proportional to w ((1 - eps) L_ans + eps), the update replay
 * would make for a tap. P(ans) is predictive() normalised over the answers:
 * with the lapse floor the predictives of complementary answers sum to
 * 1 + eps, and normalising keeps sum_ans P(ans) pi(. | ans) = pi, so EVOI >= 0.
 */
function valueAfterAnswer(answers: readonly Evidence[], belief: Belief, util: UtilityMatrix, ctx: AreaContext, profile: Profile, cols: readonly number[]): number {
  const n = belief.n;
  const L = new Float64Array(n);
  const post = new Float64Array(n);
  const p: number[] = [];
  const bestGiven: number[] = [];
  for (const ans of answers) {
    L.fill(0);
    likelihood(ans, belief, util, ctx, profile, L);
    const eps = itemEpsilon(ans);
    const pAns = predictive(belief.weights, L, eps);
    for (let i = 0; i < n; i++) {
      const l = L[i]! > 1 ? 1 : L[i]! > 0 ? L[i]! : 0;
      post[i] = (belief.weights[i]! * ((1 - eps) * l + eps)) / pAns;
    }
    p.push(pAns);
    bestGiven.push(bestExpectedUtility(util, post, cols));
  }
  const total = p.reduce((s, x) => s + x, 0);
  return p.reduce((s, x, k) => s + (x / total) * bestGiven[k]!, 0);
}

/** max over `cols` of the weighted expected noise-free utility (weights summing to 1). */
function bestExpectedUtility(util: UtilityMatrix, weights: Float64Array, cols: readonly number[]): number {
  const nA = util.nAreas;
  const eu = new Float64Array(cols.length);
  for (let i = 0; i < util.nSamples; i++) {
    const w = weights[i]!;
    if (w === 0) continue;
    const row = i * nA;
    for (let c = 0; c < cols.length; c++) eu[c] = eu[c]! + w * util.u[row + cols[c]!]!;
  }
  let max = -Infinity;
  for (let c = 0; c < cols.length; c++) if (eu[c]! > max) max = eu[c]!;
  return max;
}

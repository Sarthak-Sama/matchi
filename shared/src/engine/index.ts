// createEngine: the stateful wrapper over the pure engine modules
// (docs/plans/engine-spec.md, "Interface, defaults and tests"). The belief is
// always prior x likelihoods of the current log, recomputed, never stored.
import { itemEpsilon, rejuvenate, replay, samplePrior, summarizeBelief } from './belief.js';
import { bindLikelihood, likelihood, predictive, surpriseThreshold, validateEvidence } from './evidence.js';
import { explainCompare, explainRelax, explainWhyNot } from './explain.js';
import { buildAreaContext } from './features.js';
import { DEFAULTS, attachNoisy, missingFacts, noiseFreeUtilities, noisyUtilities, recommend as recommendFn } from './recommend.js';
import {
  EvidenceSchema,
  ProfileSchema,
  type AnchorTimes,
  type AreaContext,
  type AreaFeatures,
  type Belief,
  type CreateEngine,
  type Engine,
  type Evidence,
  type LoggedEvidence,
  type ModelParams,
  type Profile,
  type RefusedAnchor,
  type SessionState,
  type UtilityMatrix,
} from './types.js';

/** Evidence types that answer a question the engine asks; each one in the log, tapped or typed, counts as a question asked. */
const ANSWER_TYPES: ReadonlySet<Evidence['type']> = new Set(['pick_from_set', 'prefer_area', 'reject_area', 'time_tradeoff']);

function engineError(code: 'unknown_area' | 'unknown_evidence_id', message: string): Error {
  return Object.assign(new Error(message), { code });
}

export const createEngine: CreateEngine = (areas: AreaFeatures[], params: ModelParams, seed: number): Engine => {
  let sessionSeed = seed;
  let rawProfile: Profile = ProfileSchema.parse({});
  let profile: Profile = rawProfile;
  let anchorTimes: AnchorTimes = {};
  let refused: RefusedAnchor[] = [];
  let log: LoggedEvidence[] = [];
  let nextId = 1;

  let ctx!: AreaContext;
  let prior!: Belief;
  /** Noise-free utilities of the prior samples; every replay reads these. */
  let util!: UtilityMatrix;
  /** replay(prior, log) before any move: predictive and conflict checks stay on the prior samples. */
  let replayed!: Belief;
  /** The current belief, rejuvenated when the replay collapsed (R1), and its own noise-free utilities. */
  let belief!: Belief;
  let beliefUtil!: UtilityMatrix;
  // R5: the noisy matrix over C is built on first use and kept until the
  // belief, the profile or the shortlist size changes.
  let beliefVersion = 0;
  let profileVersion = 0;
  let noisyCache: { versions: string; k: number; util: UtilityMatrix } | null = null;

  const newId = (): string => {
    let id: string;
    do id = `e${String(nextId++).padStart(4, '0')}`;
    while (log.some((x) => x.id === id));
    return id;
  };

  const doReplay = (items: readonly LoggedEvidence[]): Belief => replay(prior, items, bindLikelihood(util, ctx, profile));

  /** Every change of the current belief goes through here, so the noisy cache sees it. */
  const setBelief = (b: Belief, u: UtilityMatrix): void => {
    belief = b;
    beliefUtil = u;
    beliefVersion++;
  };

  /** The main replay path, the only one that rejuvenates (R1); the conflict loop uses doReplay alone. */
  const replayLog = (): void => {
    replayed = doReplay(log);
    const moved = rejuvenate(replayed, prior, util, log, ctx, profile, sessionSeed);
    setBelief(moved.belief, moved.util);
  };

  const questionsAsked = (): number => log.filter((x) => ANSWER_TYPES.has(x.type)).length;

  /** util with the noisy matrix over C for the current belief and a shortlist of k; without k, any cached size will do. */
  const noisyUtil = (k?: number): UtilityMatrix => {
    const versions = `${profileVersion}:${beliefVersion}`;
    const fresh = noisyCache?.versions === versions && (k === undefined || noisyCache.k === k);
    if (!fresh || !noisyCache) {
      const size = k ?? DEFAULTS.shortlistSize;
      noisyCache = { versions, k: size, util: attachNoisy(beliefUtil, belief, ctx, profile, sessionSeed, size) };
    }
    return noisyCache.util;
  };

  const rebuild = (): void => {
    ctx = buildAreaContext(areas, params, profile, anchorTimes);
    prior = samplePrior(ctx.scale, sessionSeed, DEFAULTS.samples);
    util = noiseFreeUtilities(prior, ctx, profile);
    profileVersion++;
    replayLog();
  };

  const applyProfile = (p: Profile, times: AnchorTimes): void => {
    const parsed = ProfileSchema.safeParse(p);
    rawProfile = parsed.success ? parsed.data : p;
    anchorTimes = times;
    refused = [];
    const kept = rawProfile.anchors.filter((a) => {
      const v = Object.prototype.hasOwnProperty.call(times, a.id) ? times[a.id] : undefined;
      if (v && v.length === areas.length) return true;
      refused.push({ anchorId: a.id, reason: 'no_times', message: `No travel times for anchor ${a.label || a.id}; it is ignored` });
      return false;
    });
    profile = { ...rawProfile, anchors: kept };
    rebuild();
  };

  const feasibleCount = (): number => {
    let c = 0;
    for (let a = 0; a < ctx.feasible.length; a++) c += ctx.feasible[a]!;
    return c;
  };

  const requireArea = (id: string): void => {
    if (!ctx.index.has(id)) throw engineError('unknown_area', `No area with id ${id}`);
  };

  rebuild();

  const engine: Engine = {
    setProfile(p, times) {
      applyProfile(p, times);
      return { profile, refusedAnchors: refused, feasibleCount: feasibleCount(), missing: missingFacts(profile, params) };
    },

    observe(input) {
      const parsed = EvidenceSchema.safeParse(input);
      if (!parsed.success) return { ok: false, error: { code: 'invalid_evidence', message: parsed.error.message } };
      const e = parsed.data;
      const err = validateEvidence(e, ctx, profile, util);
      if (err) return { ok: false, error: err };

      const id = e.id ?? newId();
      const others = log.filter((x) => x.id !== id); // same id = edit
      const before = others.length === log.length ? replayed : doReplay(others);
      const item: LoggedEvidence = { ...e, id };

      const L = new Float64Array(belief.n);
      likelihood(item, before, util, ctx, profile, L);
      const eps = itemEpsilon(item);
      const p = predictive(before.weights, L, eps);
      const surprising = p < surpriseThreshold(item);

      let conflictsWith: string | undefined;
      if (surprising && others.length > 0) {
        let bestGain = 0;
        for (const o of others) {
          const without = doReplay(others.filter((x) => x.id !== o.id));
          const gain = predictive(without.weights, L, eps) - p;
          if (gain > bestGain) {
            bestGain = gain;
            conflictsWith = o.id;
          }
        }
      }

      log = [...others, item];
      replayLog();
      return conflictsWith !== undefined
        ? { ok: true, id, predictive: p, surprising, conflictsWith }
        : { ok: true, id, predictive: p, surprising };
    },

    removeEvidence(id) {
      if (!log.some((x) => x.id === id)) return;
      log = log.filter((x) => x.id !== id);
      replayLog();
    },

    recommend(k = DEFAULTS.shortlistSize) {
      const rec = recommendFn(belief, noisyUtil(k), ctx, profile, { k, questionsAsked: questionsAsked(), defaults: DEFAULTS, log });
      if (rec.feasibleCount < k) rec.relax = explainRelax(areas, params, profile, anchorTimes, belief, sessionSeed);
      return rec;
    },

    whyNot(localityId) {
      return explainWhyNot(localityId, belief, beliefUtil, ctx, profile);
    },

    relax() {
      return explainRelax(areas, params, profile, anchorTimes, belief, sessionSeed);
    },

    compare(a, b) {
      requireArea(a);
      requireArea(b);
      const ia = ctx.index.get(a)!;
      const ib = ctx.index.get(b)!;
      // The pair's noisy values are the same whichever matrix holds them (per-area seeds), so a pair outside C is drawn alone.
      const shared = noisyUtil();
      const covered = shared.noisy.areaIdx.includes(ia) && shared.noisy.areaIdx.includes(ib);
      const pairUtil = covered ? shared : { ...beliefUtil, noisy: noisyUtilities(belief, ctx, profile, sessionSeed, [ia, ib]) };
      return explainCompare(a, b, belief, pairUtil, ctx, profile);
    },

    beliefSummary() {
      return summarizeBelief(belief, DEFAULTS.essFloor);
    },

    snapshot(): SessionState {
      return { profile: rawProfile, evidence: log.map((x) => ({ ...x })), seed: sessionSeed, questionsAsked: questionsAsked() };
    },

    restore(s, times) {
      sessionSeed = s.seed;
      log = s.evidence.map((x) => ({ ...x, id: x.id ?? '' }));
      for (const x of log) if (!x.id) x.id = newId();
      applyProfile(s.profile, times);
    },
  };
  return engine;
};

export { DEFAULTS } from './recommend.js';

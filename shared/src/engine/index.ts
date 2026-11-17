// createEngine: the stateful wrapper over the pure engine modules
// (docs/plans/engine-spec.md, "Interface, defaults and tests"). The belief is
// always prior x likelihoods of the current log, recomputed, never stored.
import { replay, samplePrior, summarizeBelief } from './belief.js';
import { bindLikelihood, likelihood, predictive, surpriseThreshold, validateEvidence } from './evidence.js';
import { explainCompare, explainRelax, explainWhyNot } from './explain.js';
import { buildAreaContext } from './features.js';
import { DEFAULTS, buildUtilities, missingFacts, noisyUtilities, recommend as recommendFn, refreshNoisy } from './recommend.js';
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

/** Evidence types that answer a card or pair question; observing one counts as a question asked. */
const ANSWER_TYPES: ReadonlySet<Evidence['type']> = new Set(['pick_from_set', 'prefer_area', 'reject_area']);

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
  let questionsAsked = 0;
  let nextId = 1;

  let ctx!: AreaContext;
  let prior!: Belief;
  let belief!: Belief;
  let util!: UtilityMatrix;

  const newId = (): string => {
    let id: string;
    do id = `e${String(nextId++).padStart(4, '0')}`;
    while (log.some((x) => x.id === id));
    return id;
  };

  const doReplay = (items: readonly LoggedEvidence[]): Belief =>
    replay(prior, items, bindLikelihood(util, ctx, profile), DEFAULTS.epsilon);

  const rebuild = (): void => {
    ctx = buildAreaContext(areas, params, profile, anchorTimes);
    prior = samplePrior(ctx.scale, sessionSeed, DEFAULTS.samples);
    util = buildUtilities(prior, ctx, profile, sessionSeed);
    belief = doReplay(log);
    util = refreshNoisy(util, belief, ctx, profile, sessionSeed);
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
      const before = others.length === log.length ? belief : doReplay(others);
      const item: LoggedEvidence = { ...e, id };

      const L = new Float64Array(belief.n);
      likelihood(item, before, util, ctx, profile, L);
      const p = predictive(before.weights, L, DEFAULTS.epsilon);
      const surprising = p < surpriseThreshold(item);

      let conflictsWith: string | undefined;
      if (surprising && others.length > 0) {
        let bestGain = 0;
        for (const o of others) {
          const without = doReplay(others.filter((x) => x.id !== o.id));
          const gain = predictive(without.weights, L, DEFAULTS.epsilon) - p;
          if (gain > bestGain) {
            bestGain = gain;
            conflictsWith = o.id;
          }
        }
      }

      log = [...others, item];
      if (ANSWER_TYPES.has(item.type)) questionsAsked++;
      belief = doReplay(log);
      util = refreshNoisy(util, belief, ctx, profile, sessionSeed);
      return conflictsWith !== undefined
        ? { ok: true, id, predictive: p, surprising, conflictsWith }
        : { ok: true, id, predictive: p, surprising };
    },

    removeEvidence(id) {
      if (!log.some((x) => x.id === id)) return;
      log = log.filter((x) => x.id !== id);
      belief = doReplay(log);
      util = refreshNoisy(util, belief, ctx, profile, sessionSeed);
    },

    recommend(k = DEFAULTS.shortlistSize) {
      const rec = recommendFn(belief, util, ctx, profile, { k, questionsAsked, defaults: DEFAULTS });
      if (rec.feasibleCount < k) rec.relax = explainRelax(areas, params, profile, anchorTimes, belief, sessionSeed);
      return rec;
    },

    whyNot(localityId) {
      return explainWhyNot(localityId, belief, util, ctx, profile);
    },

    relax() {
      return explainRelax(areas, params, profile, anchorTimes, belief, sessionSeed);
    },

    compare(a, b) {
      requireArea(a);
      requireArea(b);
      const ia = ctx.index.get(a)!;
      const ib = ctx.index.get(b)!;
      const noisy = noisyUtilities(belief, ctx, profile, sessionSeed, [ia, ib]);
      return explainCompare(a, b, belief, { ...util, noisy }, ctx, profile);
    },

    beliefSummary() {
      return summarizeBelief(belief, DEFAULTS.essFloor);
    },

    snapshot(): SessionState {
      return { profile: rawProfile, evidence: log.map((x) => ({ ...x })), seed: sessionSeed, questionsAsked };
    },

    restore(s, times) {
      sessionSeed = s.seed;
      log = s.evidence.map((x) => ({ ...x, id: x.id ?? '' }));
      for (const x of log) if (!x.id) x.id = newId();
      questionsAsked = s.questionsAsked ?? 0;
      applyProfile(s.profile, times);
    },
  };
  return engine;
};

export { DEFAULTS } from './recommend.js';

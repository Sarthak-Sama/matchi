// recommend.ts and createEngine on SYNTHETIC areas (synthetic-fixtures.ts), not real data.
import { describe, expect, it } from 'vitest';

import { samplePrior } from './belief.js';
import { buildAreaContext } from './features.js';
import { createEngine } from './index.js';
import { buildUtilities, greedyShortlist, noisyUtilities, recommend, DEFAULTS } from './recommend.js';
import { SYNTHETIC_PARAMS, syntheticAreas, syntheticProfile, syntheticTimes } from './synthetic-fixtures.js';
import { FEATURE_KEYS } from './types.js';

const areas = syntheticAreas(60);
const times = syntheticTimes(areas);

describe('utilities', () => {
  const profile = syntheticProfile();
  const ctx = buildAreaContext(areas, SYNTHETIC_PARAMS, profile, times);
  const belief = samplePrior(ctx.scale, 1, 500);
  const util = buildUtilities(belief, ctx, profile, 1);

  it('no U for a scorable area is NaN or infinite', () => {
    for (let a = 0; a < util.nAreas; a++) {
      if (!ctx.feasible[a]) continue;
      for (let i = 0; i < util.nSamples; i++) expect(Number.isFinite(util.u[i * util.nAreas + a]!)).toBe(true);
    }
  });

  it('noisy block covers C (top 40 plus the greedy shortlist), feasible only, and is reproducible per area', () => {
    expect(util.noisy.areaIdx.length).toBeLessThanOrEqual(40 + 5);
    for (const a of util.noisy.areaIdx) expect(ctx.feasible[a]).toBe(1);
    const a = util.noisy.areaIdx[3]!;
    const alone = noisyUtilities(belief, ctx, profile, 1, [a]);
    const nC = util.noisy.areaIdx.length;
    for (let i = 0; i < 20; i++) expect(alone.u[i]).toBe(util.noisy.u[i * nC + 3]);
  });

  it('greedy returns min(k, |F|) distinct feasible areas (E16)', () => {
    const few = new Uint8Array(util.nAreas);
    few[2] = 1;
    few[9] = 1;
    expect(greedyShortlist(util, belief.weights, few, 5).sort()).toEqual([2, 9]);
    expect(new Set(greedyShortlist(util, belief.weights, ctx.feasible, 5)).size).toBe(5);
  });

  it('recommend returns an ordered shortlist with breakdowns that sum to total', () => {
    const rec = recommend(belief, util, ctx, profile, { k: 5, questionsAsked: 0, defaults: DEFAULTS });
    expect(rec.shortlist).toHaveLength(5);
    for (let r = 1; r < rec.shortlist.length; r++) expect(rec.shortlist[r - 1]!.pBest).toBeGreaterThanOrEqual(rec.shortlist[r]!.pBest);
    for (const s of rec.shortlist) {
      const b = s.breakdown;
      const sum = b.rent + b.timeCost + b.budgetPenalty + b.capPenalty + FEATURE_KEYS.reduce((t, k) => t + b.features[k], 0);
      expect(sum).toBeCloseTo(b.total, 6);
      expect(s.regretYen).toBeGreaterThanOrEqual(0);
    }
    expect(rec.riskYen).toBeGreaterThanOrEqual(0);
    // P8: the risk stop needs minQuestions answers, so the first call always asks.
    expect(rec.shouldStop).toBe(false);
    expect(rec.nextQuestion?.kind).toBe('pick_from_shortlist');
  });

  it('P8: risk below the threshold at questionsAsked=0 still asks; stops once minQuestions are answered', () => {
    // stopRiskShare large enough that risk is surely below the threshold.
    const lowRisk = { ...DEFAULTS, stopRiskShare: 1e9 };
    const feasibleIds = new Set(ctx.areas.filter((_, a) => ctx.feasible[a]).map((x) => x.locality_id));
    const r0 = recommend(belief, util, ctx, profile, { k: 5, questionsAsked: 0, defaults: lowRisk });
    expect(r0.riskYen).toBeLessThan(lowRisk.stopRiskShare * ctx.scale);
    expect(r0.shouldStop).toBe(false);
    expect(r0.stopReason).toBeNull();
    expect(r0.nextQuestion?.kind).toBe('pick_from_shortlist');
    if (r0.nextQuestion?.kind === 'pick_from_shortlist') {
      expect(new Set(r0.nextQuestion.set).size).toBeGreaterThanOrEqual(2);
      for (const x of r0.nextQuestion.set) expect(feasibleIds.has(x)).toBe(true);
    }
    const r1 = recommend(belief, util, ctx, profile, { k: 5, questionsAsked: 1, defaults: lowRisk });
    expect(r1.shouldStop).toBe(false);
    expect(r1.nextQuestion?.kind).toBe('pair');
    if (r1.nextQuestion?.kind === 'pair') {
      expect(r1.nextQuestion.a).not.toBe(r1.nextQuestion.b);
      expect(feasibleIds.has(r1.nextQuestion.a)).toBe(true);
      expect(feasibleIds.has(r1.nextQuestion.b)).toBe(true);
    }
    expect(r1.riskYen).toBe(r0.riskYen); // risk reported as computed
    for (const q of [2, 3]) {
      const r = recommend(belief, util, ctx, profile, { k: 5, questionsAsked: q, defaults: lowRisk });
      expect(r.shouldStop).toBe(true);
      expect(r.stopReason).toBe('risk_below_threshold');
      expect(r.nextQuestion).toBeNull();
    }
  });

  it('P8: pair falls back to the top two by expected utility when fewer than two pass the P_best filter', () => {
    const lowRisk = { ...DEFAULTS, stopRiskShare: 1e9 };
    // Concentrate all weight on one sample: P_best is 1 for one area, 0 elsewhere.
    const w = new Float64Array(belief.n);
    w[0] = 1;
    const peaked = { ...belief, weights: w };
    const r = recommend(peaked, util, ctx, profile, { k: 5, questionsAsked: 1, defaults: lowRisk });
    expect(r.shortlist.filter((s) => s.pBest > 0.05).length).toBeLessThan(2);
    expect(r.shouldStop).toBe(false);
    expect(r.nextQuestion?.kind).toBe('pair');
    if (r.nextQuestion?.kind === 'pair') {
      const idx = (id: string): number => ctx.areas.findIndex((x) => x.locality_id === id);
      const shortIdx = r.shortlist.map((s) => idx(s.localityId));
      // One sample with weight 1: expected utility is that sample's row of u.
      const top2 = [...shortIdx].sort((x, y) => util.u[y]! - util.u[x]! || x - y).slice(0, 2);
      expect([idx(r.nextQuestion.a), idx(r.nextQuestion.b)].sort()).toEqual(top2.sort());
    }
  });

  it('P8: stops when no question can be formed (one feasible area)', () => {
    const one = new Uint8Array(util.nAreas);
    one[ctx.areas.findIndex((_, a) => ctx.feasible[a])] = 1;
    const r = recommend(belief, util, { ...ctx, feasible: one }, profile, { k: 5, questionsAsked: 0, defaults: DEFAULTS });
    expect(r.shortlist).toHaveLength(1);
    expect(r.shouldStop).toBe(true);
    expect(r.nextQuestion).toBeNull();
  });

  it('asks the shortlist first, then the closest pair, while risk is above the threshold', () => {
    const keepAsking = { ...DEFAULTS, stopRiskShare: -1 };
    const first = recommend(belief, util, ctx, profile, { k: 5, questionsAsked: 0, defaults: keepAsking });
    expect(first.nextQuestion?.kind).toBe('pick_from_shortlist');
    const second = recommend(belief, util, ctx, profile, { k: 5, questionsAsked: 1, defaults: keepAsking });
    expect(second.nextQuestion?.kind).toBe('pair');
    if (second.nextQuestion?.kind === 'pair') {
      const ids = second.shortlist.map((s) => s.localityId);
      expect(ids).toContain(second.nextQuestion.a);
      expect(ids).toContain(second.nextQuestion.b);
    }
  });
});

describe('createEngine', () => {
  it('asks for missing profile facts first', () => {
    const e = createEngine(areas, SYNTHETIC_PARAMS, 1);
    const rec = e.recommend();
    expect(rec.nextQuestion).toEqual({ kind: 'profile_fact', missing: 'anchor' });
    expect(rec.shortlist.length).toBe(5); // no anchor: rent and amenities only
  });

  it('refuses an anchor without times and ignores it', () => {
    const e = createEngine(areas, SYNTHETIC_PARAMS, 1);
    const p = syntheticProfile();
    const r = e.setProfile({ ...p, anchors: [...p.anchors, { id: 'gym', label: 'Gym', tripsPerWeek: 2, period: 'peak' }] }, times);
    expect(r.refusedAnchors.map((x) => x.reason)).toEqual(['no_times']);
    expect(r.profile.anchors).toHaveLength(1);
    expect(r.missing).toEqual([]);
  });

  it('rejects malformed evidence and unknown areas without applying them', () => {
    const e = createEngine(areas, SYNTHETIC_PARAMS, 1);
    e.setProfile(syntheticProfile(), times);
    const before = e.beliefSummary();
    expect(e.observe({ type: 'nope' } as never)).toMatchObject({ ok: false, error: { code: 'invalid_evidence' } });
    expect(e.observe({ type: 'like_area', area: 'missing', strength: 'normal' })).toMatchObject({ ok: false, error: { code: 'unknown_area' } });
    expect(e.beliefSummary()).toEqual(before);
    expect(e.snapshot().evidence).toHaveLength(0);
  });

  it('flags a contradiction and names the item it conflicts with', () => {
    const e = createEngine(areas, SYNTHETIC_PARAMS, 1);
    e.setProfile(syntheticProfile(), times);
    // Taps (R4: epsilon 0.02); against text items the 0.10 floor keeps p above the threshold.
    const first = e.observe({ type: 'direction', feature: 'bars', sign: 1, strength: 'strong', source: 'tap' });
    e.observe({ type: 'direction', feature: 'bars', sign: 1, strength: 'strong', source: 'tap' });
    const r = e.observe({ type: 'direction', feature: 'bars', sign: -1, strength: 'normal', source: 'tap' });
    expect(r.ok && r.surprising).toBe(true);
    expect(r.ok && first.ok && r.conflictsWith).toBeTruthy();
  });

  it('snapshot and restore reproduce the recommendation', () => {
    const e = createEngine(areas, SYNTHETIC_PARAMS, 3);
    e.setProfile(syntheticProfile(), times);
    e.observe({ type: 'magnitude', feature: 'green_space', tier: 'essential', strength: 'normal' });
    e.observe({ type: 'pick_from_set', chosen: areas[4]!.locality_id, set: [areas[4]!.locality_id, areas[5]!.locality_id], strength: 'normal' });
    const snap = JSON.parse(JSON.stringify(e.snapshot()));
    const f = createEngine(areas, SYNTHETIC_PARAMS, 999);
    f.restore(snap, times);
    expect(f.recommend()).toEqual(e.recommend());
    expect(snap.questionsAsked).toBe(1);
  });

  it('stops at the question limit', () => {
    const e = createEngine(areas, SYNTHETIC_PARAMS, 4);
    e.setProfile(syntheticProfile(), times);
    const ids = areas.map((a) => a.locality_id);
    for (let q = 0; q < 6; q++) e.observe({ type: 'prefer_area', a: ids[q]!, b: ids[q + 10]!, strength: 'normal' });
    const rec = e.recommend();
    expect(rec.shouldStop).toBe(true);
    expect(rec.nextQuestion).toBeNull();
  });

  it('runs at real size (937 synthetic areas x 4000 samples) within a few seconds', () => {
    const big = syntheticAreas(937, 21);
    const t0 = Date.now();
    const e = createEngine(big, SYNTHETIC_PARAMS, 5);
    e.setProfile(syntheticProfile(), syntheticTimes(big));
    e.observe({ type: 'pick_from_set', chosen: big[0]!.locality_id, set: big.slice(0, 5).map((a) => a.locality_id), strength: 'normal' });
    e.observe({ type: 'like_area', area: big[7]!.locality_id, strength: 'normal' });
    const rec = e.recommend();
    const ms = Date.now() - t0;
    expect(rec.shortlist).toHaveLength(5);
    expect(ms).toBeLessThan(15000);
  }, 30000);
});

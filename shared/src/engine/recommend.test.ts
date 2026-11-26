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
    expect(rec.ess).toBeCloseTo(belief.n, 6);
  });

  it('R3: stops when the best question is worth less than minEvoiShare of scale, unless ESS is below the floor', () => {
    const nothingWorthAsking = { ...DEFAULTS, minEvoiShare: 1e9 };
    const r = recommend(belief, util, ctx, profile, { k: 5, questionsAsked: 0, defaults: nothingWorthAsking });
    expect(r.shouldStop).toBe(true);
    expect(r.stopReason).toBe('nothing_left_to_learn');
    expect(r.nextQuestion).toBeNull();
    // All weight on one sample: ESS 1 is below the floor, so the EVOI stop does not apply.
    const w = new Float64Array(belief.n);
    w[0] = 1;
    const peaked = recommend({ ...belief, weights: w }, util, ctx, profile, { k: 5, questionsAsked: 1, defaults: nothingWorthAsking });
    expect(peaked.shouldStop).toBe(false);
    expect(peaked.nextQuestion).not.toBeNull();
  });

  it('R2: asks the highest-EVOI question and never repeats a pair already in the log', () => {
    const keepAsking = { ...DEFAULTS, minEvoiShare: -1 };
    const feasibleIds = new Set(ctx.areas.filter((_, a) => ctx.feasible[a]).map((x) => x.locality_id));
    const r = recommend(belief, util, ctx, profile, { k: 5, questionsAsked: 1, defaults: keepAsking });
    const q = r.nextQuestion;
    expect(q?.kind === 'pair' || q?.kind === 'time_tradeoff').toBe(true);
    if (q?.kind === 'pair') {
      expect(q.evoiYen).toBeGreaterThanOrEqual(0);
      expect(q.a).not.toBe(q.b);
      expect(feasibleIds.has(q.a) && feasibleIds.has(q.b)).toBe(true);
      const log = [{ type: 'prefer_area' as const, a: q.b, b: q.a, strength: 'normal' as const }];
      const again = recommend(belief, util, ctx, profile, { k: 5, questionsAsked: 1, defaults: keepAsking, log });
      const next = again.nextQuestion;
      expect(next?.kind === 'pair' && [next.a, next.b].sort().join() === [q.a, q.b].sort().join()).toBe(false);
    } else if (q?.kind === 'time_tradeoff') {
      expect(q.evoiYen).toBeGreaterThanOrEqual(0);
      expect(q.yen).toBeGreaterThan(0);
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

  it('asks the shortlist first, then by EVOI, while a question is worth asking', () => {
    const keepAsking = { ...DEFAULTS, minEvoiShare: -1 };
    const first = recommend(belief, util, ctx, profile, { k: 5, questionsAsked: 0, defaults: keepAsking });
    expect(first.nextQuestion?.kind).toBe('pick_from_shortlist');
    const second = recommend(belief, util, ctx, profile, { k: 5, questionsAsked: 1, defaults: keepAsking });
    expect(['pair', 'time_tradeoff']).toContain(second.nextQuestion?.kind);
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

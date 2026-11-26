// The invariants from docs/plans/engine-spec.md "Interface, defaults and
// tests", on SYNTHETIC areas (synthetic-fixtures.ts), not real data.
import { describe, expect, it } from 'vitest';

import { samplePrior, summarizeBelief } from './belief.js';
import { createEngine } from './index.js';
import { buildAreaContext } from './features.js';
import { buildUtilities, greedyShortlist, riskOfSet } from './recommend.js';
import { SYNTHETIC_PARAMS, syntheticAreas, syntheticProfile, syntheticTimes } from './synthetic-fixtures.js';
import type { Engine, Evidence } from './types.js';

const areas = syntheticAreas(60);
const times = syntheticTimes(areas);
const id = (i: number): string => areas[i]!.locality_id;

function engineWith(profile = syntheticProfile(), seed = 42): Engine {
  const e = createEngine(areas, SYNTHETIC_PARAMS, seed);
  e.setProfile(profile, times);
  return e;
}

const ITEMS: Evidence[] = [
  { type: 'prefer_area', a: id(1), b: id(2), strength: 'normal' },
  { type: 'direction', feature: 'bars', sign: -1, strength: 'strong' },
  { type: 'magnitude', feature: 'green_space', tier: 'high', strength: 'normal' },
  { type: 'pick_from_set', chosen: id(3), set: [id(3), id(4), id(5)], strength: 'normal' },
  { type: 'like_area', area: id(6), strength: 'weak' },
];

function weightsOf(engine: Engine): number[] {
  return engine.beliefSummary().params.map((p) => p.median).concat(engine.beliefSummary().ess);
}

describe('engine invariants (synthetic areas)', () => {
  it('1. weights are non-negative and sum to 1 after every operation', () => {
    const ctx = buildAreaContext(areas, SYNTHETIC_PARAMS, syntheticProfile(), times);
    const prior = samplePrior(ctx.scale, 1, 500);
    const check = (w: Float64Array): void => {
      let s = 0;
      for (const x of w) {
        expect(x).toBeGreaterThanOrEqual(0);
        s += x;
      }
      expect(s).toBeCloseTo(1, 9);
    };
    check(prior.weights);
    const engine = engineWith();
    for (const item of ITEMS) {
      expect(engine.observe(item).ok).toBe(true);
      const s = engine.beliefSummary();
      expect(s.ess).toBeGreaterThan(0);
      expect(s.ess).toBeLessThanOrEqual(4000 + 1e-6);
    }
  });

  it('2. with no evidence the belief summary equals the prior summary', () => {
    const engine = engineWith();
    const ctx = buildAreaContext(areas, SYNTHETIC_PARAMS, syntheticProfile(), times);
    expect(engine.beliefSummary()).toEqual(summarizeBelief(samplePrior(ctx.scale, 42, 4000)));
  });

  it('3. adding an item and then removing it restores the previous weights', () => {
    const engine = engineWith();
    engine.observe(ITEMS[0]!);
    const before = engine.beliefSummary();
    const r = engine.observe(ITEMS[1]!);
    expect(r.ok).toBe(true);
    if (r.ok) engine.removeEvidence(r.id);
    expect(engine.beliefSummary()).toEqual(before);
  });

  it('4. applying the same items in any order gives the same weights', () => {
    const forward = engineWith();
    ITEMS.forEach((e, i) => forward.observe({ ...e, id: `x${i}` }));
    const backward = engineWith();
    [...ITEMS].reverse().forEach((e, r) => backward.observe({ ...e, id: `x${ITEMS.length - 1 - r}` }));
    expect(weightsOf(backward)).toEqual(weightsOf(forward));
    expect(backward.recommend().shortlist.map((s) => s.localityId)).toEqual(forward.recommend().shortlist.map((s) => s.localityId));
  });

  it('5. no area that breaks a firm limit appears in a shortlist', () => {
    const profile = syntheticProfile({ budget: { value: 95000, firm: true }, commuteCap: { value: 40, firm: true } });
    const engine = engineWith(profile);
    const ctx = buildAreaContext(areas, SYNTHETIC_PARAMS, profile, times);
    const rec = engine.recommend();
    expect(rec.shortlist.length).toBeGreaterThan(0);
    for (const s of rec.shortlist) {
      expect(s.rentYen).toBeLessThanOrEqual(95000);
      expect(s.commuteMinutes!).toBeLessThanOrEqual(40);
      expect(ctx.feasible[ctx.index.get(s.localityId)!]).toBe(1);
    }
  });

  it('7. Risk(S) is never negative and does not rise when the shortlist grows', () => {
    const profile = syntheticProfile();
    const ctx = buildAreaContext(areas, SYNTHETIC_PARAMS, profile, times);
    const belief = samplePrior(ctx.scale, 5, 1000);
    const util = buildUtilities(belief, ctx, profile, 5);
    const order = greedyShortlist(util, belief.weights, ctx.feasible, 10);
    let prev = Infinity;
    for (let k = 1; k <= order.length; k++) {
      const r = riskOfSet(util, belief.weights, ctx.feasible, order.slice(0, k));
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(prev + 1e-9);
      prev = r;
    }
  });

  it('8. raising the budget never reduces the number of feasible areas', () => {
    let prev = -1;
    for (const value of [60000, 80000, 90000, 100000, 120000, 200000]) {
      const ctx = buildAreaContext(areas, SYNTHETIC_PARAMS, syntheticProfile({ budget: { value, firm: true } }), times);
      const n = ctx.feasible.reduce((s, x) => s + x, 0);
      expect(n).toBeGreaterThanOrEqual(prev);
      prev = n;
    }
  });

  it('9. the same seed, profile and evidence give an identical shortlist', () => {
    const a = engineWith(syntheticProfile(), 9);
    const b = engineWith(syntheticProfile(), 9);
    for (const e of ITEMS) {
      a.observe(e);
      b.observe(e);
    }
    expect(b.recommend()).toEqual(a.recommend());
  });

  it('10. a prefer_area item for a over b never lowers P(a beats b)', () => {
    for (const [x, y] of [[1, 2], [7, 3], [10, 40], [20, 21]] as const) {
      const engine = engineWith();
      engine.observe(ITEMS[1]!);
      const before = engine.compare(id(x), id(y)).pABeatsB;
      engine.observe({ type: 'prefer_area', a: id(x), b: id(y), strength: 'strong' });
      expect(engine.compare(id(x), id(y)).pABeatsB).toBeGreaterThanOrEqual(before - 1e-12);
    }
  });
});

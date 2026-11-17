// evidence.ts on SYNTHETIC areas (synthetic-fixtures.ts), not real data.
import { describe, expect, it } from 'vitest';

import { C_T_INDEX, FEATURE_OFFSET, samplePrior } from './belief.js';
import { likelihood, predictive, surpriseThreshold, validateEvidence } from './evidence.js';
import { buildAreaContext } from './features.js';
import { buildUtilities } from './recommend.js';
import { SYNTHETIC_PARAMS, syntheticAreas, syntheticProfile, syntheticTimes } from './synthetic-fixtures.js';
import { FEATURE_KEYS, PARAM_COUNT, type Evidence } from './types.js';

const areas = syntheticAreas(40);
const times = syntheticTimes(areas);
const profile = syntheticProfile();
const ctx = buildAreaContext(areas, SYNTHETIC_PARAMS, profile, times);
const belief = samplePrior(ctx.scale, 8, 800);
const util = buildUtilities(belief, ctx, profile, 8);
const id = (i: number): string => areas[i]!.locality_id;

function L(e: Evidence): Float64Array {
  const out = new Float64Array(belief.n);
  likelihood(e, belief, util, ctx, profile, out);
  return out;
}
const w = (i: number, k: (typeof FEATURE_KEYS)[number]): number => belief.theta[i * PARAM_COUNT + FEATURE_OFFSET + FEATURE_KEYS.indexOf(k)]!;

describe('likelihoods are in [0, 1] and finite for every type', () => {
  const items: Evidence[] = [
    { type: 'prefer_area', a: id(1), b: id(2), strength: 'normal' },
    { type: 'pick_from_set', chosen: id(1), set: [id(1), id(2), id(3)], strength: 'normal' },
    { type: 'reject_area', rejected: id(1), set: [id(1), id(2), id(3)], strength: 'normal' },
    { type: 'direction', feature: 'bars', sign: 1, strength: 'normal' },
    { type: 'magnitude', feature: 'green_space', tier: 'essential', strength: 'normal' },
    { type: 'compare_importance', more: 'residential_calm', less: 'dining', strength: 'normal' },
    { type: 'time_tradeoff', yen: 10000, minutes: 15, accept: true, strength: 'normal' },
    { type: 'like_area', area: id(4), strength: 'normal' },
    { type: 'dislike_area', area: id(4), strength: 'normal' },
  ];
  for (const e of items) {
    it(e.type, () => {
      for (const x of L(e)) {
        expect(Number.isFinite(x)).toBe(true);
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(1);
      }
    });
  }
});

describe('prefer_area', () => {
  it('rises with U(a) - U(b) and mirrors when swapped', () => {
    const ab = L({ type: 'prefer_area', a: id(1), b: id(2), strength: 'normal' });
    const ba = L({ type: 'prefer_area', a: id(2), b: id(1), strength: 'normal' });
    const nA = util.nAreas;
    for (let i = 0; i < belief.n; i++) {
      expect(ab[i]! + ba[i]!).toBeCloseTo(1, 9);
      const d = util.u[i * nA + ctx.index.get(id(1))!]! - util.u[i * nA + ctx.index.get(id(2))!]!;
      if (d > 0) expect(ab[i]).toBeGreaterThan(0.5);
    }
  });
});

describe('pick_from_set', () => {
  it('sums to 1 over the members and never underflows (E05)', () => {
    const set = [id(1), id(2), id(3), id(4)];
    const total = new Float64Array(belief.n);
    for (const c of set) L({ type: 'pick_from_set', chosen: c, set, strength: 'normal' }).forEach((x, i) => (total[i] = total[i]! + x));
    for (const t of total) expect(t).toBeCloseTo(1, 9);
  });
  it('reject is one minus pick', () => {
    const set = [id(1), id(2), id(3)];
    const p = L({ type: 'pick_from_set', chosen: id(2), set, strength: 'normal' });
    const r = L({ type: 'reject_area', rejected: id(2), set, strength: 'normal' });
    p.forEach((x, i) => expect(x + r[i]!).toBeCloseTo(1, 12));
  });
});

describe('direction', () => {
  it('favours samples with the stated sign', () => {
    const l = L({ type: 'direction', feature: 'bars', sign: -1, strength: 'normal' });
    for (let i = 0; i < belief.n; i++) expect(l[i]! > 0.5).toBe(w(i, 'bars') < 0);
  });
});

describe('magnitude', () => {
  it('peaks at the tier share of scale', () => {
    const l = L({ type: 'magnitude', feature: 'green_space', tier: 'high', strength: 'normal' });
    let best = 0;
    for (let i = 1; i < belief.n; i++) if (l[i]! > l[best]!) best = i;
    expect(w(best, 'green_space') / ctx.scale).toBeGreaterThan(0.03);
    expect(w(best, 'green_space') / ctx.scale).toBeLessThan(0.05);
  });
});

describe('time_tradeoff', () => {
  it('accepting favours high c_T, declining favours low', () => {
    const acc = L({ type: 'time_tradeoff', yen: 10000, minutes: 15, accept: true, strength: 'normal' });
    const dec = L({ type: 'time_tradeoff', yen: 10000, minutes: 15, accept: false, strength: 'normal' });
    const cStar = 10000 / ((52 / 12) * 5 * (30 / 60));
    for (let i = 0; i < belief.n; i++) {
      const c = belief.theta[i * PARAM_COUNT + C_T_INDEX]!;
      expect(acc[i]! > 0.5).toBe(c > cStar);
      expect(acc[i]! + dec[i]!).toBeCloseTo(1, 12);
    }
  });
});

describe('like_area', () => {
  it('like and dislike move in opposite directions', () => {
    const like = L({ type: 'like_area', area: id(5), strength: 'normal' });
    const dislike = L({ type: 'dislike_area', area: id(5), strength: 'normal' });
    for (let i = 0; i < belief.n; i++) expect(Math.sqrt(like[i]!) + Math.sqrt(dislike[i]!)).toBeCloseTo(1, 9);
  });
});

describe('predictive and surprise', () => {
  it('p_e of an all-ones likelihood is 1; all-zeros is epsilon', () => {
    expect(predictive(belief.weights, new Float64Array(belief.n).fill(1))).toBeCloseTo(1, 12);
    expect(predictive(belief.weights, new Float64Array(belief.n), 0.05)).toBeCloseTo(0.05, 12);
  });
  it('thresholds follow E06 / E07', () => {
    expect(surpriseThreshold({ type: 'prefer_area', a: 'x', b: 'y', strength: 'normal' })).toBe(0.15);
    expect(surpriseThreshold({ type: 'pick_from_set', chosen: 'x', set: ['x', 'y', 'z', 'w', 'v'], strength: 'normal' })).toBeCloseTo(0.1, 12);
    expect(surpriseThreshold({ type: 'magnitude', feature: 'bars', tier: 'low', strength: 'normal' })).toBe(0);
  });
});

describe('validateEvidence', () => {
  it('rejects unknown areas, a chosen outside the set and a tradeoff without trips', () => {
    expect(validateEvidence({ type: 'like_area', area: 'nope', strength: 'normal' }, ctx, profile, util)?.code).toBe('unknown_area');
    expect(validateEvidence({ type: 'pick_from_set', chosen: id(9), set: [id(1), id(2)], strength: 'normal' }, ctx, profile, util)?.code).toBe('invalid_evidence');
    const noAnchor = syntheticProfile({ anchors: [] });
    expect(validateEvidence({ type: 'time_tradeoff', yen: 1, minutes: 1, accept: true, strength: 'normal' }, ctx, noAnchor)?.code).toBe('profile_incomplete');
    expect(validateEvidence({ type: 'prefer_area', a: id(1), b: id(2), strength: 'normal' }, ctx, profile, util)).toBeNull();
  });
});

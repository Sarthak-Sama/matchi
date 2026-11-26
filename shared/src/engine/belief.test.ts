// belief.ts: prior, ESS, replay and summary. No area data needed except a
// constant likelihood stub.
import { describe, expect, it } from 'vitest';

import { C_T_INDEX, FEATURE_OFFSET, effectiveSampleSize, replay, samplePrior, summarizeBelief } from './belief.js';
import { FEATURE_KEYS, PARAM_COUNT, type Likelihood, type LoggedEvidence } from './types.js';

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
};

describe('samplePrior', () => {
  it('is deterministic per seed and a pure rescale in scale (E08)', () => {
    const a = samplePrior(100000, 1, 200);
    const b = samplePrior(100000, 1, 200);
    const c = samplePrior(200000, 1, 200);
    expect(Array.from(b.theta)).toEqual(Array.from(a.theta));
    expect(c.theta[C_T_INDEX]! / a.theta[C_T_INDEX]!).toBeCloseTo(2, 9);
  });

  it('puts the c_T median near scale / 133 times the archetype mix', () => {
    const p = samplePrior(100000, 2, 4000);
    const c = Array.from({ length: p.n }, (_, i) => p.theta[i * PARAM_COUNT + C_T_INDEX]!);
    const m = median(c);
    expect(m).toBeGreaterThan(400);
    expect(m).toBeLessThan(1100);
  });

  it('fixes signs: exposure negative, positives positive, bars either', () => {
    const p = samplePrior(100000, 3, 2000);
    const col = (k: (typeof FEATURE_KEYS)[number]): number[] =>
      Array.from({ length: p.n }, (_, i) => p.theta[i * PARAM_COUNT + FEATURE_OFFSET + FEATURE_KEYS.indexOf(k)]!);
    expect(col('road_rail_exposure').every((x) => x < 0)).toBe(true);
    expect(col('green_space').every((x) => x > 0)).toBe(true);
    const bars = col('bars');
    expect(bars.some((x) => x > 0) && bars.some((x) => x < 0)).toBe(true);
  });

  it('starts with uniform weights', () => {
    const p = samplePrior(100000, 4, 100);
    expect(effectiveSampleSize(p.weights)).toBeCloseTo(100, 9);
  });
});

describe('replay', () => {
  const prior = samplePrior(100000, 5, 300);
  const halfOut: Likelihood = (_e, b, _u, _c, _p, out) => {
    for (let i = 0; i < b.n; i++) out[i] = i < b.n / 2 ? 1 : 0;
  };
  const item = (id: string): LoggedEvidence => ({ id, type: 'direction', feature: 'bars', sign: 1, strength: 'normal' });

  it('with an empty log returns the prior weights', () => {
    expect(Array.from(replay(prior, [], halfOut).weights)).toEqual(Array.from(prior.weights));
  });

  it('applies the epsilon floor: a zero likelihood never zeroes a sample', () => {
    const b = replay(prior, [item('a')], halfOut, 0.05);
    const s = b.weights.reduce((x, y) => x + y, 0);
    expect(s).toBeCloseTo(1, 12);
    expect(b.weights[prior.n - 1]! / b.weights[0]!).toBeCloseTo(0.05, 12);
  });

  it('is independent of log order (E17: canonical id order)', () => {
    const a = replay(prior, [item('a'), item('b')], halfOut);
    const b = replay(prior, [item('b'), item('a')], halfOut);
    expect(Array.from(b.weights)).toEqual(Array.from(a.weights));
  });

  it('strength scales the exponent (R4: strong is 1.5)', () => {
    const strong = replay(prior, [{ ...item('a'), strength: 'strong' }], halfOut, 0.05);
    expect(strong.weights[prior.n - 1]! / strong.weights[0]!).toBeCloseTo(Math.pow(0.05, 1.5), 12);
  });
});

describe('summarizeBelief', () => {
  it('reports median and 10-90 range per parameter, shares for yen parameters only', () => {
    const s = summarizeBelief(samplePrior(100000, 6, 1000));
    expect(s.params).toHaveLength(PARAM_COUNT);
    for (const p of s.params) {
      expect(p.p10).toBeLessThanOrEqual(p.median);
      expect(p.median).toBeLessThanOrEqual(p.p90);
    }
    expect(s.params.find((p) => p.param === 'lambda_b')!.shareOfBudget).toBeNull();
    expect(s.params.find((p) => p.param === 'c_t')!.shareOfBudget).not.toBeNull();
    expect(s.lowConfidence).toBe(false);
  });
});

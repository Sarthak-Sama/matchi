// explain.ts via createEngine on SYNTHETIC areas (synthetic-fixtures.ts), not real data.
import { describe, expect, it } from 'vitest';

import { createEngine } from './index.js';
import { SYNTHETIC_PARAMS, syntheticAreas, syntheticProfile, syntheticTimes } from './synthetic-fixtures.js';
import { FEATURE_KEYS } from './types.js';

const areas = syntheticAreas(60);
const times = syntheticTimes(areas);

function engine(profile = syntheticProfile()) {
  const e = createEngine(areas, SYNTHETIC_PARAMS, 2);
  e.setProfile(profile, times);
  return e;
}

describe('whyNot', () => {
  it('handles unknown, firm-limit and ordinary areas', () => {
    const profile = syntheticProfile({ budget: { value: 90000, firm: true } });
    const e = engine(profile);
    expect(e.whyNot('nope')).toEqual({ kind: 'unknown_area', localityId: 'nope' });
    const rec = e.recommend();
    const shortIds = new Set(rec.shortlist.map((s) => s.localityId));
    const kinds = new Set<string>();
    for (const a of areas) {
      const w = e.whyNot(a.locality_id);
      kinds.add(w.kind);
      if (w.kind === 'fails_firm_limit') {
        expect(shortIds.has(a.locality_id)).toBe(false);
        expect(w.limit).toBe('budget');
        expect(w.by).toBeGreaterThan(0);
      }
      if (w.kind === 'needs_weight_change') expect(w.factor).toBeGreaterThan(1);
    }
    expect(kinds.has('is_top_pick')).toBe(true);
    expect(kinds.has('fails_firm_limit')).toBe(true);
  });
});

describe('compare', () => {
  it('diff is antisymmetric and the two probabilities sum to 1', () => {
    const e = engine();
    const [a, b] = [areas[1]!.locality_id, areas[2]!.locality_id];
    const ab = e.compare(a, b);
    const ba = e.compare(b, a);
    expect(ab.diff.total).toBeCloseTo(-ba.diff.total, 6);
    for (const k of FEATURE_KEYS) expect(ab.diff.features[k]).toBeCloseTo(-ba.diff.features[k], 9);
    expect(ab.pABeatsB + ba.pABeatsB).toBeCloseTo(1, 9);
    expect(() => e.compare(a, 'nope')).toThrow();
  });
});

describe('relax', () => {
  it('returns three steps per set limit, gains non-negative and monotone, one binding limit', () => {
    const e = engine(syntheticProfile({ budget: { value: 85000, firm: true }, commuteCap: { value: 30, firm: true } }));
    const opts = e.relax();
    expect(opts.map((o) => o.limit)).toEqual(['budget', 'budget', 'budget', 'commute_cap', 'commute_cap', 'commute_cap']);
    for (const limit of ['budget', 'commute_cap'] as const) {
      const steps = opts.filter((o) => o.limit === limit);
      for (let s = 1; s < steps.length; s++) expect(steps[s]!.areasGained).toBeGreaterThanOrEqual(steps[s - 1]!.areasGained);
      for (const o of steps) expect(o.yenGained).toBeGreaterThanOrEqual(0);
    }
    expect(new Set(opts.filter((o) => o.binding).map((o) => o.limit)).size).toBe(1);
  });

  it('skips unset limits and attaches relax to an empty recommendation', () => {
    const e = engine(syntheticProfile({ budget: { value: 1000, firm: true } }));
    const rec = e.recommend();
    expect(rec.shortlist).toHaveLength(0);
    expect(rec.excluded.overBudgetFirm).toBeGreaterThan(0);
    expect(rec.relax?.every((o) => o.limit === 'budget')).toBe(true);
  });
});

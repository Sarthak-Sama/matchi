// features.ts on SYNTHETIC areas (synthetic-fixtures.ts), not real data.
import { describe, expect, it } from 'vitest';

import { buildAreaContext, dataGap, featureTable, modelledRent, monthlyHours, saturate } from './features.js';
import { SYNTHETIC_PARAMS, syntheticAreas, syntheticProfile, syntheticTimes } from './synthetic-fixtures.js';
import { FEATURE_KEYS, type AreaFeatures } from './types.js';

describe('saturate', () => {
  it('reaches 0.9 at h, 0 at 0, and is increasing', () => {
    expect(saturate(4, 4)).toBeCloseTo(0.9, 12);
    expect(saturate(0, 4)).toBe(0);
    expect(saturate(8, 4)).toBeCloseTo(0.99, 12);
    expect(saturate(2, 4)).toBeLessThan(saturate(3, 4));
  });
  it('never returns NaN (E20: h <= 0 is a step)', () => {
    expect(saturate(1, 0)).toBe(1);
    expect(saturate(Number.NaN, 4)).toBe(0);
  });
});

describe('featureTable', () => {
  it('lists the thirteen features in FEATURE_KEYS order with spec h values', () => {
    expect(featureTable.map((f) => f.key)).toEqual([...FEATURE_KEYS]);
    expect(featureTable.map((f) => f.h)).toEqual([4, 40, 10, 12, 6, 8, 0.15, 0.6, 0.5, 6, null, 3, 0.8]);
    expect(featureTable.find((f) => f.key === 'road_rail_exposure')!.sign).toBe('negative');
    expect(featureTable.find((f) => f.key === 'bars')!.sign).toBe('either');
  });
});

describe('modelledRent', () => {
  const base = syntheticAreas(1)[0]!;
  it('is r * m * A + f with m clamped to the fallback [0.85, 1.15] (D7)', () => {
    const a: AreaFeatures = { ...base, rent_per_sqm_yen: 3000, management_fee_yen: 5000, land_value_yen_per_sqm: 1e6 };
    expect(modelledRent(a, 1e6, 24, SYNTHETIC_PARAMS)).toBeCloseTo(3000 * 24 + 5000, 6);
    const rich = { ...a, land_value_yen_per_sqm: 1e9 };
    expect(modelledRent(rich, 1e6, 24, SYNTHETIC_PARAMS)).toBeCloseTo(3000 * 1.15 * 24 + 5000, 6);
    const poor = { ...a, land_value_yen_per_sqm: 1 };
    expect(modelledRent(poor, 1e6, 24, SYNTHETIC_PARAMS)).toBeCloseTo(3000 * 0.85 * 24 + 5000, 6);
  });
  it('uses m = 1 for a null land value and NaN for null rent inputs (E04)', () => {
    const a: AreaFeatures = { ...base, rent_per_sqm_yen: 3000, management_fee_yen: 5000, land_value_yen_per_sqm: null };
    expect(modelledRent(a, 1e6, 24, SYNTHETIC_PARAMS)).toBeCloseTo(77000, 6);
    expect(modelledRent({ ...a, rent_per_sqm_yen: null }, 1e6, 24, SYNTHETIC_PARAMS)).toBeNaN();
  });
});

describe('monthlyHours', () => {
  it('converts one-way minutes and weekly trips to monthly hours', () => {
    expect(monthlyHours(30, 5)).toBeCloseTo((52 / 12) * 5 * 1, 12);
  });
});

describe('buildAreaContext', () => {
  const areas = syntheticAreas(30);
  const times = syntheticTimes(areas);

  it('excludes null inputs once, under the first reason (E04)', () => {
    const broken = areas.map((a) => ({ ...a }));
    broken[0] = { ...broken[0]!, rent_per_sqm_yen: null, line_count: null };
    broken[1] = { ...broken[1]!, residential_zoning_share: null };
    broken[2] = { ...broken[2]!, line_count: null };
    broken[3] = { ...broken[3]!, reach_restaurant: null };
    broken[4] = { ...broken[4]!, land_value_yen_per_sqm: null, land_value_nearest_m: null };
    expect(dataGap(broken[4]!)).toBeNull();
    const ctx = buildAreaContext(broken, SYNTHETIC_PARAMS, syntheticProfile(), times);
    expect(ctx.excluded).toMatchObject({ nullRent: 1, nullLifestyle: 1, missingAccess: 2 });
    expect([0, 1, 2, 3].map((a) => ctx.feasible[a])).toEqual([0, 0, 0, 0]);
    expect(ctx.feasible[4]).toBe(1);
    expect(ctx.sigmaRent[4]).toBe(0.12);
    for (const v of ctx.sat) expect(Number.isFinite(v)).toBe(true);
  });

  it('counts NaN minutes as disconnected and applies firm limits', () => {
    const t = { work: [...(times.work as number[])] };
    t.work[5] = Number.NaN;
    const profile = syntheticProfile({ budget: { value: 90000, firm: true }, commuteCap: { value: 30, firm: true } });
    const ctx = buildAreaContext(areas, SYNTHETIC_PARAMS, profile, t);
    expect(ctx.excluded.disconnected).toBe(1);
    expect(ctx.feasible[5]).toBe(0);
    for (let a = 0; a < areas.length; a++) {
      if (!ctx.feasible[a]) continue;
      expect(ctx.rent[a]).toBeLessThanOrEqual(90000);
      expect(ctx.minutes[0]![a]).toBeLessThanOrEqual(30);
    }
    const total = Object.values(ctx.excluded).reduce((s, x) => s + x, 0) + ctx.feasible.reduce((s, x) => s + x, 0);
    expect(total).toBe(areas.length);
  });

  it('uses the budget as scale, else the median modelled rent', () => {
    const withBudget = buildAreaContext(areas, SYNTHETIC_PARAMS, syntheticProfile(), times);
    expect(withBudget.scale).toBe(100000);
    const noBudget = buildAreaContext(areas, SYNTHETIC_PARAMS, syntheticProfile({ budget: undefined }), times);
    expect(noBudget.scale).toBeGreaterThan(50000);
    expect(noBudget.scale).toBeLessThan(150000);
  });

  it('raising "enough" lowers saturation', () => {
    const plain = buildAreaContext(areas, SYNTHETIC_PARAMS, syntheticProfile(), times);
    const lots = buildAreaContext(areas, SYNTHETIC_PARAMS, syntheticProfile({ enoughMultipliers: { dining: 2 } }), times);
    const j = FEATURE_KEYS.indexOf('dining');
    expect(lots.sat[j]!).toBeLessThanOrEqual(plain.sat[j]!);
  });
});

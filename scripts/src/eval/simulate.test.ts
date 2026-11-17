// Tests for the simulation harness. All data here is SYNTHETIC (engine synthetic fixtures
// with the imposed urban/quiet trade-off); no database, no network.
import { describe, expect, it } from 'vitest';

import { loadEngine, loadSynthetic } from './engine-loader.js';
import { assertLocalDatabaseUrl, formatTable, quantile, runSimulation, summarise, withUrbanTradeoff } from './simulate.js';

async function syntheticInput(people: number, questions: number) {
  const syn = await loadSynthetic();
  const areas = withUrbanTradeoff(syn.syntheticAreas(60));
  return {
    areas,
    params: syn.SYNTHETIC_PARAMS,
    anchorTimes: syn.syntheticTimes(areas, 'work'),
    profile: syn.syntheticProfile({ commuteCap: { value: 60, firm: true } }),
    people,
    questions,
    seed: 123,
  };
}

describe('quantile and summarise', () => {
  it('interpolates and handles empty input', () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantile([5], 0.9)).toBe(5);
    expect(quantile([], 0.5)).toBeNaN();
    expect(quantile([0, 10], 0.9)).toBeCloseTo(9);
  });
  it('gives one row per step', () => {
    const rows = summarise([[1, 3], [2]]);
    expect(rows.map((r) => r.questions)).toEqual([0, 1]);
    expect(rows[0]).toMatchObject({ n: 2, medianYen: 2, meanYen: 2 });
  });
});

describe('assertLocalDatabaseUrl', () => {
  it('accepts localhost only', () => {
    expect(assertLocalDatabaseUrl('postgresql://u:p@localhost:5432/tokyo')).toContain('localhost');
    expect(() => assertLocalDatabaseUrl('postgresql://u:p@ep-x.aws.neon.tech/neondb')).toThrow(/local/);
    expect(() => assertLocalDatabaseUrl('postgresql://u:p@db.example.com:5432/tokyo')).toThrow(/local/);
    expect(() => assertLocalDatabaseUrl(undefined)).toThrow(/DATABASE_URL/);
  });
  it('does not leak the URL in its errors', () => {
    try {
      assertLocalDatabaseUrl('postgresql://secretuser:secretpass@db.example.com:5432/tokyo');
    } catch (e) {
      expect(String(e)).not.toMatch(/secretpass|secretuser/);
    }
  });
});

describe('runSimulation (synthetic data)', () => {
  it('is deterministic for a seed and produces a well-formed table', async () => {
    const eng = await loadEngine();
    const input = await syntheticInput(15, 3);
    const a = runSimulation(eng, input);
    const b = runSimulation(eng, input);
    expect(a).toEqual(b);
    expect(a.rows).toHaveLength(4);
    for (const r of a.rows) {
      expect(r.n).toBe(15);
      expect(r.medianYen).toBeGreaterThanOrEqual(0);
      expect(r.p90Yen).toBeGreaterThanOrEqual(r.medianYen);
    }
    expect(a.observeErrors).toBe(0);
    expect(a.skippedPeople).toBe(0);
    expect(formatTable(a).split('\n')).toHaveLength(5);
  }, 60_000);

  it('changes with the seed', async () => {
    const eng = await loadEngine();
    const input = await syntheticInput(15, 2);
    const a = runSimulation(eng, input);
    const b = runSimulation(eng, { ...input, seed: 124 });
    expect(a.rows.map((r) => r.meanYen)).not.toEqual(b.rows.map((r) => r.meanYen));
  }, 60_000);

  it('answers reduce mean regret on the synthetic trade-off data', async () => {
    const eng = await loadEngine();
    const result = runSimulation(eng, await syntheticInput(30, 4));
    const first = result.rows[0]!.meanYen;
    const last = result.rows[4]!.meanYen;
    expect(last).toBeLessThanOrEqual(first);
  }, 60_000);
});

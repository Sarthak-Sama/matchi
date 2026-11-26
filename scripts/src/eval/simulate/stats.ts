// Small statistics for the simulation report: quantiles, bootstrap intervals, summaries.
import { createRng } from '@tokyo/shared';

/** Linear-interpolated quantile of a list (copy is sorted). NaN for an empty list. */
export function quantile(values: readonly number[], q: number): number {
  if (values.length === 0) return NaN;
  const v = [...values].sort((a, b) => a - b);
  const pos = (v.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return v[lo]! + (v[hi]! - v[lo]!) * (pos - lo);
}

export function mean(values: readonly number[]): number {
  return values.length ? values.reduce((s, x) => s + x, 0) / values.length : NaN;
}

export interface Interval {
  low: number;
  high: number;
}

export const BOOTSTRAP_RESAMPLES = 1000;

/**
 * Bootstrap over people: each resample draws people with replacement and
 * returns the mean of every column over that draw (columns stay paired, so a
 * difference of two columns gets a proper interval). Result: [resample][column].
 */
export function bootstrapMeans(columns: readonly (readonly number[])[], seed: number, resamples = BOOTSTRAP_RESAMPLES): number[][] {
  const n = columns[0]?.length ?? 0;
  const rng = createRng(seed);
  return Array.from({ length: resamples }, () => {
    const sums = new Array<number>(columns.length).fill(0);
    for (let i = 0; i < n; i++) {
      const pick = rng.int(n);
      columns.forEach((column, c) => (sums[c] = sums[c]! + column[pick]!));
    }
    return sums.map((s) => s / n);
  });
}

/** The 2.5th and 97.5th percentiles. */
export function interval95(values: readonly number[]): Interval {
  return { low: quantile(values, 0.025), high: quantile(values, 0.975) };
}

// Pass-rate statistics for repeated persona runs.

const Z_95 = 1.96;

export interface Interval {
  low: number;
  high: number;
}

/** Wilson score interval for `successes` out of `trials`, 95%. Behaves at 0 and `trials`, unlike the normal approximation. */
export function wilsonInterval(successes: number, trials: number): Interval {
  if (trials === 0) return { low: 0, high: 1 };
  const p = successes / trials;
  const z2 = Z_95 * Z_95;
  const denominator = 1 + z2 / trials;
  const centre = (p + z2 / (2 * trials)) / denominator;
  const half = (Z_95 * Math.sqrt((p * (1 - p)) / trials + z2 / (4 * trials * trials))) / denominator;
  return { low: Math.max(0, centre - half), high: Math.min(1, centre + half) };
}

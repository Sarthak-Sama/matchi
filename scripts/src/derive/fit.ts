export interface LinearFit {
  readonly slope: number;
  readonly intercept: number;
  readonly n: number;
  readonly r2: number;
  readonly slopeStdError: number;
  readonly slopeCi95: readonly [number, number];
}

// Two-sided 97.5% Student-t quantile via the Cornish-Fisher expansion around
// the normal quantile. Within 0.002 of the exact value for df >= 5, which is
// far below the uncertainty of a 23-point fit.
export function tQuantile975(df: number): number {
  if (!(df >= 1)) throw new Error(`tQuantile975: df must be >= 1, got ${String(df)}`);
  const z = 1.959963984540054;
  return (
    z +
    (z ** 3 + z) / (4 * df) +
    (5 * z ** 5 + 16 * z ** 3 + 3 * z) / (96 * df ** 2) +
    (3 * z ** 7 + 19 * z ** 5 + 17 * z ** 3 - 15 * z) / (384 * df ** 3)
  );
}

export function fitLinear(xs: readonly number[], ys: readonly number[]): LinearFit {
  if (xs.length !== ys.length) throw new Error("fitLinear: xs and ys differ in length");
  const n = xs.length;
  if (n < 3) throw new Error(`fitLinear: need at least 3 points, got ${n}`);
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = (xs[i] ?? 0) - meanX;
    const dy = (ys[i] ?? 0) - meanY;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  if (sxx === 0) throw new Error("fitLinear: all x values are equal");
  const slope = sxy / sxx;
  const intercept = meanY - slope * meanX;
  const ssr = Math.max(0, syy - slope * sxy);
  const r2 = syy === 0 ? 1 : 1 - ssr / syy;
  const slopeStdError = Math.sqrt(ssr / (n - 2) / sxx);
  const t = tQuantile975(n - 2);
  return {
    slope,
    intercept,
    n,
    r2,
    slopeStdError,
    slopeCi95: [slope - t * slopeStdError, slope + t * slopeStdError],
  };
}

// Elasticity of y on x: the slope of ln(y) on ln(x).
export function fitElasticity(xs: readonly number[], ys: readonly number[]): LinearFit {
  for (const v of [...xs, ...ys]) {
    if (!(v > 0)) throw new Error(`fitElasticity: every value must be > 0, got ${String(v)}`);
  }
  return fitLinear(xs.map(Math.log), ys.map(Math.log));
}

export interface CountBand {
  readonly low: number;
  // Exclusive upper bound; null for an open top band.
  readonly high: number | null;
  readonly count: number;
}

// Median of a banded distribution, interpolating linearly inside the band
// that holds the middle observation. Returns null when the median falls in an
// open top band, where no interpolation is defensible.
export function bandedMedian(bands: readonly CountBand[]): number | null {
  const sorted = [...bands].sort((a, b) => a.low - b.low);
  const total = sorted.reduce((sum, b) => sum + b.count, 0);
  if (total <= 0) return null;
  const half = total / 2;
  let below = 0;
  for (const band of sorted) {
    if (below + band.count >= half && band.count > 0) {
      if (band.high === null) return null;
      return band.low + ((half - below) / band.count) * (band.high - band.low);
    }
    below += band.count;
  }
  return null;
}

/**
 * Linear-interpolation percentile (the "R-7" / Excel `PERCENTILE.INC`
 * method) over an ALREADY-SORTED-ASCENDING, non-empty array. `p` is a
 * fraction in `[0, 1]` (e.g. `0.25` for the 25th percentile).
 *
 * Shared by `domain/scoring.ts` (budget/commute suggestion thresholds) and
 * `routes/lib/candidates.ts` (per-locality commute range) — kept in one
 * place so the two don't drift into implementations with different
 * preconditions.
 */
export function percentile(sortedAscending: readonly number[], p: number): number {
  const n = sortedAscending.length;
  if (n === 0) {
    throw new Error("percentile: empty input");
  }
  const idx = p * (n - 1);
  const lowerIdx = Math.floor(idx);
  const upperIdx = Math.ceil(idx);
  const lower = sortedAscending[lowerIdx];
  const upper = sortedAscending[upperIdx];
  if (lower === undefined || upper === undefined) {
    throw new Error("percentile: index out of range");
  }
  const weight = idx - lowerIdx;
  return lower + (upper - lower) * weight;
}

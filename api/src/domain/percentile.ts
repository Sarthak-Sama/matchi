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

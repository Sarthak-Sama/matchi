/**
 * Maps MLIT A31 想定最大規模 (maximum-assumed-scale) inundation depth codes
 * onto `flood_zones.depth_rank`.
 *
 * **The max-scale layer uses a different field from the planning-scale
 * layer.** `import-mlit/flood.ts` was written against `A31_101`; the
 * 02_想定最大規模 files in the 2019/2020 Kanto release carry `A31_201`
 * instead, as an integer rank rather than a depth-range string. Reading
 * the wrong one yields no depth category at all, so the staging pass
 * resolves the rank here and emits an explicit `depth_rank`, which
 * `flood.ts` accepts and prefers over its own classifier.
 *
 * MLIT's depth bands for this layer, and the ranks this project uses:
 *
 *   A31_201  depth band            depth_rank
 *   1        0 – 0.5 m                  1
 *   2        0.5 – 3.0 m                2
 *   3        3.0 – 5.0 m                3
 *   4        5.0 – 10.0 m               4
 *   5        10.0 – 20.0 m              5
 *   6        20.0 m and above           5
 *
 * MLIT splits the deepest band in two; `flood_zones.depth_rank` tops out
 * at 5, and `derive/flood.ts` sums `share * depth_rank`, so 6 folds into
 * 5 rather than being dropped. Anything at or beyond 10 m of inundation is
 * already the worst category this model distinguishes, and treating a
 * 20 m band as "no data" would make the very worst areas look safe.
 */

/** The 1-5 rank scale `flood_zones.depth_rank` stores. */
export const MAX_DEPTH_RANK = 5;

const DEPTH_BAND_LABELS: Readonly<Record<number, string>> = {
  1: "0.5m未満",
  2: "0.5m以上3.0m未満",
  3: "3.0m以上5.0m未満",
  4: "5.0m以上10.0m未満",
  5: "10.0m以上20.0m未満",
  6: "20.0m以上",
};

export interface FloodDepth {
  readonly depthRank: number;
  readonly depthCategory: string;
}

/**
 * Resolves an `A31_201` code into a rank and a human-readable band label,
 * or null when the code is not one MLIT documents for this layer — the
 * caller reports those rather than guessing a severity.
 */
export function floodDepthFromA31201(raw: unknown): FloodDepth | null {
  const code = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isInteger(code)) return null;

  const depthCategory = DEPTH_BAND_LABELS[code];
  if (depthCategory === undefined) return null;

  return { depthRank: Math.min(code, MAX_DEPTH_RANK), depthCategory };
}

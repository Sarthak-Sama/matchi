/**
 * The lifestyle half of `neighborhood_metrics`, derived once from the axis
 * registry and its describe satellite: the SELECT fragment both route
 * queries embed, the matching row type both routes' row interfaces extend,
 * and the readers that turn a row's lifestyle columns into the non-nullable
 * numbers `LifestyleMetricsInput` requires.
 *
 * Generating these is what keeps adding an axis a registry-only change:
 * without it, every new axis means a new column in two SQL strings, a new
 * field in two row types, and a new null check in two guards.
 */

import type { LifestyleAxisId, LifestyleAxisMetricsKey } from "@tokyo/shared";
import { LIFESTYLE_AXES, LIFESTYLE_AXIS_IDS } from "@tokyo/shared";

import { LIFESTYLE_AXIS_DESCRIBERS } from "../../domain/lifestyle-axis-describe.js";

/** `"restaurant_count"` -> `"restaurantCount"`, at the type level. */
type SnakeToCamel<S extends string> = S extends `${infer Head}_${infer Tail}`
  ? `${Head}${Capitalize<SnakeToCamel<Tail>>}`
  : S;

type LifestyleRawColumn = (typeof LIFESTYLE_AXIS_DESCRIBERS)[LifestyleAxisId]["rawColumns"][number];
type LifestyleRawAlias = SnakeToCamel<LifestyleRawColumn>;

/**
 * The metrics half of `CandidateRow`/`NeighborhoodRow`: every lifestyle
 * column `LIFESTYLE_SELECT_SQL` projects, under its camelCase alias.
 *
 * All nullable, including the raw counts — which are `NOT NULL DEFAULT 0`
 * in the schema but still come back `null` through
 * `/v1/neighborhoods`'s LEFT JOIN when a station has no metrics row at all.
 */
export type LifestyleMetricColumns = {
  readonly [Key in LifestyleAxisMetricsKey | LifestyleRawAlias]: number | null;
};

/**
 * Runtime counterpart of `SnakeToCamel`. The `as` is the seam between the
 * string transformation and its type-level twin, which cannot be inferred
 * from a `.replace` call.
 */
function snakeToCamel<S extends string>(column: S): SnakeToCamel<S> {
  return column.replace(/_(\w)/g, (_match, char: string) => char.toUpperCase()) as SnakeToCamel<S>;
}

/** Registry order, then raw columns in first-declaring-axis order, deduplicated. */
const RAW_COLUMNS: readonly LifestyleRawColumn[] = [
  ...new Set(LIFESTYLE_AXIS_IDS.flatMap((id) => LIFESTYLE_AXIS_DESCRIBERS[id].rawColumns)),
];

/**
 * The lifestyle columns as a SELECT fragment, aliased to their row-type
 * field names. Indented to sit inside the routes' four-space column lists;
 * the caller supplies the trailing comma.
 */
export const LIFESTYLE_SELECT_SQL = [
  ...LIFESTYLE_AXIS_IDS.map(
    (id) => `nm.${LIFESTYLE_AXES[id].normColumn} AS "${LIFESTYLE_AXES[id].metricsKey}"`,
  ),
  ...RAW_COLUMNS.map((column) => `nm.${column} AS "${snakeToCamel(column)}"`),
].join(",\n    ");

/**
 * Every axis's normalized 0-100 score, or `null` when the row is missing at
 * least one of them — i.e. the station has not been through `pnpm derive`
 * (or was LEFT JOINed to nothing). Both routes treat that as "no derived
 * data" rather than substituting a score no pipeline produced.
 */
export function readLifestyleNormScores(
  row: LifestyleMetricColumns,
): Record<LifestyleAxisMetricsKey, number> | null {
  const scores = {} as Record<LifestyleAxisMetricsKey, number>;
  for (const id of LIFESTYLE_AXIS_IDS) {
    const value = row[LIFESTYLE_AXES[id].metricsKey];
    if (value === null) return null;
    scores[LIFESTYLE_AXES[id].metricsKey] = value;
  }
  return scores;
}

/**
 * The raw counts the describers declare, under the same aliases
 * `LifestyleMetricsInput` uses. `?? 0` is belt-and-braces: these columns are
 * `NOT NULL DEFAULT 0`, and the only way to see `null` is a LEFT JOIN that
 * matched no metrics row — in which case `readLifestyleNormScores` has
 * already returned `null` and the caller has bailed out.
 */
export function readLifestyleRawCounts(
  row: LifestyleMetricColumns,
): Record<LifestyleRawAlias, number> {
  const counts = {} as Record<LifestyleRawAlias, number>;
  for (const column of RAW_COLUMNS) {
    const alias = snakeToCamel(column);
    counts[alias] = row[alias] ?? 0;
  }
  return counts;
}

import type { LifestyleAxisId, LifestyleAxisMetricsKey } from "@tokyo/shared";
import { LIFESTYLE_AXES, LIFESTYLE_AXIS_IDS } from "@tokyo/shared";

import { LIFESTYLE_AXIS_DESCRIBERS } from "../../domain/lifestyle-axis-describe.js";

type SnakeToCamel<S extends string> = S extends `${infer Head}_${infer Tail}`
  ? `${Head}${Capitalize<SnakeToCamel<Tail>>}`
  : S;

type LifestyleRawColumn = (typeof LIFESTYLE_AXIS_DESCRIBERS)[LifestyleAxisId]["rawColumns"][number];
type LifestyleRawAlias = SnakeToCamel<LifestyleRawColumn>;

export type LifestyleMetricColumns = {
  readonly [Key in LifestyleAxisMetricsKey | LifestyleRawAlias]: number | null;
};

function snakeToCamel<S extends string>(column: S): SnakeToCamel<S> {
  return column.replace(/_(\w)/g, (_match, char: string) => char.toUpperCase()) as SnakeToCamel<S>;
}

const RAW_COLUMNS: readonly LifestyleRawColumn[] = [
  ...new Set(LIFESTYLE_AXIS_IDS.flatMap((id) => LIFESTYLE_AXIS_DESCRIBERS[id].rawColumns)),
];

export const LIFESTYLE_SELECT_SQL = [
  ...LIFESTYLE_AXIS_IDS.map(
    (id) => `nm.${LIFESTYLE_AXES[id].normColumn} AS "${LIFESTYLE_AXES[id].metricsKey}"`,
  ),
  ...RAW_COLUMNS.map((column) => `nm.${column} AS "${snakeToCamel(column)}"`),
].join(",\n    ");

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

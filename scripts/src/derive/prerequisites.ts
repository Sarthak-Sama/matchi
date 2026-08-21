/**
 * Prerequisite checks shared by the derive steps.
 *
 * `pnpm derive --only=<step>` lets a caller run a single step in isolation
 * (e.g. to re-derive just the amenity counts after editing `pois`). Steps
 * later in the pipeline read columns an earlier step wrote, so running a
 * later step before its dependency has ever run must fail loudly with a
 * clear message — not silently write nulls or leave stale values in place.
 */

import type { Pool } from "pg";

/**
 * Throws a clear error naming both the missing prerequisite step and the
 * `--only` flag to fix it, unless every row in `station_groups` has a
 * matching row in `station_areas` (i.e. the catchments step has run at
 * least once since the last time station_groups changed).
 */
export async function assertCatchmentsDerived(pool: Pool): Promise<void> {
  const { rows } = await pool.query<{ missing: string }>(`
    SELECT count(*)::text AS missing
    FROM station_groups sg
    LEFT JOIN station_areas sa ON sa.station_group_id = sg.station_group_id
    WHERE sa.station_group_id IS NULL
  `);
  const missing = Number(rows[0]?.missing ?? "0");
  if (missing > 0) {
    throw new Error(
      `derive: ${missing} station(s) have no station_areas row. Run the catchments step ` +
        `first (\`pnpm derive --only=catchments\` or a full \`pnpm derive\`).`,
    );
  }
}

/**
 * Throws unless every `neighborhood_metrics` row has non-null values in
 * every column of `columns`, naming the offending step in the message.
 */
export async function assertColumnsPopulated(
  pool: Pool,
  columns: readonly string[],
  requiredByStep: string,
  fixHint: string,
): Promise<void> {
  const predicate = columns.map((c) => `${c} IS NULL`).join(" OR ");
  const { rows } = await pool.query<{ missing: string }>(`
    SELECT count(*)::text AS missing
    FROM neighborhood_metrics
    WHERE ${predicate}
  `);
  const missing = Number(rows[0]?.missing ?? "0");
  if (missing > 0) {
    throw new Error(
      `derive: ${missing} station(s) are missing one of [${columns.join(", ")}], required by ` +
        `the "${requiredByStep}" step. Run ${fixHint} first (or a full \`pnpm derive\`).`,
    );
  }
}

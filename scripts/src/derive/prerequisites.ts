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

/**
 * The rent step's own skip condition (see `derive/rent.ts`'s per-row loop):
 * a station is skipped — permanently, not transiently — when it has no
 * `ward_code` at all, or when its ward has no `rent_stats` row. Both are
 * real, expected outcomes of a real MLIT import (see `import-mlit.ts`'s
 * module doc comment on `stationsWithoutWardCode`), not a sign the rent
 * step never ran. Recomputed directly from current `station_groups` /
 * `rent_stats` state (rather than threaded in from a specific `runRentStep`
 * invocation) so this holds regardless of whether rent last ran earlier in
 * the SAME `pnpm derive` invocation or a previous one (e.g. under a
 * standalone `pnpm derive --only=normalization`) — nothing else mutates
 * `ward_code` or `rent_stats` in between.
 */
const RENT_SKIP_CONDITION_SQL = `
  sg.ward_code IS NULL
  OR NOT EXISTS (SELECT 1 FROM rent_stats rs WHERE rs.ward_code = sg.ward_code)
`;

/**
 * The `rent_source`-specific prerequisite `normalization` needs: unlike
 * `assertColumnsPopulated`, this does NOT require every station to have a
 * non-null `rent_source` — only the ones the rent step actually attempted
 * to write (i.e. excluding stations `derive/rent.ts` legitimately and
 * permanently warn-and-skips for lack of a ward assignment or ward rent
 * data). Failing to scope this the same way `assertColumnsPopulated` does
 * would make a full `pnpm derive` abort forever the first time a real
 * import produces even one out-of-ward station — with no `--only=rent`
 * re-run able to fix it, since rent step would skip that station again.
 */
export async function assertRentSourcePopulatedForRankableStations(pool: Pool): Promise<void> {
  const { rows } = await pool.query<{ missing: string }>(`
    SELECT count(*)::text AS missing
    FROM neighborhood_metrics nm
    JOIN station_groups sg ON sg.station_group_id = nm.station_group_id
    WHERE nm.rent_source IS NULL
      AND NOT (${RENT_SKIP_CONDITION_SQL})
  `);
  const missing = Number(rows[0]?.missing ?? "0");
  if (missing > 0) {
    throw new Error(
      `derive: ${missing} station(s) have a ward assignment and ward rent data available but no ` +
        `rent_source — the rent step has not written them yet. Run the rent step first ` +
        `(\`pnpm derive --only=rent\` or a full \`pnpm derive\`).`,
    );
  }
}

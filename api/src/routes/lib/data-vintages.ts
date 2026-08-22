/**
 * Shared query for "the latest `import_runs` row per source" — used by both
 * `GET /v1/data-status` (which needs status/rowsImported/error too) and
 * `POST /v1/optimize`'s `dataVintages` field (which only needs the
 * source/sourceUpdatedAt/importedAt subset). One query, two projections,
 * rather than duplicating the `DISTINCT ON` SQL in both routes.
 */

import type { DbPool } from "../../db.js";

const LATEST_IMPORT_RUNS_SQL = `
  SELECT DISTINCT ON (source)
    source,
    status,
    source_updated_at AS "sourceUpdatedAt",
    started_at AS "startedAt",
    finished_at AS "finishedAt",
    rows_imported AS "rowsImported",
    error
  FROM import_runs
  ORDER BY source, started_at DESC
`;

interface LatestImportRunRow {
  readonly source: string;
  readonly status: string;
  readonly sourceUpdatedAt: Date | null;
  readonly startedAt: Date;
  readonly finishedAt: Date | null;
  readonly rowsImported: number | null;
  readonly error: string | null;
}

export interface LatestImportRun {
  readonly source: string;
  readonly status: string;
  readonly sourceUpdatedAt: string | null;
  /** The run's completion time, ISO-8601 — `null` for a run still in progress. */
  readonly importedAt: string | null;
  readonly rowsImported: number | null;
  readonly error: string | null;
}

/** The latest (by `started_at`) `import_runs` row per distinct `source`, newest first. */
export async function loadLatestImportRuns(pool: DbPool): Promise<LatestImportRun[]> {
  const result = (await pool.query(LATEST_IMPORT_RUNS_SQL)) as { rows: LatestImportRunRow[] };
  return result.rows.map((row) => ({
    source: row.source,
    status: row.status,
    sourceUpdatedAt: row.sourceUpdatedAt ? row.sourceUpdatedAt.toISOString() : null,
    importedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
    rowsImported: row.rowsImported,
    error: row.error,
  }));
}

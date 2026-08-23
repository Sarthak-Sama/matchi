/**
 * Shared query for "the latest `import_runs` row per source" — used by both
 * `GET /v1/data-status` (which needs status/rowsImported/error too, and
 * deliberately shows the LATEST run of any status — see below) and
 * `POST /v1/optimize`'s `dataVintages` field (which only needs the
 * source/sourceUpdatedAt/importedAt subset).
 *
 * The two callers need different rows, not just different projections:
 * `runImport` records a `failed` row with `finished_at` set after rolling
 * its own writes back, so the data actually on disk for that source is
 * whatever the last `success`ful run wrote — not the failed run's
 * timestamps. `loadLatestImportRuns` (feeding `dataVintages`) filters to
 * `status = 'success'` so it never reports a failed run's vintage as if it
 * described the live data. `/v1/data-status` intentionally does NOT apply
 * this filter — it exists precisely to surface the latest run regardless of
 * outcome, `status` included, so an operator can see a run just failed.
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

const LATEST_SUCCESSFUL_IMPORT_RUNS_SQL = `
  SELECT DISTINCT ON (source)
    source,
    status,
    source_updated_at AS "sourceUpdatedAt",
    started_at AS "startedAt",
    finished_at AS "finishedAt",
    rows_imported AS "rowsImported",
    error
  FROM import_runs
  WHERE status = 'success'
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

function mapRow(row: LatestImportRunRow): LatestImportRun {
  return {
    source: row.source,
    status: row.status,
    sourceUpdatedAt: row.sourceUpdatedAt ? row.sourceUpdatedAt.toISOString() : null,
    importedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
    rowsImported: row.rowsImported,
    error: row.error,
  };
}

/**
 * The latest (by `started_at`) `import_runs` row per distinct `source`,
 * regardless of status — used by `GET /v1/data-status`, which exists to
 * show an operator the outcome of the most recent run, `failed` included.
 */
export async function loadLatestImportRuns(pool: DbPool): Promise<LatestImportRun[]> {
  const result = (await pool.query(LATEST_IMPORT_RUNS_SQL)) as { rows: LatestImportRunRow[] };
  return result.rows.map(mapRow);
}

/**
 * The latest SUCCESSFUL `import_runs` row per distinct `source` — used by
 * `POST /v1/optimize`'s `dataVintages` field, which must describe the data
 * actually reflected on disk. A `failed` run's `finished_at` is set after
 * `runImport` rolls its own writes back, so including it here would report
 * a failed run's timestamps as if they described live data.
 */
export async function loadLatestSuccessfulImportRuns(pool: DbPool): Promise<LatestImportRun[]> {
  const result = (await pool.query(LATEST_SUCCESSFUL_IMPORT_RUNS_SQL)) as {
    rows: LatestImportRunRow[];
  };
  return result.rows.map(mapRow);
}

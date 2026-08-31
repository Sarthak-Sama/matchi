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

export async function loadLatestImportRuns(pool: DbPool): Promise<LatestImportRun[]> {
  const result = (await pool.query(LATEST_IMPORT_RUNS_SQL)) as { rows: LatestImportRunRow[] };
  return result.rows.map(mapRow);
}

export async function loadLatestSuccessfulImportRuns(pool: DbPool): Promise<LatestImportRun[]> {
  const result = (await pool.query(LATEST_SUCCESSFUL_IMPORT_RUNS_SQL)) as {
    rows: LatestImportRunRow[];
  };
  return result.rows.map(mapRow);
}

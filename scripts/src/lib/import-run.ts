/**
 * Shared `import_runs` bookkeeping harness used by every import script
 * (`import:mlit` in this task; `import:rent`, `import:osm`, `import:transit`
 * in Tasks 12-14).
 *
 * `runImport` records one `import_runs` row per invocation: `running` when
 * it starts, `success` (with `finished_at`, `rows_imported`,
 * `source_updated_at`) when `fn` resolves, `failed` (with `finished_at` and
 * `error`) when `fn` throws. `fn` itself runs inside exactly one
 * transaction via `withTransaction`, so a thrown error rolls back every
 * table the import touched.
 *
 * The bookkeeping writes (`INSERT ... status='running'` and the later
 * `UPDATE ... status='success'|'failed'`) deliberately do NOT happen on the
 * same client/transaction as `fn` — each goes through `pool.query`, which
 * checks out its own connection from the pool and releases it immediately.
 * If they shared `fn`'s transaction, a rollback on failure would erase the
 * `running` row along with the data, leaving no record that the run ever
 * happened or why it failed.
 */

import type { Pool, PoolClient } from "pg";

import { withTransaction } from "./db.js";

export interface ImportResult {
  readonly rowsImported: number;
  /** The upstream source's own "as of" date/vintage, when known. */
  readonly sourceUpdatedAt?: Date;
}

export interface RunImportOptions {
  readonly source: string;
  readonly pool: Pool;
}

/**
 * Runs `fn` (the actual import work, given a transactional client) under
 * `import_runs` bookkeeping. Rethrows whatever `fn` throws after recording
 * the failure.
 */
export async function runImport(
  options: RunImportOptions,
  fn: (client: PoolClient) => Promise<ImportResult>,
): Promise<ImportResult> {
  const { source, pool } = options;
  const runId = await insertRunningRow(pool, source);

  let result: ImportResult;
  try {
    result = await withTransaction(pool, fn);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await markFailed(pool, runId, message);
    throw err;
  }

  await markSuccess(pool, runId, result);
  return result;
}

async function insertRunningRow(pool: Pool, source: string): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO import_runs (source, status) VALUES ($1, 'running') RETURNING id`,
    [source],
  );
  const id = rows[0]?.id;
  if (id === undefined) {
    throw new Error("runImport: INSERT INTO import_runs did not return an id");
  }
  return id;
}

async function markSuccess(pool: Pool, runId: number, result: ImportResult): Promise<void> {
  await pool.query(
    `UPDATE import_runs
     SET status = 'success', finished_at = now(), rows_imported = $2, source_updated_at = $3
     WHERE id = $1`,
    [runId, result.rowsImported, result.sourceUpdatedAt ?? null],
  );
}

async function markFailed(pool: Pool, runId: number, message: string): Promise<void> {
  await pool.query(
    `UPDATE import_runs SET status = 'failed', finished_at = now(), error = $2 WHERE id = $1`,
    [runId, message],
  );
}

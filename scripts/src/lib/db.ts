/**
 * Shared PostgreSQL infrastructure for scripts: a `Pool` factory that reads
 * `DATABASE_URL`, and a `withTransaction` helper that wraps a unit of work
 * in BEGIN/COMMIT with ROLLBACK on error. Used by the migration runner and
 * (in later tasks) the seed and import scripts.
 */

import { Pool } from "pg";
import type { PoolClient } from "pg";

import { databaseSslFor } from "@tokyo/shared/server";

/**
 * Creates a `pg.Pool` connected to `DATABASE_URL`. Throws if the
 * environment variable is unset — callers decide how to surface that
 * (e.g. the migration runner prints a clear message and exits 1).
 */
export function createPool(): Pool {
  const connectionString = process.env["DATABASE_URL"];
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }
  // Verification is pinned here rather than left to `sslmode` — see
  // `databaseSslFor` for why the connection string is the wrong place to
  // express it.
  return new Pool({ connectionString, ssl: databaseSslFor(connectionString) });
}

/**
 * Runs `fn` inside a single transaction on a dedicated client checked out
 * from `pool`. Commits on success, rolls back and rethrows on error. The
 * client is always released back to the pool.
 */
export async function withTransaction<T>(
  pool: Pool,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

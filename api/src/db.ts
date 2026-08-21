/**
 * API-side PostgreSQL connection pool. Separate from `@tokyo/scripts`'s
 * `createPool` (`scripts/src/lib/db.ts`): the API has different needs —
 * bounded connection count, request-appropriate timeouts, and slow-query
 * logging — so it gets its own small pool factory instead of sharing one.
 */

import { Pool } from "pg";
import type { QueryResult, QueryResultRow } from "pg";

const SLOW_QUERY_THRESHOLD_MS = 500;
const POOL_MAX_CONNECTIONS = 10;
const IDLE_TIMEOUT_MS = 30_000;
const CONNECTION_TIMEOUT_MS = 5_000;
const STATEMENT_TIMEOUT_MS = 10_000;

/**
 * The minimal shape routes and tests depend on. A real `pg.Pool`
 * satisfies this structurally; tests can pass a plain object with a
 * `query` mock instead, with no database involved.
 */
export interface DbPool {
  query(text: string, params?: unknown[]): Promise<unknown>;
}

/** A logger capable of the single level the slow-query helper needs. */
export interface QueryLogger {
  warn(obj: Record<string, unknown>, msg?: string): void;
}

/** Creates a `pg.Pool` connected to `databaseUrl` with bounded size and timeouts. */
export function createPool(databaseUrl: string): Pool {
  return new Pool({
    connectionString: databaseUrl,
    max: POOL_MAX_CONNECTIONS,
    idleTimeoutMillis: IDLE_TIMEOUT_MS,
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
    statement_timeout: STATEMENT_TIMEOUT_MS,
    query_timeout: STATEMENT_TIMEOUT_MS,
  });
}

/**
 * Runs `text`/`params` against `pool`, logging at `warn` when the query
 * takes longer than `SLOW_QUERY_THRESHOLD_MS`. Accepts the minimal
 * `DbPool` shape (not the concrete `pg.Pool`) so route handlers can be
 * tested with an injected fake pool.
 */
export async function query<T extends QueryResultRow = QueryResultRow>(
  pool: DbPool,
  logger: QueryLogger,
  text: string,
  params?: unknown[],
): Promise<QueryResult<T>> {
  const start = Date.now();
  const result = (await pool.query(text, params)) as QueryResult<T>;
  const durationMs = Date.now() - start;
  if (durationMs > SLOW_QUERY_THRESHOLD_MS) {
    logger.warn({ durationMs, query: text }, "slow query");
  }
  return result;
}

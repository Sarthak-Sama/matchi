import { attachDatabasePool } from "@vercel/functions";
import { Pool } from "pg";
import type { QueryResult, QueryResultRow } from "pg";

import { databaseSslFor } from "@tokyo/shared/server";

const SLOW_QUERY_THRESHOLD_MS = 500;
const CONNECTION_TIMEOUT_MS = 5_000;
const STATEMENT_TIMEOUT_MS = 10_000;

export interface DbPool {
  query(text: string, params?: unknown[]): Promise<unknown>;
}

export interface QueryLogger {
  warn(obj: Record<string, unknown>, msg?: string): void;
}

export function createPool(
  databaseUrl: string,
  options: { maxConnections: number; idleTimeoutMs: number },
): Pool {
  const pool = new Pool({
    connectionString: databaseUrl,

    ssl: databaseSslFor(databaseUrl),
    max: options.maxConnections,
    idleTimeoutMillis: options.idleTimeoutMs,
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
    statement_timeout: STATEMENT_TIMEOUT_MS,
    query_timeout: STATEMENT_TIMEOUT_MS,
  });

  // On Vercel Fluid Compute, close idle connections before an instance is
  // suspended. Outside Vercel this only installs a harmless pool listener.
  attachDatabasePool(pool);
  return pool;
}

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

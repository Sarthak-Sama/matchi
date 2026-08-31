import { Pool } from "pg";
import type { PoolClient } from "pg";

import { databaseSslFor } from "@tokyo/shared/server";

export function createPool(): Pool {
  const connectionString = process.env["DATABASE_URL"];
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }

  return new Pool({ connectionString, ssl: databaseSslFor(connectionString) });
}

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

import { fileURLToPath } from "node:url";
import { createPool, withTransaction } from "./lib/db.js";
import { runMigrations } from "./migrate.js";

export function assertRealResetAllowed(argv: readonly string[], databaseUrl: string | undefined): void {
  if (!databaseUrl) throw new Error("DATABASE_URL is required for data:reset-real");
  if (/(production|prod)/i.test(databaseUrl)) throw new Error("data:reset-real refuses a production-named DATABASE_URL");
  if (!argv.includes("--confirm-real-reset")) throw new Error("data:reset-real is destructive; pass --confirm-real-reset after verifying DATABASE_URL");
}

export async function runDataResetReal(): Promise<void> {
  assertRealResetAllowed(process.argv.slice(2), process.env["DATABASE_URL"]);
  const pool = createPool();
  try {
    await withTransaction(pool, async (client) => {
      await client.query("DROP SCHEMA public CASCADE");
      await client.query("CREATE SCHEMA public");
    });
  }
  finally { await pool.end(); }
  await runMigrations({ dryRun: false });
  console.log("data:reset-real complete — schema reloaded from migrations. Run data:refresh; do not run db:seed.");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) runDataResetReal().catch((error: unknown) => { console.error(error); process.exit(1); });

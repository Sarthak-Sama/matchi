import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createPool, withTransaction } from "./lib/db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, "../../db/migrations");

async function ensureMigrationsTable(pool: ReturnType<typeof createPool>): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

export const DEFAULT_AGENT_SCHEMA = "agent";

// Migrations name the agent-facing schema with the psql variable syntax
// :"agent_schema" so the same file runs under `psql -v agent_schema=agent -f`
// and here. Tests point it at a scratch schema so they never touch the real one.
export function substituteMigrationVariables(sql: string, agentSchema: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(agentSchema)) {
    throw new Error(`migrate: agent schema "${agentSchema}" is not a plain lower-case identifier`);
  }
  return sql.replaceAll(':"agent_schema"', `"${agentSchema}"`);
}

async function listMigrationFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir);
  return entries.filter((name) => name.endsWith(".sql")).sort((a, b) => a.localeCompare(b));
}

async function listAppliedFilenames(pool: ReturnType<typeof createPool>): Promise<Set<string>> {
  const { rows } = await pool.query<{ filename: string }>("SELECT filename FROM schema_migrations");
  return new Set(rows.map((row) => row.filename));
}

export async function runMigrations(options: {
  dryRun: boolean;
  agentSchema?: string;
}): Promise<void> {
  const agentSchema = options.agentSchema ?? DEFAULT_AGENT_SCHEMA;
  const pool = createPool();
  try {
    await ensureMigrationsTable(pool);

    const files = await listMigrationFiles(MIGRATIONS_DIR);
    const applied = await listAppliedFilenames(pool);
    const pending = files.filter((file) => !applied.has(file));

    if (pending.length === 0) {
      console.log("up to date");
      return;
    }

    for (const file of pending) {
      if (options.dryRun) {
        console.log(`would apply ${file}`);
        continue;
      }

      const sql = substituteMigrationVariables(
        await readFile(path.join(MIGRATIONS_DIR, file), "utf8"),
        agentSchema,
      );
      await withTransaction(pool, async (client) => {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [file]);
      });
      console.log(`applied ${file}`);
    }
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  if (!process.env["DATABASE_URL"]) {
    console.error(
      "DATABASE_URL is not set. Set it to a PostgreSQL connection string, e.g.\n" +
        "  DATABASE_URL=postgresql://tokyo:tokyo@localhost:5432/tokyo pnpm db:migrate",
    );
    process.exit(1);
  }

  const dryRun = process.argv.includes("--dry-run");
  await runMigrations({ dryRun });
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}

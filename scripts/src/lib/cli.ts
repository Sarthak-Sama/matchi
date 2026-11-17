import { fileURLToPath } from "node:url";

import type { PoolClient } from "pg";

import { createPool } from "./db.js";
import type { ImportResult } from "./import-run.js";
import { runImport } from "./import-run.js";

export function parseFlagValue(argv: readonly string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

export interface ImportCliOptions<Args, Result extends ImportResult> {
  readonly commandName: string;

  readonly commandExample: string;
  readonly parseArgs: (argv: readonly string[]) => Args;

  readonly source: (args: Args) => string;
  readonly run: (client: PoolClient, args: Args) => Promise<Result>;
}

async function runImportCli<Args, Result extends ImportResult>(
  options: ImportCliOptions<Args, Result>,
): Promise<void> {
  if (!process.env["DATABASE_URL"]) {
    console.error(
      "DATABASE_URL is not set. Set it to a PostgreSQL connection string, e.g.\n" +
        `  DATABASE_URL=postgresql://tokyo:tokyo@localhost:5432/tokyo ${options.commandExample}`,
    );
    process.exit(1);
  }

  const args = options.parseArgs(process.argv.slice(2));
  const pool = createPool();
  try {
    const result = await runImport({ source: options.source(args), pool }, (client) =>
      options.run(client, args),
    );
    console.log(`${options.commandName} complete. rows_imported=${String(result.rowsImported)}`);
  } finally {
    await pool.end();
  }
}

export function runImportCliIfMain<Args, Result extends ImportResult>(
  moduleUrl: string,
  options: ImportCliOptions<Args, Result>,
): void {
  const isMain = process.argv[1] === fileURLToPath(moduleUrl);
  if (!isMain) return;
  runImportCli(options).catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}

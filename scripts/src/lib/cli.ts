/**
 * Shared CLI plumbing for `import:*` scripts: flag parsing and the entry
 * point wrapper that turns a `runXImport(client, args)` function into
 * `pnpm import:x` — checking `DATABASE_URL`, running under `import_runs`
 * bookkeeping (`runImport` in `./import-run.ts`), and printing the
 * completion line. Each script still owns its own flag names and
 * `ImportXArgs` shape; this only removes the boilerplate around them.
 */

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
  /** Full example invocation, printed after the DATABASE_URL= prefix when it's unset. */
  readonly commandExample: string;
  readonly parseArgs: (argv: readonly string[]) => Args;
  /** The `import_runs.source` value for this invocation — can depend on `args` (e.g. import:transit's GTFS vs. fallback mode). */
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

/**
 * Runs `options` as a CLI entry point only when this module was invoked
 * directly (`node foo.js`) rather than imported for its exports (as every
 * `import-*.test.ts` does).
 */
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

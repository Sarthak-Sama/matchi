import { fileURLToPath } from "node:url";

import type { Pool } from "pg";

import { createPool } from "./lib/db.js";
import { runAmenitiesStep } from "./derive/amenities.js";
import { runCatchmentsStep } from "./derive/catchments.js";
import { runGreenSpaceStep } from "./derive/green-space.js";
import { runNormalizationStep } from "./derive/normalization.js";
import { runQuietnessStep } from "./derive/quietness.js";
import { runRentStep } from "./derive/rent.js";
import { runZoningStep } from "./derive/zoning.js";
import { runLocalitiesStep } from "./derive/localities.js";
import type { StepResult, StepRunner } from "./derive/types.js";

const STEPS: readonly { readonly key: string; readonly run: StepRunner }[] = [
  { key: "catchments", run: runCatchmentsStep },
  { key: "amenities", run: runAmenitiesStep },
  { key: "zoning", run: runZoningStep },
  { key: "quietness", run: runQuietnessStep },
  { key: "rent", run: runRentStep },
  { key: "green-space", run: runGreenSpaceStep },
  { key: "normalization", run: runNormalizationStep },
  { key: "localities", run: runLocalitiesStep },
] as const;

const STEP_KEYS = STEPS.map((s) => s.key);

export interface RunDeriveOptions {
  readonly only?: string;
}

export async function runDerive(pool: Pool, options: RunDeriveOptions = {}): Promise<StepResult[]> {
  const { only } = options;

  let steps = STEPS;
  if (only !== undefined) {
    const step = STEPS.find((s) => s.key === only);
    if (!step) {
      throw new Error(`derive: unknown step "${only}". Valid steps: ${STEP_KEYS.join(", ")}`);
    }
    steps = [step];
  }

  const results: StepResult[] = [];
  for (const step of steps) {
    const result = await step.run(pool);
    results.push(result);
  }
  return results;
}

function printSummary(results: readonly StepResult[]): void {
  const totalMs = results.reduce((sum, r) => sum + r.durationMs, 0);
  const nameWidth = Math.max(4, ...results.map((r) => r.name.length));
  const rowsWidth = Math.max(11, ...results.map((r) => String(r.rowsWritten).length));

  console.log("derive complete:");
  console.log(`  ${"step".padEnd(nameWidth)}  ${"rows_written".padStart(rowsWidth)}  duration_ms`);
  for (const r of results) {
    console.log(
      `  ${r.name.padEnd(nameWidth)}  ${String(r.rowsWritten).padStart(rowsWidth)}  ${r.durationMs}`,
    );
  }
  console.log(`  total: ${totalMs}ms`);
}

function parseOnlyFlag(argv: readonly string[]): string | undefined {
  for (const arg of argv) {
    if (arg.startsWith("--only=")) {
      return arg.slice("--only=".length);
    }
  }
  return undefined;
}

async function main(): Promise<void> {
  if (!process.env["DATABASE_URL"]) {
    console.error(
      "DATABASE_URL is not set. Set it to a PostgreSQL connection string, e.g.\n" +
        "  DATABASE_URL=postgresql://tokyo:tokyo@localhost:5432/tokyo pnpm derive",
    );
    process.exit(1);
  }

  const only = parseOnlyFlag(process.argv.slice(2));
  const pool = createPool();
  try {
    const results = await runDerive(pool, { only });
    printSummary(results);
  } finally {
    await pool.end();
  }
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}

/**
 * Derive script — turns raw imported/seeded geodata into the precomputed
 * `neighborhood_metrics` rows Task 9's scoring engine and Task 10's API
 * read directly.
 *
 * Seven steps, each in its own transaction, each idempotent
 * (delete-and-rebuild for `station_areas`; deterministic UPDATE for
 * `neighborhood_metrics` columns otherwise) so re-running produces
 * byte-identical results:
 *
 *   1. catchments    — station_areas (800m buffers)
 *   2. amenities     — POI counts + amenity_supermarket_equiv
 *   3. flood         — flood_share_by_category + flood_exposure_score
 *   4. zoning        — residential_zoning_share + road_rail_exposure_share
 *   5. quietness     — quietness_raw
 *   6. rent          — rent_* / land_price_* via @tokyo/shared's rent.ts
 *   7. normalization — norm_* (0-100) + source_dates
 *
 * Steps 2-7 depend on step 1 having run at least once (a neighborhood_metrics
 * row must exist to UPDATE); quietness depends on amenities + zoning;
 * normalization depends on amenities + flood + zoning + quietness + rent.
 * Each step asserts its own prerequisites and fails with a clear message
 * naming the step to run first, rather than silently writing nulls.
 *
 * Usage:
 *   DATABASE_URL=postgresql://... pnpm derive
 *   DATABASE_URL=postgresql://... pnpm derive --only=amenities
 */

import { fileURLToPath } from "node:url";

import type { Pool } from "pg";

import { createPool } from "./lib/db.js";
import { runAmenitiesStep } from "./derive/amenities.js";
import { runCatchmentsStep } from "./derive/catchments.js";
import { runFloodStep } from "./derive/flood.js";
import { runNormalizationStep } from "./derive/normalization.js";
import { runQuietnessStep } from "./derive/quietness.js";
import { runRentStep } from "./derive/rent.js";
import { runZoningStep } from "./derive/zoning.js";
import type { StepResult, StepRunner } from "./derive/types.js";

const STEPS: readonly { readonly key: string; readonly run: StepRunner }[] = [
  { key: "catchments", run: runCatchmentsStep },
  { key: "amenities", run: runAmenitiesStep },
  { key: "flood", run: runFloodStep },
  { key: "zoning", run: runZoningStep },
  { key: "quietness", run: runQuietnessStep },
  { key: "rent", run: runRentStep },
  { key: "normalization", run: runNormalizationStep },
] as const;

const STEP_KEYS = STEPS.map((s) => s.key);

export interface RunDeriveOptions {
  /** Run only this step (must be one of STEP_KEYS). Runs the full pipeline in order when omitted. */
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

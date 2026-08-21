/**
 * Shared types for `pnpm derive` step modules.
 */

import type { Pool } from "pg";

/** One row of the summary table `derive.ts` prints after running. */
export interface StepResult {
  readonly name: string;
  readonly rowsWritten: number;
  readonly durationMs: number;
}

/** A step module's entry point: runs its own transaction, returns a summary row. */
export type StepRunner = (pool: Pool) => Promise<StepResult>;

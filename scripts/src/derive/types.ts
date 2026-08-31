import type { Pool } from "pg";

export interface StepResult {
  readonly name: string;
  readonly rowsWritten: number;
  readonly durationMs: number;
}

export type StepRunner = (pool: Pool) => Promise<StepResult>;

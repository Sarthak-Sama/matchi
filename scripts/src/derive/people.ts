import type { Pool } from "pg";

import type { StepResult } from "./types.js";

export async function runPeopleStep(pool: Pool): Promise<StepResult> {
  const start = Date.now();
  const { rowCount } = await pool.query(
    `UPDATE locality_metrics lm
     SET population_density_per_km2 = l.population / NULLIF(l.area_sqm / 1e6, 0),
         persons_per_household = l.population::double precision / NULLIF(l.households, 0)
     FROM localities l
     WHERE l.locality_id = lm.locality_id AND l.population IS NOT NULL`,
  );
  return { name: "people", rowsWritten: rowCount ?? 0, durationMs: Date.now() - start };
}

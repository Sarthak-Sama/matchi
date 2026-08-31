import type { Pool } from "pg";

import { CATCHMENT_RADIUS_M } from "@tokyo/shared";

import { withTransaction } from "../lib/db.js";
import type { StepResult } from "./types.js";

export async function runCatchmentsStep(pool: Pool): Promise<StepResult> {
  const start = Date.now();

  const rowsWritten = await withTransaction(pool, async (client) => {
    await client.query("DELETE FROM station_areas");

    const { rowCount } = await client.query(
      `
      WITH buffered AS (
        SELECT
          station_group_id,
          ST_Buffer(point::geography, $1)::geometry AS geom
        FROM station_groups
      )
      INSERT INTO station_areas (station_group_id, radius_m, geom, area_sqm)
      SELECT
        station_group_id,
        $1,
        geom,
        ST_Area(geom::geography)
      FROM buffered
      `,
      [CATCHMENT_RADIUS_M],
    );

    await client.query(`
      INSERT INTO neighborhood_metrics (station_group_id, ward_code)
      SELECT station_group_id, ward_code FROM station_groups
      ON CONFLICT (station_group_id) DO UPDATE SET ward_code = EXCLUDED.ward_code
    `);

    return rowCount ?? 0;
  });

  return { name: "catchments", rowsWritten, durationMs: Date.now() - start };
}

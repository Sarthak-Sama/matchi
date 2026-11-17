import type { Pool } from "pg";

import { withTransaction } from "../lib/db.js";
import type { StepResult } from "./types.js";

// Stations further than this many decay constants away contribute under
// exp(-6) = 0.25% of a nearby station's weight, so they are skipped.
const CUTOFF_DECAYS = 6;

export async function runReachStep(pool: Pool): Promise<StepResult> {
  const start = Date.now();
  const rowsWritten = await withTransaction(pool, async (client) => {
    const { rows } = await client.query<{ value: number }>(
      "SELECT value FROM model_params WHERE key = 'reach_decay_minutes'",
    );
    const decay = rows[0]?.value;
    if (decay === undefined || !(decay > 0)) {
      throw new Error("derive/reach: model_params.reach_decay_minutes is missing or not positive");
    }
    const { rows: matrix } = await client.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM station_travel_times WHERE period = 'offpeak'",
    );
    if ((matrix[0]?.n ?? 0) === 0) {
      throw new Error("derive/reach: station_travel_times is empty. Run `pnpm derive --only=access` first.");
    }

    const { rowCount } = await client.query(
      `WITH sample_station AS (
         SELECT lss.locality_id, lss.sample_number, stt.to_station_group_id AS station_group_id,
           min(lss.walk_minutes + stt.minutes) AS minutes
         FROM locality_sample_stations lss
         JOIN station_travel_times stt
           ON stt.from_station_group_id = lss.station_group_id
          AND stt.period = 'offpeak'
          AND stt.minutes <= $1::double precision * $2::double precision
         GROUP BY 1, 2, 3
       ), locality_station AS (
         SELECT locality_id, station_group_id,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY minutes) AS minutes
         FROM sample_station GROUP BY 1, 2
       ), weighted AS (
         SELECT ls.locality_id,
           sum(exp(-ls.minutes / $1::double precision) * (nm.restaurant_count + nm.cafe_count)) AS reach_restaurant,
           sum(exp(-ls.minutes / $1::double precision) * nm.cuisine_variety_count) AS reach_cuisine_variety,
           sum(exp(-ls.minutes / $1::double precision) * nm.late_night_count) AS reach_late_night,
           sum(exp(-ls.minutes / $1::double precision) * nm.green_space_share) AS reach_green
         FROM locality_station ls
         JOIN neighborhood_metrics nm ON nm.station_group_id = ls.station_group_id
         GROUP BY ls.locality_id
       )
       UPDATE locality_metrics lm
       SET reach_restaurant = w.reach_restaurant,
           reach_cuisine_variety = w.reach_cuisine_variety,
           reach_late_night = w.reach_late_night,
           reach_green = w.reach_green
       FROM weighted w WHERE w.locality_id = lm.locality_id`,
      [decay, CUTOFF_DECAYS],
    );
    return rowCount ?? 0;
  });
  return { name: "reach", rowsWritten, durationMs: Date.now() - start };
}

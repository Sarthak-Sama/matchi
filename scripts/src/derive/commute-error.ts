import type { Pool } from "pg";

import { PEAK_WINDOW } from "@tokyo/shared";

import { withTransaction } from "../lib/db.js";
import type { StepResult } from "./types.js";

// Compares hand-collected reference journeys with station_travel_times and
// summarises the error per path confidence. Station names match every
// station group with that name_ja and take the fastest pair. The matrix
// includes the first wait at the origin, which journey planners usually do
// not; mean_error_minutes shows that bias rather than hiding it.
export async function runCommuteErrorStep(pool: Pool): Promise<StepResult> {
  const start = Date.now();
  const rowsWritten = await withTransaction(pool, async (client) => {
    await client.query(
      `UPDATE commute_reference SET model_minutes = NULL, model_confidence = NULL, compared_at = now()`,
    );
    const { rowCount } = await client.query(
      `WITH ref AS (
         SELECT id, origin_name_ja, destination_name_ja,
           CASE WHEN (split_part(arrival_time, ':', 1)::int * 60 + split_part(arrival_time, ':', 2)::int)
                     >= $1 AND
                     (split_part(arrival_time, ':', 1)::int * 60 + split_part(arrival_time, ':', 2)::int) < $2
             THEN 'peak' ELSE 'offpeak' END AS period
         FROM commute_reference
       ), best AS (
         SELECT DISTINCT ON (ref.id) ref.id, stt.minutes, stt.confidence
         FROM ref
         JOIN station_groups o ON o.name_ja = ref.origin_name_ja
         JOIN station_groups d ON d.name_ja = ref.destination_name_ja
         JOIN station_travel_times stt ON stt.from_station_group_id = o.station_group_id
           AND stt.to_station_group_id = d.station_group_id AND stt.period = ref.period
         ORDER BY ref.id, stt.minutes
       )
       UPDATE commute_reference cr
       SET model_minutes = best.minutes, model_confidence = best.confidence
       FROM best WHERE best.id = cr.id`,
      [PEAK_WINDOW.startMinutes, PEAK_WINDOW.endMinutes],
    );

    await client.query("DELETE FROM commute_error_model");
    await client.query(
      `INSERT INTO commute_error_model
         (confidence, n, mean_error_minutes, mae_minutes, p90_abs_error_minutes)
       SELECT model_confidence, count(*),
         avg(model_minutes - reference_minutes),
         avg(abs(model_minutes - reference_minutes)),
         percentile_cont(0.9) WITHIN GROUP (ORDER BY abs(model_minutes - reference_minutes))
       FROM commute_reference
       WHERE model_minutes IS NOT NULL
       GROUP BY model_confidence`,
    );
    return rowCount ?? 0;
  });
  return { name: "commute-error", rowsWritten, durationMs: Date.now() - start };
}

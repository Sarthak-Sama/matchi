import type { Pool, PoolClient } from "pg";

import { withTransaction } from "../lib/db.js";
import { fitElasticity } from "./fit.js";
import type { StepResult } from "./types.js";

export const LAND_VALUE_NEAREST_POINTS = 5;
// Floor on the inverse-distance weight so a point at the centroid does not
// take all the weight.
export const LAND_VALUE_MIN_DISTANCE_M = 50;

export async function runLandValueStep(pool: Pool): Promise<StepResult> {
  const start = Date.now();
  const rowsWritten = await withTransaction(pool, async (client) => {
    const { rowCount } = await client.query(
      `UPDATE locality_metrics lm
       SET land_value_yen_per_sqm = v.value,
           land_value_nearest_m = v.nearest_m
       FROM (
         SELECT l.locality_id,
           sum(k.price / greatest(k.dist_m, $2)) / sum(1 / greatest(k.dist_m, $2)) AS value,
           min(k.dist_m) AS nearest_m
         FROM localities l
         CROSS JOIN LATERAL (
           SELECT lp.price_yen_per_sqm AS price,
             ST_Distance(lp.point::geography, l.centroid::geography) AS dist_m
           FROM land_prices lp
           WHERE lp.use_category = 'residential'
           ORDER BY lp.point <-> l.centroid
           LIMIT $1
         ) k
         GROUP BY l.locality_id
       ) v
       WHERE v.locality_id = lm.locality_id`,
      [LAND_VALUE_NEAREST_POINTS, LAND_VALUE_MIN_DISTANCE_M],
    );
    return rowCount ?? 0;
  });
  return { name: "land-value", rowsWritten, durationMs: Date.now() - start };
}

interface WardPoint {
  readonly ward_code: string;
  readonly rent: number;
  readonly land: number;
}

async function upsertParam(
  client: PoolClient,
  key: string,
  value: number,
  unit: string,
  sampleSize: number,
  notes: string,
): Promise<void> {
  await client.query(
    `INSERT INTO model_params (key, value, unit, fitted_at, sample_size, notes)
     VALUES ($1, $2, $3, now(), $4, $5)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, unit = EXCLUDED.unit,
       fitted_at = EXCLUDED.fitted_at, sample_size = EXCLUDED.sample_size, notes = EXCLUDED.notes`,
    [key, value, unit, sampleSize, notes],
  );
}

async function readParam(client: PoolClient, key: string): Promise<number> {
  const { rows } = await client.query<{ value: number }>(
    "SELECT value FROM model_params WHERE key = $1",
    [key],
  );
  const value = rows[0]?.value;
  if (value === undefined) throw new Error(`derive/rent-local: model_params has no "${key}" row`);
  return value;
}

// Fits ln(ward rent per m2) on ln(ward median locality land value) across the
// wards, stores the elasticity and its 95% interval in model_params, and
// applies it within each ward. The clamp stays in model_params because how
// far rent may vary inside a ward is a product decision.
export async function runRentLocalStep(pool: Pool): Promise<StepResult> {
  const start = Date.now();
  const rowsWritten = await withTransaction(pool, async (client) => {
    const { rows: missing } = await client.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM locality_metrics WHERE land_value_yen_per_sqm IS NULL",
    );
    if ((missing[0]?.n ?? 0) > 0) {
      throw new Error(
        "derive/rent-local: some localities have no land_value_yen_per_sqm. Run `pnpm derive --only=land-value` first.",
      );
    }

    const { rows } = await client.query<WardPoint>(
      `SELECT l.ward_code,
         max(lm.rent_per_sqm_yen) AS rent,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY lm.land_value_yen_per_sqm) AS land
       FROM locality_metrics lm JOIN localities l USING (locality_id)
       WHERE lm.rent_per_sqm_yen IS NOT NULL
       GROUP BY l.ward_code
       ORDER BY l.ward_code`,
    );
    if (rows.length < 3) {
      throw new Error(
        `derive/rent-local: need rent and land value for at least 3 wards, found ${rows.length}`,
      );
    }
    const fit = fitElasticity(
      rows.map((r) => r.land),
      rows.map((r) => r.rent),
    );
    const [ciLow, ciHigh] = fit.slopeCi95;
    const range = `95% CI ${ciLow.toFixed(3)} to ${ciHigh.toFixed(3)}, R2 ${fit.r2.toFixed(3)}`;
    await upsertParam(
      client,
      "rent_land_elasticity",
      fit.slope,
      "elasticity",
      fit.n,
      `OLS of ln(ward rent per m2) on ln(ward median locality land value) across wards; ${range}. Cross-ward slope applied within wards, so it also carries centrality.`,
    );
    await upsertParam(
      client,
      "rent_land_elasticity_ci_low",
      ciLow,
      "elasticity",
      fit.n,
      "Lower 95% bound of rent_land_elasticity.",
    );
    await upsertParam(
      client,
      "rent_land_elasticity_ci_high",
      ciHigh,
      "elasticity",
      fit.n,
      "Upper 95% bound of rent_land_elasticity.",
    );
    await upsertParam(
      client,
      "rent_land_fit_r2",
      fit.r2,
      "ratio",
      fit.n,
      "Share of cross-ward variance in ln(rent per m2) explained by ln(land value).",
    );

    const min = await readParam(client, "rent_local_multiplier_min");
    const max = await readParam(client, "rent_local_multiplier_max");
    const { rowCount } = await client.query(
      `WITH ward_land AS (
         SELECT l.ward_code,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY lm.land_value_yen_per_sqm) AS median
         FROM locality_metrics lm JOIN localities l USING (locality_id)
         GROUP BY l.ward_code
       ), m AS (
         SELECT lm.locality_id,
           LEAST($3::double precision, GREATEST($2::double precision,
             power(lm.land_value_yen_per_sqm / wl.median, $1::double precision))) AS multiplier
         FROM locality_metrics lm
         JOIN localities l USING (locality_id)
         JOIN ward_land wl ON wl.ward_code = l.ward_code
         WHERE wl.median > 0 AND lm.land_value_yen_per_sqm > 0
       )
       UPDATE locality_metrics lm
       SET rent_local_multiplier = m.multiplier,
           rent_per_sqm_local_yen = lm.rent_per_sqm_yen * m.multiplier
       FROM m WHERE m.locality_id = lm.locality_id`,
      [fit.slope, min, max],
    );
    return rowCount ?? 0;
  });
  return { name: "rent-local", rowsWritten, durationMs: Date.now() - start };
}

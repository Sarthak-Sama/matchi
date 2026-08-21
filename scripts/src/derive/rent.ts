/**
 * Step 6 — rent.
 *
 * For each station group: median residential land price inside its 800m
 * catchment (`land_prices` where `use_category = 'residential'`), median
 * residential land price for its whole ward, then
 * `computeLandPriceMultiplier`, `pickRentStat`, and `estimateRent` from
 * `@tokyo/shared` — the exact same functions Task 6 wrote and tested. The
 * rent formula itself is NOT reimplemented here or in SQL.
 *
 * Layout choice: `neighborhood_metrics` stores one rent estimate per
 * station, not one per layout (per-layout estimates are recomputed at
 * request time by the Task 10 API, which reuses `rent_per_sqm_yen`,
 * `land_price_multiplier`, etc. stored here). "1LDK" is used as the
 * precomputed baseline layout because it matches the API's own default
 * layout (see task-10-brief.md).
 *
 * `landPriceUsedFallback` is threaded straight from
 * `computeLandPriceMultiplier`'s own return value into `estimateRent` — it
 * is NOT re-derived from `pointCount < MIN_LAND_PRICE_POINTS`, because
 * `computeLandPriceMultiplier` also reports `usedFallback: true` when a
 * median is missing or non-positive even with enough points. Re-deriving
 * from the count alone was a real bug caught in Task 6.
 */

import type { Pool } from "pg";

import {
  CATCHMENT_RADIUS_M,
  computeLandPriceMultiplier,
  estimateRent,
  pickRentStat,
} from "@tokyo/shared";
import type { LayoutId, RentStatRow } from "@tokyo/shared";

import { withTransaction } from "../lib/db.js";
import { assertCatchmentsDerived } from "./prerequisites.js";
import type { StepResult } from "./types.js";

/** The precomputed baseline layout stored on `neighborhood_metrics` — see module doc comment. */
const BASELINE_LAYOUT: LayoutId = "1LDK";

interface CatchmentLandPriceRow {
  readonly station_group_id: string;
  readonly ward_code: string | null;
  readonly catchment_median: string | null;
  readonly point_count: string;
}

interface WardLandPriceRow {
  readonly ward_code: string;
  readonly ward_median: string | null;
}

interface RentStatDbRow extends RentStatRow {
  readonly ward_code: string;
}

export async function runRentStep(pool: Pool): Promise<StepResult> {
  const start = Date.now();
  await assertCatchmentsDerived(pool);

  const rowsWritten = await withTransaction(pool, async (client) => {
    // A single `pg` client can only run one query at a time, so these are
    // awaited sequentially rather than via Promise.all.
    const catchmentRes = await client.query<CatchmentLandPriceRow>(
      `
      SELECT
        sg.station_group_id,
        sg.ward_code,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY lp.price_yen_per_sqm)::text AS catchment_median,
        COUNT(lp.id)::text AS point_count
      FROM station_groups sg
      LEFT JOIN land_prices lp
        ON lp.use_category = 'residential'
        AND ST_DWithin(lp.point::geography, sg.point::geography, $1)
      GROUP BY sg.station_group_id, sg.ward_code
      `,
      [CATCHMENT_RADIUS_M],
    );
    const wardRes = await client.query<WardLandPriceRow>(`
      SELECT
        ward_code,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY price_yen_per_sqm)::text AS ward_median
      FROM land_prices
      WHERE use_category = 'residential'
      GROUP BY ward_code
    `);
    const rentStatsRes = await client.query<RentStatDbRow>(`
      SELECT ward_code, period, source, rent_per_sqm_yen, management_fee_yen
      FROM rent_stats
    `);

    const wardMedianByWard = new Map<string, number | null>(
      wardRes.rows.map((r) => [r.ward_code, r.ward_median === null ? null : Number(r.ward_median)]),
    );

    const rentStatsByWard = new Map<string, RentStatDbRow[]>();
    for (const row of rentStatsRes.rows) {
      const existing = rentStatsByWard.get(row.ward_code);
      if (existing) {
        existing.push(row);
      } else {
        rentStatsByWard.set(row.ward_code, [row]);
      }
    }

    const currentYear = new Date().getFullYear();
    let written = 0;

    for (const row of catchmentRes.rows) {
      if (!row.ward_code) {
        console.warn(
          `derive/rent: skipping ${row.station_group_id} — no ward_code, cannot look up rent stats`,
        );
        continue;
      }

      const wardStats = rentStatsByWard.get(row.ward_code) ?? [];
      if (wardStats.length === 0) {
        console.warn(
          `derive/rent: skipping ${row.station_group_id} — no rent_stats rows for ward ${row.ward_code}`,
        );
        continue;
      }

      const { stat, baseConfidence } = pickRentStat(wardStats, { currentYear });

      const catchmentMedianLandPrice =
        row.catchment_median === null ? null : Number(row.catchment_median);
      const wardMedianLandPrice = wardMedianByWard.get(row.ward_code) ?? null;
      const pointCount = Number(row.point_count);

      const { multiplier, usedFallback } = computeLandPriceMultiplier({
        catchmentMedianLandPrice,
        wardMedianLandPrice,
        pointCount,
      });

      const rentResult = estimateRent({
        layout: BASELINE_LAYOUT,
        wardRentPerSqmYen: stat.rent_per_sqm_yen,
        managementFeeYen: stat.management_fee_yen,
        landPriceMultiplier: multiplier,
        landPricePointCount: pointCount,
        landPriceUsedFallback: usedFallback,
        source: stat.source,
        sourcePeriod: stat.period,
        baseConfidence,
        currentYear,
      });

      await client.query(
        `
        UPDATE neighborhood_metrics
        SET
          rent_low_yen = $2,
          rent_median_yen = $3,
          rent_high_yen = $4,
          rent_confidence = $5,
          rent_source = $6,
          rent_source_period = $7,
          rent_per_sqm_yen = $8,
          management_fee_yen = $9,
          land_price_multiplier = $10,
          land_price_point_count = $11
        WHERE station_group_id = $1
        `,
        [
          row.station_group_id,
          rentResult.lowYen,
          rentResult.medianYen,
          rentResult.highYen,
          rentResult.confidence,
          rentResult.source,
          rentResult.sourcePeriod,
          rentResult.wardRentPerSqmYen,
          rentResult.managementFeeYen,
          rentResult.landPriceMultiplier,
          rentResult.landPricePointCount,
        ],
      );
      written += 1;
    }

    return written;
  });

  return { name: "rent", rowsWritten, durationMs: Date.now() - start };
}

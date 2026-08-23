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
 *
 * That same flag is also persisted verbatim to
 * `neighborhood_metrics.land_price_used_fallback` (added in
 * `0003_land_price_used_fallback.sql`) — Task 10 needs it to recompute a
 * per-layout rent estimate honestly, and re-deriving it from
 * `land_price_point_count` alone at that call site would reintroduce the
 * exact same bug.
 */

import type { Pool } from "pg";

import {
  CATCHMENT_RADIUS_M,
  computeLandPriceMultiplier,
  estimateRent,
  LAND_PRICE_FALLBACK_WARN_SHARE,
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

/**
 * `runRentStep`'s result, widened beyond the shared `StepResult` summary
 * row with the facts needed to report skipped stations honestly (see the
 * module doc comment's note on `landPriceUsedFallback`/skip reporting).
 * Still assignable wherever `StepResult` is expected.
 */
export interface RentStepResult extends StepResult {
  /** Stations skipped for lack of a ward assignment or ward rent_stats data — see the loop below. */
  readonly skippedStationGroupIds: readonly string[];
  /** Of the stations actually written, how many hit the land-price fallback (multiplier forced to 1.0). */
  readonly usedFallbackCount: number;
}

export async function runRentStep(pool: Pool): Promise<RentStepResult> {
  const start = Date.now();
  await assertCatchmentsDerived(pool);

  const { written, skippedStationGroupIds, usedFallbackCount } = await withTransaction(pool, async (client) => {
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
    let usedFallbackCount = 0;
    const skippedStationGroupIds: string[] = [];

    for (const row of catchmentRes.rows) {
      if (!row.ward_code) {
        console.warn(
          `derive/rent: skipping ${row.station_group_id} — no ward_code, cannot look up rent stats`,
        );
        skippedStationGroupIds.push(row.station_group_id);
        continue;
      }

      const wardStats = rentStatsByWard.get(row.ward_code) ?? [];
      if (wardStats.length === 0) {
        console.warn(
          `derive/rent: skipping ${row.station_group_id} — no rent_stats rows for ward ${row.ward_code}`,
        );
        skippedStationGroupIds.push(row.station_group_id);
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
          land_price_point_count = $11,
          land_price_used_fallback = $12
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
          // `estimateRent` doesn't echo `landPriceUsedFallback` back on its
          // result shape (it only feeds the confidence step-down), so this
          // reads straight from computeLandPriceMultiplier's own output —
          // not re-derived from pointCount, for the same reason described
          // in the module doc comment above.
          usedFallback,
        ],
      );
      written += 1;
      if (usedFallback) usedFallbackCount += 1;
    }

    return { written, skippedStationGroupIds, usedFallbackCount };
  });

  if (skippedStationGroupIds.length > 0) {
    console.warn(
      `derive/rent: skipped ${skippedStationGroupIds.length} of ${skippedStationGroupIds.length + written} ` +
        `station(s) for lack of rent data (no ward assignment, or no rent_stats row for their ward) — ` +
        `these stations will have null rent-derived fields and be excluded from /v1/optimize candidates ` +
        `(see api/src/routes/optimize.ts's buildCandidate). To fix: add rent_stats coverage for the ` +
        `affected ward(s), or accept these stations as unrankable on rent.`,
    );
  }

  if (written > 0 && usedFallbackCount / written >= LAND_PRICE_FALLBACK_WARN_SHARE) {
    console.warn(
      `derive/rent: ${usedFallbackCount} of ${written} station(s) written (${Math.round((usedFallbackCount / written) * 100)}%) hit the land-price fallback ` +
        `(multiplier forced to 1.0) — at or above the ${Math.round(LAND_PRICE_FALLBACK_WARN_SHARE * 100)}% warn threshold. ` +
        `This is the signature of a systemic land-price data problem (e.g. \`import:mlit\` classified zero ` +
        `\`land_prices\` rows as 'residential' — check that run's "residential land_prices rows" count), not ` +
        `a handful of individually land-price-poor catchments. The station land-price term is likely not ` +
        `discriminating within wards right now.`,
    );
  }

  return { name: "rent", rowsWritten: written, durationMs: Date.now() - start, skippedStationGroupIds, usedFallbackCount };
}

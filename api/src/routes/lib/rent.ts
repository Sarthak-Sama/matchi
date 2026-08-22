/**
 * Recomputes a per-request `RentEstimateResult` for a user-chosen `layout`
 * from a `neighborhood_metrics` row's STORED rent inputs.
 *
 * `neighborhood_metrics.rent_low_yen` / `rent_median_yen` / `rent_high_yen`
 * are a "1LDK" BASELINE ONLY (see `scripts/src/derive/rent.ts`'s module doc
 * comment) — `/v1/optimize`'s hard filter and `/v1/neighborhoods/:id`'s
 * displayed estimate both need the median for the layout the USER actually
 * picked, so both routes call `recomputeRentForLayout` instead of reading
 * those three baseline columns directly.
 */

import type { Confidence, LayoutId, RentEstimateResult } from "@tokyo/shared";
import { estimateRent, rentStatBaseConfidence } from "@tokyo/shared";

/**
 * The subset of a `neighborhood_metrics` row this module needs. Field names
 * are camelCase versions of the actual columns (see
 * `db/migrations/0001_init.sql` and `0003_land_price_used_fallback.sql`).
 * Every field is required (non-null) here deliberately — a row missing any
 * of these (e.g. a station whose ward has no `rent_stats` row at all, so
 * `derive`'s rent step warn-and-skipped it) cannot be turned into a rent
 * estimate at all. Callers are responsible for detecting that case from the
 * raw nullable DB row BEFORE constructing a `StoredRentInputs` — see
 * `routes/optimize.ts` and `routes/neighborhoods.ts` for how each route
 * chooses to handle it.
 */
export interface StoredRentInputs {
  readonly rentPerSqmYen: number;
  readonly managementFeeYen: number;
  readonly landPriceMultiplier: number;
  readonly landPricePointCount: number;
  /**
   * `neighborhood_metrics.land_price_used_fallback`, threaded through
   * VERBATIM — never re-derived from `landPricePointCount <
   * MIN_LAND_PRICE_POINTS` at this call site. That column exists
   * specifically because `computeLandPriceMultiplier` also falls back to
   * `1.0` when a median is missing/non-positive even with enough points,
   * which point count alone can't distinguish — re-deriving the flag from
   * the count is a bug this codebase has already found and fixed twice
   * (see `db/migrations/0003_land_price_used_fallback.sql`'s own doc
   * comment).
   */
  readonly landPriceUsedFallback: boolean;
  readonly rentSource: string;
  readonly rentSourcePeriod: string;
}

/**
 * Recomputes rent for `layout` from `inputs`, reusing `estimateRent`
 * (`@tokyo/shared`, the exact function Task 6 wrote and Task 7's `derive`
 * rent step calls) — the rent formula itself is never reimplemented here.
 *
 * `baseConfidence` is reconstructed FRESH via `rentStatBaseConfidence` from
 * `inputs.rentSource` / `inputs.rentSourcePeriod` and `currentYear`, NOT
 * read back from the row's own `rent_confidence` column (which is already
 * the FINAL, fallback/staleness-ADJUSTED confidence `estimateRent` produced
 * at derive time for the 1LDK baseline). Passing that already-adjusted
 * value back in as `baseConfidence` here would double-apply the same
 * downgrade on every recompute — `estimateRent` re-checks
 * `landPriceUsedFallback` and source-period staleness independently every
 * time it's called, so an original `high` that was downgraded once to
 * `medium` at derive time would incorrectly become `low` the very next time
 * this function recomputes the SAME station's SAME data. Reconstructing
 * `baseConfidence` from the source/period pair instead avoids that, and
 * additionally lets confidence legitimately degrade further if enough real
 * time has passed since the underlying `rent_stats` row was current —
 * see `rentStatBaseConfidence`'s own doc comment in
 * `shared/src/domain/rent.ts`.
 */
export function recomputeRentForLayout(
  inputs: StoredRentInputs,
  layout: LayoutId,
  currentYear: number,
): RentEstimateResult {
  const baseConfidence: Confidence = rentStatBaseConfidence(
    inputs.rentSource,
    inputs.rentSourcePeriod,
    currentYear,
  );

  return estimateRent({
    layout,
    wardRentPerSqmYen: inputs.rentPerSqmYen,
    managementFeeYen: inputs.managementFeeYen,
    landPriceMultiplier: inputs.landPriceMultiplier,
    landPricePointCount: inputs.landPricePointCount,
    landPriceUsedFallback: inputs.landPriceUsedFallback,
    source: inputs.rentSource,
    sourcePeriod: inputs.rentSourcePeriod,
    baseConfidence,
    currentYear,
  });
}

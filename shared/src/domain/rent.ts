/**
 * Rent estimator — pure functions, no database access, no dependency
 * beyond `@tokyo/shared`'s own config module (`config/scoring.ts`).
 *
 * Placement note: the original spec placed this under `api/`. It lives here
 * instead because Task 7's `derive` script (package `@tokyo/scripts`) must
 * call the exact same functions, and having `@tokyo/scripts` depend on
 * `@tokyo/api` would invert the dependency graph. Both `api` and `scripts`
 * import these functions from `@tokyo/shared`. Do not duplicate the formula
 * anywhere else.
 *
 * Formula (spec, verbatim):
 *   ward rent/m2 x assumed layout size x station land-price multiplier
 *     + ward management fee
 */

import type { Confidence } from "../config/scoring.js";
import {
  HIGH_ESTIMATE_FACTOR,
  LAND_PRICE_MULTIPLIER_EXPONENT,
  LAND_PRICE_MULTIPLIER_MAX,
  LAND_PRICE_MULTIPLIER_MIN,
  LAYOUT_IDS,
  LAYOUTS,
  LOW_ESTIMATE_FACTOR,
  MIN_LAND_PRICE_POINTS,
  RENT_LABEL,
  RENT_STAT_OLD_MIN_AGE_YEARS,
  RENT_STAT_RECENT_MAX_AGE_YEARS,
  lowerConfidence,
} from "../config/scoring.js";

/** One of the layout ids defined in `LAYOUTS` (mirrors `Layout` in contracts/common.ts). */
export type LayoutId = (typeof LAYOUT_IDS)[number];

// ---------------------------------------------------------------------------
// computeLandPriceMultiplier
// ---------------------------------------------------------------------------

export interface LandPriceMultiplierInput {
  /** Median land price (yen/m²) across points inside the station's catchment. */
  readonly catchmentMedianLandPrice: number | null;
  /** Median land price (yen/m²) across the whole ward. */
  readonly wardMedianLandPrice: number | null;
  /** Number of land-price data points backing `catchmentMedianLandPrice`. */
  readonly pointCount: number;
}

export interface LandPriceMultiplierResult {
  readonly multiplier: number;
  readonly usedFallback: boolean;
}

/**
 * `clamp((catchment / ward) ** LAND_PRICE_MULTIPLIER_EXPONENT,
 *   LAND_PRICE_MULTIPLIER_MIN, LAND_PRICE_MULTIPLIER_MAX)`.
 *
 * Falls back to an exact `1.0` multiplier (and reports `usedFallback: true`)
 * when there are too few land-price points to trust, or either median is
 * missing or non-positive.
 */
export function computeLandPriceMultiplier(
  input: LandPriceMultiplierInput,
): LandPriceMultiplierResult {
  const { catchmentMedianLandPrice, wardMedianLandPrice, pointCount } = input;

  const hasUsableMedians =
    catchmentMedianLandPrice != null &&
    wardMedianLandPrice != null &&
    catchmentMedianLandPrice > 0 &&
    wardMedianLandPrice > 0;

  if (pointCount < MIN_LAND_PRICE_POINTS || !hasUsableMedians) {
    return { multiplier: 1.0, usedFallback: true };
  }

  const ratio = catchmentMedianLandPrice / wardMedianLandPrice;
  const raw = ratio ** LAND_PRICE_MULTIPLIER_EXPONENT;
  const multiplier = Math.min(LAND_PRICE_MULTIPLIER_MAX, Math.max(LAND_PRICE_MULTIPLIER_MIN, raw));

  return { multiplier, usedFallback: false };
}

// ---------------------------------------------------------------------------
// estimateRent
// ---------------------------------------------------------------------------

export interface RentEstimateInput {
  readonly layout: LayoutId;
  readonly wardRentPerSqmYen: number;
  readonly managementFeeYen: number;
  /** The already-computed multiplier, e.g. from `computeLandPriceMultiplier`. */
  readonly landPriceMultiplier: number;
  /** The point count backing `landPriceMultiplier`. Carried through to the output shape. */
  readonly landPricePointCount: number;
  /**
   * `computeLandPriceMultiplier`'s own `usedFallback` flag, threaded
   * through by the caller. NOT re-derived from `landPricePointCount` here:
   * `computeLandPriceMultiplier` also falls back to `1.0` when a median is
   * missing or non-positive, which can happen even with
   * `landPricePointCount >= MIN_LAND_PRICE_POINTS`, and `landPriceMultiplier`
   * alone can't be told apart from a genuinely-computed `1.0` (e.g. when
   * catchment and ward medians are equal).
   */
  readonly landPriceUsedFallback: boolean;
  readonly source: string;
  readonly sourcePeriod: string;
  readonly baseConfidence: Confidence;
  /**
   * The current year, supplied by the caller. `estimateRent` never reads
   * the clock itself, so results stay deterministic and testable.
   */
  readonly currentYear: number;
}

/** Structurally matches `rentEstimateSchema` from `contracts/response.ts`. */
export interface RentEstimateResult {
  readonly lowYen: number;
  readonly medianYen: number;
  readonly highYen: number;
  readonly layout: LayoutId;
  readonly assumedSizeSqmMin: number;
  readonly assumedSizeSqmMax: number;
  readonly assumedSizeSqmMid: number;
  readonly managementFeeYen: number;
  readonly wardRentPerSqmYen: number;
  readonly landPriceMultiplier: number;
  readonly landPricePointCount: number;
  readonly source: string;
  readonly sourcePeriod: string;
  readonly confidence: Confidence;
  readonly label: typeof RENT_LABEL;
}

/**
 * `ward rent/m2 x assumed layout size x station land-price multiplier +
 * ward management fee`, rounded to the nearest yen. The management fee is
 * added to all three of low/median/high and is NOT scaled by the
 * multiplier or by layout area.
 */
export function estimateRent(input: RentEstimateInput): RentEstimateResult {
  const {
    layout,
    wardRentPerSqmYen,
    managementFeeYen,
    landPriceMultiplier,
    landPricePointCount,
    landPriceUsedFallback,
    source,
    sourcePeriod,
    baseConfidence,
    currentYear,
  } = input;

  const layoutDef = LAYOUTS[layout];

  const medianYen = Math.round(
    wardRentPerSqmYen * layoutDef.midSqm * landPriceMultiplier + managementFeeYen,
  );
  const lowYen = Math.round(
    wardRentPerSqmYen * layoutDef.minSqm * LOW_ESTIMATE_FACTOR * landPriceMultiplier +
      managementFeeYen,
  );
  const highYen = Math.round(
    wardRentPerSqmYen * layoutDef.maxSqm * HIGH_ESTIMATE_FACTOR * landPriceMultiplier +
      managementFeeYen,
  );

  if (!(lowYen <= medianYen && medianYen <= highYen)) {
    throw new Error(
      `estimateRent: invariant lowYen <= medianYen <= highYen violated ` +
        `(lowYen=${lowYen}, medianYen=${medianYen}, highYen=${highYen}) for layout "${layout}". ` +
        `Check wardRentPerSqmYen, managementFeeYen, and landPriceMultiplier inputs.`,
    );
  }

  let confidence: Confidence = baseConfidence;

  if (landPriceUsedFallback) {
    confidence = lowerConfidence(confidence);
  }

  const sourceAgeYears = currentYear - extractYear(sourcePeriod);
  if (sourceAgeYears > RENT_STAT_RECENT_MAX_AGE_YEARS) {
    confidence = lowerConfidence(confidence);
  }

  return {
    lowYen,
    medianYen,
    highYen,
    layout,
    assumedSizeSqmMin: layoutDef.minSqm,
    assumedSizeSqmMax: layoutDef.maxSqm,
    assumedSizeSqmMid: layoutDef.midSqm,
    managementFeeYen,
    wardRentPerSqmYen,
    landPriceMultiplier,
    landPricePointCount,
    source,
    sourcePeriod,
    confidence,
    label: RENT_LABEL,
  };
}

// ---------------------------------------------------------------------------
// pickRentStat
// ---------------------------------------------------------------------------

/**
 * The subset of a `rent_stats` row that `pickRentStat` needs. Field names
 * mirror the `rent_stats` table columns exactly (see
 * `db/migrations/0001_init.sql`), so callers can pass rows straight from a
 * `SELECT * FROM rent_stats WHERE ward_code = $1` query without remapping.
 * Extra columns (e.g. `id`, `ward_code`, `sample_count`) pass through
 * untouched via the generic `T`.
 */
export interface RentStatRow {
  readonly source: string;
  readonly period: string;
  readonly rent_per_sqm_yen: number;
  readonly management_fee_yen: number;
}

export interface PickRentStatResult<T extends RentStatRow> {
  readonly stat: T;
  readonly baseConfidence: Confidence;
}

/**
 * Given every `rent_stats` row for a single ward, prefer the most recent
 * `reins` row if one exists and is not older than
 * `RENT_STAT_RECENT_MAX_AGE_YEARS`; otherwise fall back to the most recent
 * `estat` row. Confidence: `high` for a qualifying REINS row, `medium` for
 * a recent-enough e-Stat row, `low` for an e-Stat row older than
 * `RENT_STAT_OLD_MIN_AGE_YEARS`.
 */
export function pickRentStat<T extends RentStatRow>(
  stats: readonly T[],
  { currentYear }: { readonly currentYear: number },
): PickRentStatResult<T> {
  const reinsRows = stats.filter((row) => row.source === "reins");
  const newestReins = mostRecentByPeriod(reinsRows);
  if (newestReins) {
    const age = currentYear - extractYear(newestReins.period);
    if (age <= RENT_STAT_RECENT_MAX_AGE_YEARS) {
      return { stat: newestReins, baseConfidence: "high" };
    }
  }

  const estatRows = stats.filter((row) => row.source === "estat");
  const newestEstat = mostRecentByPeriod(estatRows);
  if (newestEstat) {
    const age = currentYear - extractYear(newestEstat.period);
    const baseConfidence: Confidence = age > RENT_STAT_OLD_MIN_AGE_YEARS ? "low" : "medium";
    return { stat: newestEstat, baseConfidence };
  }

  throw new Error(
    "pickRentStat: no eligible 'estat' row and no recent 'reins' row among the given rent stats.",
  );
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/**
 * Picks the row with the lexicographically greatest `period`.
 *
 * Only ever compares rows within a single source group (`pickRentStat`
 * filters by `source` before calling this), so the two period formats in
 * use never mix within one comparison: e-Stat periods are bare 4-digit
 * years (`"2023"` < `"2024"`), REINS periods are `YYYYQn` (`"2026Q1"` <
 * `"2026Q2"`). Both formats are fixed-width and left-to-right
 * most-significant-first, so plain string comparison agrees with
 * chronological order within each format. If a source ever starts mixing
 * period formats (e.g. REINS periods without a quarter), this needs to
 * change to parse an explicit (year, quarter) tuple instead.
 */
function mostRecentByPeriod<T extends RentStatRow>(rows: readonly T[]): T | undefined {
  return rows.reduce<T | undefined>((best, row) => {
    if (!best || row.period > best.period) return row;
    return best;
  }, undefined);
}

/** Extracts the leading 4-digit year from a period string like "2023" or "2026Q2". */
function extractYear(period: string): number {
  const match = /^(\d{4})/.exec(period);
  if (!match) {
    throw new Error(`rent stat period "${period}" does not start with a 4-digit year`);
  }
  return Number(match[1]);
}

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

export type LayoutId = (typeof LAYOUT_IDS)[number];

export interface LandPriceMultiplierInput {
  readonly catchmentMedianLandPrice: number | null;

  readonly wardMedianLandPrice: number | null;

  readonly pointCount: number;
}

export interface LandPriceMultiplierResult {
  readonly multiplier: number;
  readonly usedFallback: boolean;
}

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

export interface RentEstimateInput {
  readonly layout: LayoutId;
  readonly wardRentPerSqmYen: number;
  readonly managementFeeYen: number;

  readonly landPriceMultiplier: number;

  readonly landPricePointCount: number;

  readonly landPriceUsedFallback: boolean;
  readonly source: string;
  readonly sourcePeriod: string;
  readonly baseConfidence: Confidence;

  readonly currentYear: number;
}

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

export function rentStatBaseConfidence(
  source: string,
  period: string,
  currentYear: number,
): Confidence {
  if (source === "reins") {
    return "high";
  }

  const age = currentYear - extractYear(period);
  return age > RENT_STAT_OLD_MIN_AGE_YEARS ? "low" : "medium";
}

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

export function pickRentStat<T extends RentStatRow>(
  stats: readonly T[],
  { currentYear }: { readonly currentYear: number },
): PickRentStatResult<T> {
  const reinsRows = stats.filter((row) => row.source === "reins");
  const newestReins = mostRecentByPeriod(reinsRows);
  if (newestReins) {
    const age = currentYear - extractYear(newestReins.period);
    if (age <= RENT_STAT_RECENT_MAX_AGE_YEARS) {
      return {
        stat: newestReins,
        baseConfidence: rentStatBaseConfidence(newestReins.source, newestReins.period, currentYear),
      };
    }
  }

  const estatRows = stats.filter((row) => row.source === "estat");
  const newestEstat = mostRecentByPeriod(estatRows);
  if (newestEstat) {
    const baseConfidence = rentStatBaseConfidence(
      newestEstat.source,
      newestEstat.period,
      currentYear,
    );
    return { stat: newestEstat, baseConfidence };
  }

  throw new Error(
    "pickRentStat: no eligible 'estat' row and no recent 'reins' row among the given rent stats.",
  );
}

function mostRecentByPeriod<T extends RentStatRow>(rows: readonly T[]): T | undefined {
  return rows.reduce<T | undefined>((best, row) => {
    if (!best || row.period > best.period) return row;
    return best;
  }, undefined);
}

function extractYear(period: string): number {
  const match = /^(\d{4})/.exec(period);
  if (!match) {
    throw new Error(`rent stat period "${period}" does not start with a 4-digit year`);
  }
  return Number(match[1]);
}

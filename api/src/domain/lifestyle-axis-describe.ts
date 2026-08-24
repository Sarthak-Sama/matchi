/**
 * The api-local half of the lifestyle axis registry: how each axis turns a
 * `neighborhood_metrics` row into the `componentScore` / `rawValue` /
 * `rawValueLabel` triple a `FactorEvidence` needs, and which raw columns it
 * reads to do so.
 *
 * This lives in `api` rather than beside `LIFESTYLE_AXES` in `@tokyo/shared`
 * because it is typed against `LifestyleMetricsInput`, an api type —
 * `shared` importing from `api` would invert the layering. It is keyed by
 * the same `LifestyleAxisId`s, so `satisfies` still makes a missing or
 * unknown axis a compile error here.
 */

import type { LifestyleAxisId } from "@tokyo/shared";
import { CATCHMENT_RADIUS_M, QUIETNESS_LABEL } from "@tokyo/shared";

import type { LifestyleMetricsInput } from "./scoring.js";

export interface LifestyleAxisRaw {
  readonly componentScore: number;
  readonly rawValue: number;
  readonly rawValueLabel: string;
}

export interface LifestyleAxisDescriber {
  /**
   * The raw (non-`norm_*`) `neighborhood_metrics` columns `describe` reads.
   * `routes/lib/lifestyle-columns.ts` projects exactly this set, so an axis
   * that needs a new raw count declares it here and both route queries
   * follow. Empty for axes whose raw value IS their normalized score.
   */
  readonly rawColumns: readonly string[];
  readonly describe: (metrics: LifestyleMetricsInput) => LifestyleAxisRaw;
}

/**
 * The lifestyle axes' `componentScore` is the precomputed `norm_*` value
 * itself (already 0-100 — `scoreLifestyle` does not re-derive it). The raw
 * value differs by axis: for the two amenity axes it's the plain count
 * within the catchment radius (matching the spec's own example, `"12
 * supermarkets within 800 m"`); for flood safety and quietness — which
 * have no equally intuitive count — it's the normalized score itself,
 * restated in a `X/100` label (quietness reusing the existing
 * `QUIETNESS_LABEL` constant).
 *
 * A `Record` keyed by `LifestyleAxisId` rather than a `switch`: it
 * preserves exhaustiveness exactly (a missing key is the same compile
 * error) while letting the axis set be extended in one place.
 */
export const LIFESTYLE_AXIS_DESCRIBERS = {
  floodSafety: {
    rawColumns: [],
    describe: (metrics: LifestyleMetricsInput) => ({
      componentScore: metrics.normFloodSafety,
      rawValue: metrics.normFloodSafety,
      rawValueLabel: `${Math.round(metrics.normFloodSafety)}/100 flood safety score`,
    }),
  },
  supermarkets: {
    rawColumns: ["supermarket_count"],
    describe: (metrics: LifestyleMetricsInput) => ({
      componentScore: metrics.normAmenitySupermarket,
      rawValue: metrics.supermarketCount,
      rawValueLabel: `${metrics.supermarketCount} supermarkets within ${CATCHMENT_RADIUS_M} m`,
    }),
  },
  restaurants: {
    rawColumns: ["restaurant_count", "cafe_count"],
    describe: (metrics: LifestyleMetricsInput) => {
      const count = metrics.restaurantCount + metrics.cafeCount;
      return {
        componentScore: metrics.normAmenityRestaurant,
        rawValue: count,
        rawValueLabel: `${count} restaurants and cafés within ${CATCHMENT_RADIUS_M} m`,
      };
    },
  },
  quietness: {
    rawColumns: [],
    describe: (metrics: LifestyleMetricsInput) => ({
      componentScore: metrics.normQuietness,
      rawValue: metrics.normQuietness,
      rawValueLabel: `${Math.round(metrics.normQuietness)}/100 ${QUIETNESS_LABEL}`,
    }),
  },
  konbini: {
    rawColumns: ["convenience_count"],
    describe: (metrics: LifestyleMetricsInput) => ({
      componentScore: metrics.normAmenityConvenience,
      rawValue: metrics.convenienceCount,
      rawValueLabel: `${metrics.convenienceCount} convenience stores within ${CATCHMENT_RADIUS_M} m`,
    }),
  },
  cuisineVariety: {
    rawColumns: ["cuisine_variety_count"],
    describe: (metrics: LifestyleMetricsInput) => ({
      componentScore: metrics.normAmenityCuisineVariety,
      rawValue: metrics.cuisineVarietyCount,
      rawValueLabel: `${metrics.cuisineVarietyCount} distinct cuisines within ${CATCHMENT_RADIUS_M} m`,
    }),
  },
  // A share/ratio (0-1), not a count — the label reads as a proportion of
  // the catchment rather than a "N within 800 m" tally, unlike every other
  // amenity axis here.
  greenSpace: {
    rawColumns: ["green_space_share"],
    describe: (metrics: LifestyleMetricsInput) => ({
      componentScore: metrics.normGreenSpace,
      rawValue: metrics.greenSpaceShare,
      rawValueLabel: `${Math.round(metrics.greenSpaceShare * 100)}% of the catchment (${CATCHMENT_RADIUS_M} m radius) is parks or green space`,
    }),
  },
  lateNight: {
    rawColumns: ["late_night_count"],
    describe: (metrics: LifestyleMetricsInput) => ({
      componentScore: metrics.normAmenityLateNight,
      rawValue: metrics.lateNightCount,
      rawValueLabel: `${metrics.lateNightCount} late-night restaurants, cafés, and bars within ${CATCHMENT_RADIUS_M} m`,
    }),
  },
  health: {
    rawColumns: ["health_count"],
    describe: (metrics: LifestyleMetricsInput) => ({
      componentScore: metrics.normAmenityHealth,
      rawValue: metrics.healthCount,
      rawValueLabel: `${metrics.healthCount} clinics, pharmacies, and hospitals within ${CATCHMENT_RADIUS_M} m`,
    }),
  },
} as const satisfies Record<LifestyleAxisId, LifestyleAxisDescriber>;

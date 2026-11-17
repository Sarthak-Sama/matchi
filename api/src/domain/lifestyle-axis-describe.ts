import type { LifestyleAxisId } from "@tokyo/shared";
import { CATCHMENT_RADIUS_M, QUIETNESS_LABEL } from "@tokyo/shared";

import type { LifestyleMetricsInput } from "./scoring.js";

export interface LifestyleAxisRaw {
  readonly componentScore: number;
  readonly rawValue: number;
  readonly rawValueLabel: string;
}

export interface LifestyleAxisDescriber {
  readonly rawColumns: readonly string[];
  readonly describe: (metrics: LifestyleMetricsInput) => LifestyleAxisRaw;
}

export const LIFESTYLE_AXIS_DESCRIBERS = {
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

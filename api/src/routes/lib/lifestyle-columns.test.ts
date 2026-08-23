import { LIFESTYLE_AXES, LIFESTYLE_AXIS_IDS } from "@tokyo/shared";
import { describe, expect, it } from "vitest";

import { LIFESTYLE_AXIS_DESCRIBERS } from "../../domain/lifestyle-axis-describe.js";
import type { LifestyleMetricColumns } from "./lifestyle-columns.js";
import {
  LIFESTYLE_SELECT_SQL,
  readLifestyleNormScores,
  readLifestyleRawCounts,
} from "./lifestyle-columns.js";

function makeRow(overrides: Partial<Record<string, number | null>> = {}): LifestyleMetricColumns {
  return {
    normFloodSafety: 80,
    normAmenitySupermarket: 70,
    normAmenityRestaurant: 60,
    normQuietness: 50,
    supermarketCount: 6,
    restaurantCount: 20,
    cafeCount: 4,
    ...overrides,
  };
}

describe("LIFESTYLE_SELECT_SQL", () => {
  it("projects every axis's norm column under its metricsKey alias", () => {
    for (const id of LIFESTYLE_AXIS_IDS) {
      const axis = LIFESTYLE_AXES[id];
      expect(LIFESTYLE_SELECT_SQL).toContain(`nm.${axis.normColumn} AS "${axis.metricsKey}"`);
    }
  });

  it("projects every raw column a describer declares, camelCased", () => {
    // A raw column that isn't projected would arrive as `undefined` and
    // surface in a `rawValueLabel` as "NaN supermarkets within 800 m".
    expect(LIFESTYLE_SELECT_SQL).toContain(`nm.supermarket_count AS "supermarketCount"`);
    expect(LIFESTYLE_SELECT_SQL).toContain(`nm.restaurant_count AS "restaurantCount"`);
    expect(LIFESTYLE_SELECT_SQL).toContain(`nm.cafe_count AS "cafeCount"`);
    const declared = LIFESTYLE_AXIS_IDS.flatMap((id) => LIFESTYLE_AXIS_DESCRIBERS[id].rawColumns);
    for (const column of declared) {
      expect(LIFESTYLE_SELECT_SQL).toContain(`nm.${column} AS "`);
    }
  });
});

describe("readLifestyleNormScores", () => {
  it("returns every axis's score keyed by metricsKey", () => {
    expect(readLifestyleNormScores(makeRow())).toEqual({
      normFloodSafety: 80,
      normAmenitySupermarket: 70,
      normAmenityRestaurant: 60,
      normQuietness: 50,
    });
  });

  it("returns null when any single axis column is null", () => {
    for (const id of LIFESTYLE_AXIS_IDS) {
      const row = makeRow({ [LIFESTYLE_AXES[id].metricsKey]: null });
      expect(readLifestyleNormScores(row)).toBeNull();
    }
  });
});

describe("readLifestyleRawCounts", () => {
  it("returns the declared raw counts under their camelCase aliases", () => {
    expect(readLifestyleRawCounts(makeRow())).toEqual({
      supermarketCount: 6,
      restaurantCount: 20,
      cafeCount: 4,
    });
  });

  it("coalesces a null count to 0 rather than letting it reach a rawValueLabel", () => {
    expect(readLifestyleRawCounts(makeRow({ cafeCount: null })).cafeCount).toBe(0);
  });
});

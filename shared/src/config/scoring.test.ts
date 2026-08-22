import { describe, expect, it } from "vitest";

import {
  AFFORDABILITY_FULL_SCORE_RATIO,
  COMMUTE_FULL_SCORE_MINUTES,
  IMPORTANCE_VALUES,
  LAYOUT_IDS,
  LAYOUTS,
  lowerConfidence,
  NEIGHBORHOOD_DEFAULT_LAYOUT,
  OVERALL_WEIGHTS,
  QUIETNESS_WEIGHTS,
  REASON_NEGATIVE_THRESHOLD,
  REASON_POSITIVE_THRESHOLD,
  RESULTS_LIMIT,
  STATIONS_DEFAULT_LIMIT,
  STATIONS_MAX_LIMIT,
} from "./scoring.js";

describe("OVERALL_WEIGHTS", () => {
  it("sums to exactly 1", () => {
    expect(
      OVERALL_WEIGHTS.affordability + OVERALL_WEIGHTS.commute + OVERALL_WEIGHTS.lifestyle,
    ).toBe(1);
  });

  it("matches the spec literal values", () => {
    expect(OVERALL_WEIGHTS).toEqual({
      affordability: 0.3,
      commute: 0.3,
      lifestyle: 0.4,
    });
  });
});

describe("QUIETNESS_WEIGHTS", () => {
  it("sums to exactly 1", () => {
    expect(
      QUIETNESS_WEIGHTS.residentialZoningShare +
        QUIETNESS_WEIGHTS.inverseRoadRailExposure +
        QUIETNESS_WEIGHTS.inverseNightlifeDensity,
    ).toBe(1);
  });

  it("matches the spec literal values", () => {
    expect(QUIETNESS_WEIGHTS).toEqual({
      residentialZoningShare: 0.5,
      inverseRoadRailExposure: 0.3,
      inverseNightlifeDensity: 0.2,
    });
  });
});

describe("LAYOUTS", () => {
  it("has ids matching LAYOUT_IDS exactly, in order", () => {
    expect(Object.keys(LAYOUTS)).toEqual([...LAYOUT_IDS]);
  });

  it("satisfies min < mid < max for every layout", () => {
    for (const id of LAYOUT_IDS) {
      const layout = LAYOUTS[id];
      expect(layout.minSqm).toBeLessThan(layout.midSqm);
      expect(layout.midSqm).toBeLessThan(layout.maxSqm);
    }
  });

  it("matches the exact spec table (literal numbers)", () => {
    expect(LAYOUTS["1R"]).toEqual({
      id: "1R",
      label: "1R",
      minSqm: 18,
      maxSqm: 25,
      midSqm: 21,
    });
    expect(LAYOUTS["1K"]).toEqual({
      id: "1K",
      label: "1K",
      minSqm: 20,
      maxSqm: 28,
      midSqm: 24,
    });
    expect(LAYOUTS["1DK"]).toEqual({
      id: "1DK",
      label: "1DK",
      minSqm: 25,
      maxSqm: 35,
      midSqm: 30,
    });
    expect(LAYOUTS["1LDK"]).toEqual({
      id: "1LDK",
      label: "1LDK",
      minSqm: 32,
      maxSqm: 45,
      midSqm: 38,
    });
    expect(LAYOUTS["2K_2DK"]).toEqual({
      id: "2K_2DK",
      label: "2K/2DK",
      minSqm: 35,
      maxSqm: 50,
      midSqm: 43,
    });
    expect(LAYOUTS["2LDK"]).toEqual({
      id: "2LDK",
      label: "2LDK",
      minSqm: 45,
      maxSqm: 65,
      midSqm: 55,
    });
    expect(LAYOUTS["3LDK"]).toEqual({
      id: "3LDK",
      label: "3LDK",
      minSqm: 60,
      maxSqm: 80,
      midSqm: 70,
    });
  });
});

describe("IMPORTANCE_VALUES", () => {
  it("equals the spec's literal mapping", () => {
    expect(IMPORTANCE_VALUES).toEqual({
      low: 1,
      medium: 2,
      high: 4,
      essential: 8,
    });
  });
});

describe("AFFORDABILITY_FULL_SCORE_RATIO", () => {
  it("matches the spec literal value", () => {
    expect(AFFORDABILITY_FULL_SCORE_RATIO).toBe(0.6);
  });
});

describe("COMMUTE_FULL_SCORE_MINUTES", () => {
  it("matches the spec literal value", () => {
    expect(COMMUTE_FULL_SCORE_MINUTES).toBe(15);
  });
});

describe("REASON_POSITIVE_THRESHOLD and REASON_NEGATIVE_THRESHOLD", () => {
  it("match the spec literal values", () => {
    expect(REASON_POSITIVE_THRESHOLD).toBe(0.66);
    expect(REASON_NEGATIVE_THRESHOLD).toBe(0.34);
  });
});

describe("lowerConfidence", () => {
  it("steps high -> medium -> low -> low", () => {
    expect(lowerConfidence("high")).toBe("medium");
    expect(lowerConfidence("medium")).toBe("low");
    expect(lowerConfidence("low")).toBe("low");
  });
});

describe("RESULTS_LIMIT", () => {
  it("matches the spec literal value (POST /v1/optimize returns the top 20)", () => {
    expect(RESULTS_LIMIT).toBe(20);
  });
});

describe("STATIONS_DEFAULT_LIMIT and STATIONS_MAX_LIMIT", () => {
  it("match the spec literal values (GET /v1/stations defaults to 10, caps at 50)", () => {
    expect(STATIONS_DEFAULT_LIMIT).toBe(10);
    expect(STATIONS_MAX_LIMIT).toBe(50);
  });
});

describe("NEIGHBORHOOD_DEFAULT_LAYOUT", () => {
  it("matches the spec literal value (GET /v1/neighborhoods/:id defaults to 1LDK)", () => {
    expect(NEIGHBORHOOD_DEFAULT_LAYOUT).toBe("1LDK");
  });

  it("is one of the defined LAYOUT_IDS", () => {
    expect(LAYOUT_IDS).toContain(NEIGHBORHOOD_DEFAULT_LAYOUT);
  });
});

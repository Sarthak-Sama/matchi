import { describe, expect, it } from "vitest";

import {
  LAND_PRICE_MULTIPLIER_MAX,
  LAND_PRICE_MULTIPLIER_MIN,
  LAYOUT_IDS,
  MIN_LAND_PRICE_POINTS,
} from "../config/scoring.js";
import { rentEstimateSchema } from "../contracts/response.js";
import {
  computeLandPriceMultiplier,
  estimateRent,
  pickRentStat,
  rentStatBaseConfidence,
} from "./rent.js";

const FIXED_INPUT_BASE = {
  wardRentPerSqmYen: 3600,
  managementFeeYen: 7000,
  landPriceMultiplier: 1,
  landPricePointCount: 5,
  landPriceUsedFallback: false,
  source: "estat",
  sourcePeriod: "2025",
  baseConfidence: "high" as const,
  currentYear: 2026,
};

describe("estimateRent — worked example per layout", () => {
  it("1R", () => {
    const result = estimateRent({ ...FIXED_INPUT_BASE, layout: "1R" });
    expect(result.lowYen).toBe(65320);
    expect(result.medianYen).toBe(82600);
    expect(result.highYen).toBe(106000);
  });

  it("1K", () => {
    const result = estimateRent({ ...FIXED_INPUT_BASE, layout: "1K" });
    expect(result.lowYen).toBe(71800);
    expect(result.medianYen).toBe(93400);
    expect(result.highYen).toBe(117880);
  });

  it("1DK", () => {
    const result = estimateRent({ ...FIXED_INPUT_BASE, layout: "1DK" });
    expect(result.lowYen).toBe(88000);
    expect(result.medianYen).toBe(115000);
    expect(result.highYen).toBe(145600);
  });

  it("1LDK", () => {
    const result = estimateRent({ ...FIXED_INPUT_BASE, layout: "1LDK" });
    expect(result.lowYen).toBe(110680);
    expect(result.medianYen).toBe(143800);
    expect(result.highYen).toBe(185200);
  });

  it("2K_2DK", () => {
    const result = estimateRent({ ...FIXED_INPUT_BASE, layout: "2K_2DK" });
    expect(result.lowYen).toBe(120400);
    expect(result.medianYen).toBe(161800);
    expect(result.highYen).toBe(205000);
  });

  it("2LDK", () => {
    const result = estimateRent({ ...FIXED_INPUT_BASE, layout: "2LDK" });
    expect(result.lowYen).toBe(152800);
    expect(result.medianYen).toBe(205000);
    expect(result.highYen).toBe(264400);
  });

  it("3LDK", () => {
    const result = estimateRent({ ...FIXED_INPUT_BASE, layout: "3LDK" });
    expect(result.lowYen).toBe(201400);
    expect(result.medianYen).toBe(259000);
    expect(result.highYen).toBe(323800);
  });

  it("carries RENT_LABEL and no confidence downgrade (fresh source, enough land-price points)", () => {
    const result = estimateRent({ ...FIXED_INPUT_BASE, layout: "1R" });
    expect(result.label).toBe("modeled area rent");
    expect(result.confidence).toBe("high");
  });

  it("every result validates against rentEstimateSchema", () => {
    for (const layout of LAYOUT_IDS) {
      const result = estimateRent({ ...FIXED_INPUT_BASE, layout });
      expect(() => rentEstimateSchema.parse(result)).not.toThrow();
    }
  });
});

describe("estimateRent — low <= median <= high invariant", () => {
  it("holds for every layout under normal (non-adversarial) inputs", () => {
    for (const layout of LAYOUT_IDS) {
      const result = estimateRent({ ...FIXED_INPUT_BASE, layout, landPriceMultiplier: 1.08 });
      expect(result.lowYen).toBeLessThanOrEqual(result.medianYen);
      expect(result.medianYen).toBeLessThanOrEqual(result.highYen);
    }
  });

  it("throws a descriptive error when bad inputs (negative rent) flip the ordering", () => {
    expect(() =>
      estimateRent({
        ...FIXED_INPUT_BASE,
        layout: "1R",
        wardRentPerSqmYen: -1000,
        managementFeeYen: 0,
      }),
    ).toThrow(/invariant/i);
  });
});

describe("estimateRent — management fee handling", () => {
  it("fee is added unscaled to low, median, and high (differencing two runs)", () => {
    const runLowFee = estimateRent({
      ...FIXED_INPUT_BASE,
      layout: "1LDK",
      wardRentPerSqmYen: 4000,
      landPriceMultiplier: 1.05,
      managementFeeYen: 5000,
    });
    const runHighFee = estimateRent({
      ...FIXED_INPUT_BASE,
      layout: "1LDK",
      wardRentPerSqmYen: 4000,
      landPriceMultiplier: 1.05,
      managementFeeYen: 9000,
    });

    expect(runHighFee.lowYen - runLowFee.lowYen).toBe(4000);
    expect(runHighFee.medianYen - runLowFee.medianYen).toBe(4000);
    expect(runHighFee.highYen - runLowFee.highYen).toBe(4000);
  });
});

describe("estimateRent — confidence downgrades", () => {
  it("landPriceUsedFallback: true (threaded from computeLandPriceMultiplier's pointCount fallback) lowers confidence by one step", () => {
    expect(MIN_LAND_PRICE_POINTS).toBe(3);
    const landPrice = computeLandPriceMultiplier({
      catchmentMedianLandPrice: 550_000,
      wardMedianLandPrice: 500_000,
      pointCount: 2,
    });
    expect(landPrice).toEqual({ multiplier: 1.0, usedFallback: true });

    const result = estimateRent({
      ...FIXED_INPUT_BASE,
      layout: "1R",
      landPricePointCount: 2,
      landPriceMultiplier: landPrice.multiplier,
      landPriceUsedFallback: landPrice.usedFallback,
    });
    expect(result.confidence).toBe("medium");
  });

  it("landPricePointCount >= MIN_LAND_PRICE_POINTS but landPriceUsedFallback: true (median-missing case) still lowers confidence by one step", () => {
    const landPrice = computeLandPriceMultiplier({
      catchmentMedianLandPrice: 550_000,
      wardMedianLandPrice: null,
      pointCount: 5,
    });
    expect(landPrice).toEqual({ multiplier: 1.0, usedFallback: true });

    const result = estimateRent({
      ...FIXED_INPUT_BASE,
      layout: "1R",
      landPricePointCount: 5,
      landPriceMultiplier: landPrice.multiplier,
      landPriceUsedFallback: landPrice.usedFallback,
    });
    expect(result.confidence).toBe("medium");
  });

  it("landPriceUsedFallback: false does not trigger the land-price downgrade, regardless of pointCount", () => {
    const result = estimateRent({
      ...FIXED_INPUT_BASE,
      layout: "1R",
      landPricePointCount: 3,
      landPriceUsedFallback: false,
    });
    expect(result.confidence).toBe("high");
  });

  it("a source period more than 2 years older than currentYear lowers confidence by one step", () => {
    const result = estimateRent({
      ...FIXED_INPUT_BASE,
      layout: "1R",
      sourcePeriod: "2020",
    });
    expect(result.confidence).toBe("medium");
  });

  it("both downgrades combined step confidence down twice (high -> medium -> low)", () => {
    const result = estimateRent({
      ...FIXED_INPUT_BASE,
      layout: "1R",
      landPricePointCount: 2,
      landPriceUsedFallback: true,
      sourcePeriod: "2020",
    });
    expect(result.confidence).toBe("low");
  });

  it("baseConfidence 'low' stays 'low' even with both downgrades (floor, does not go negative)", () => {
    const result = estimateRent({
      ...FIXED_INPUT_BASE,
      layout: "1R",
      baseConfidence: "low",
      landPricePointCount: 2,
      landPriceUsedFallback: true,
      sourcePeriod: "2020",
    });
    expect(result.confidence).toBe("low");
  });
});

describe("computeLandPriceMultiplier", () => {
  it("clamps to LAND_PRICE_MULTIPLIER_MAX (1.15) when the raw ratio exceeds it", () => {
    expect(LAND_PRICE_MULTIPLIER_MAX).toBe(1.15);
    const result = computeLandPriceMultiplier({
      catchmentMedianLandPrice: 1_600_000,
      wardMedianLandPrice: 100_000,
      pointCount: 10,
    });
    expect(result.multiplier).toBe(1.15);
    expect(result.usedFallback).toBe(false);
  });

  it("clamps to LAND_PRICE_MULTIPLIER_MIN (0.85) when the raw ratio is below it", () => {
    expect(LAND_PRICE_MULTIPLIER_MIN).toBe(0.85);
    const result = computeLandPriceMultiplier({
      catchmentMedianLandPrice: 100_000,
      wardMedianLandPrice: 1_600_000,
      pointCount: 10,
    });
    expect(result.multiplier).toBe(0.85);
    expect(result.usedFallback).toBe(false);
  });

  it("applies the exact 0.25 exponent for an in-range ratio (no clamping)", () => {
    const result = computeLandPriceMultiplier({
      catchmentMedianLandPrice: 550_000,
      wardMedianLandPrice: 500_000,
      pointCount: 3,
    });
    expect(result.multiplier).toBe(1.0241136890844451);
    expect(result.usedFallback).toBe(false);
  });

  it("pointCount = 2 (< MIN_LAND_PRICE_POINTS) falls back to multiplier exactly 1.0", () => {
    const result = computeLandPriceMultiplier({
      catchmentMedianLandPrice: 550_000,
      wardMedianLandPrice: 500_000,
      pointCount: 2,
    });
    expect(result).toEqual({ multiplier: 1.0, usedFallback: true });
  });

  it("pointCount = 3 (== MIN_LAND_PRICE_POINTS) uses the real computed multiplier, not the fallback", () => {
    const result = computeLandPriceMultiplier({
      catchmentMedianLandPrice: 550_000,
      wardMedianLandPrice: 500_000,
      pointCount: 3,
    });
    expect(result.usedFallback).toBe(false);
    expect(result.multiplier).toBe(1.0241136890844451);
  });

  it("falls back to 1.0 when either median is missing", () => {
    expect(
      computeLandPriceMultiplier({
        catchmentMedianLandPrice: null,
        wardMedianLandPrice: 500_000,
        pointCount: 10,
      }),
    ).toEqual({ multiplier: 1.0, usedFallback: true });

    expect(
      computeLandPriceMultiplier({
        catchmentMedianLandPrice: 500_000,
        wardMedianLandPrice: null,
        pointCount: 10,
      }),
    ).toEqual({ multiplier: 1.0, usedFallback: true });
  });

  it("falls back to 1.0 when either median is non-positive", () => {
    expect(
      computeLandPriceMultiplier({
        catchmentMedianLandPrice: 0,
        wardMedianLandPrice: 500_000,
        pointCount: 10,
      }),
    ).toEqual({ multiplier: 1.0, usedFallback: true });

    expect(
      computeLandPriceMultiplier({
        catchmentMedianLandPrice: 500_000,
        wardMedianLandPrice: -1,
        pointCount: 10,
      }),
    ).toEqual({ multiplier: 1.0, usedFallback: true });
  });
});

describe("pickRentStat", () => {
  const estat2023 = {
    source: "estat",
    period: "2023",
    rent_per_sqm_yen: 4200,
    management_fee_yen: 8000,
  };
  const estat2024 = {
    source: "estat",
    period: "2024",
    rent_per_sqm_yen: 4300,
    management_fee_yen: 8100,
  };
  const reins2026Q2 = {
    source: "reins",
    period: "2026Q2",
    rent_per_sqm_yen: 4450,
    management_fee_yen: 8500,
  };
  const reinsStale2020Q1 = {
    source: "reins",
    period: "2020Q1",
    rent_per_sqm_yen: 4000,
    management_fee_yen: 7500,
  };

  it("prefers a recent REINS row over an e-Stat row for the same ward", () => {
    const result = pickRentStat([estat2023, reins2026Q2], { currentYear: 2026 });
    expect(result.stat).toBe(reins2026Q2);
    expect(result.baseConfidence).toBe("high");
  });

  it("falls back to the most recent e-Stat row when REINS is missing", () => {
    const result = pickRentStat([estat2024], { currentYear: 2026 });
    expect(result.stat).toBe(estat2024);
    expect(result.baseConfidence).toBe("medium");
  });

  it("falls back to e-Stat when the only REINS row is older than 2 years", () => {
    const result = pickRentStat([reinsStale2020Q1, estat2023, estat2024], {
      currentYear: 2026,
    });
    expect(result.stat).toBe(estat2024);
    expect(result.baseConfidence).toBe("medium");
  });

  it("downgrades to low confidence when the chosen e-Stat row is older than 5 years", () => {
    const estatStale2018 = {
      source: "estat",
      period: "2018",
      rent_per_sqm_yen: 3000,
      management_fee_yen: 6000,
    };
    const result = pickRentStat([estatStale2018], { currentYear: 2026 });
    expect(result.stat).toBe(estatStale2018);
    expect(result.baseConfidence).toBe("low");
  });

  it("throws when there is no eligible e-Stat row and no recent REINS row", () => {
    expect(() => pickRentStat([reinsStale2020Q1], { currentYear: 2026 })).toThrow();
  });
});

describe("rentStatBaseConfidence", () => {
  it("a reins source is always 'high', regardless of age", () => {
    expect(rentStatBaseConfidence("reins", "2026Q2", 2026)).toBe("high");
  });

  it("a reins source is 'high' even when its period is old (age 11)", () => {
    expect(rentStatBaseConfidence("reins", "2015Q1", 2026)).toBe("high");
  });

  it("an estat source at age 2 (not older than 5) is 'medium'", () => {
    expect(rentStatBaseConfidence("estat", "2024", 2026)).toBe("medium");
  });

  it("an estat source at age 0 is 'medium'", () => {
    expect(rentStatBaseConfidence("estat", "2026", 2026)).toBe("medium");
  });

  it("an estat source at exactly age 5 (the boundary) is still 'medium'", () => {
    expect(rentStatBaseConfidence("estat", "2021", 2026)).toBe("medium");
  });

  it("an estat source older than 5 years (age 6) is 'low'", () => {
    expect(rentStatBaseConfidence("estat", "2020", 2026)).toBe("low");
  });

  it("pickRentStat's own results are unchanged by delegating to this function (regression check)", () => {
    const reins2026Q2 = {
      source: "reins",
      period: "2026Q2",
      rent_per_sqm_yen: 4450,
      management_fee_yen: 8500,
    };
    const estat2023 = {
      source: "estat",
      period: "2023",
      rent_per_sqm_yen: 4200,
      management_fee_yen: 8000,
    };
    const result = pickRentStat([estat2023, reins2026Q2], { currentYear: 2026 });
    expect(result.stat).toBe(reins2026Q2);
    expect(result.baseConfidence).toBe(
      rentStatBaseConfidence(reins2026Q2.source, reins2026Q2.period, 2026),
    );
    expect(result.baseConfidence).toBe("high");
  });
});

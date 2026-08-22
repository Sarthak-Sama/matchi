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

// ---------------------------------------------------------------------------
// estimateRent — worked example per layout
//
// Fixed inputs for every layout below: wardRentPerSqmYen = 3600,
// managementFeeYen = 7000, landPriceMultiplier = 1 (neutral),
// landPricePointCount = 5 (>= MIN_LAND_PRICE_POINTS, no fallback),
// sourcePeriod = "2025", currentYear = 2026 (age 1, not stale),
// baseConfidence = "high" (expect no downgrade).
//
// Formula: medianYen = round(rent * mid * mult + fee)
//          lowYen    = round(rent * min * 0.9 * mult + fee)
//          highYen   = round(rent * max * 1.1 * mult + fee)
//
// Worked by hand (mult = 1 so it drops out):
//   1R:     mid=21 -> 3600*21=75600  +7000 = 82600   (median)
//           min=18 -> 3600*18*0.9=58320 +7000 = 65320 (low)
//           max=25 -> 3600*25*1.1=99000 +7000 = 106000 (high)
//   1K:     mid=24 -> 86400+7000=93400 | min=20 -> 64800+7000=71800 | max=28 -> 110880+7000=117880
//   1DK:    mid=30 -> 108000+7000=115000 | min=25 -> 81000+7000=88000 | max=35 -> 138600+7000=145600
//   1LDK:   mid=38 -> 136800+7000=143800 | min=32 -> 103680+7000=110680 | max=45 -> 178200+7000=185200
//   2K_2DK: mid=43 -> 154800+7000=161800 | min=35 -> 113400+7000=120400 | max=50 -> 198000+7000=205000
//   2LDK:   mid=55 -> 198000+7000=205000 | min=45 -> 145800+7000=152800 | max=65 -> 257400+7000=264400
//   3LDK:   mid=70 -> 252000+7000=259000 | min=60 -> 194400+7000=201400 | max=80 -> 316800+7000=323800
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// estimateRent — low <= median <= high invariant, every layout
// ---------------------------------------------------------------------------

describe("estimateRent — low <= median <= high invariant", () => {
  it("holds for every layout under normal (non-adversarial) inputs", () => {
    for (const layout of LAYOUT_IDS) {
      const result = estimateRent({ ...FIXED_INPUT_BASE, layout, landPriceMultiplier: 1.08 });
      expect(result.lowYen).toBeLessThanOrEqual(result.medianYen);
      expect(result.medianYen).toBeLessThanOrEqual(result.highYen);
    }
  });

  it("throws a descriptive error when bad inputs (negative rent) flip the ordering", () => {
    // Hand-computed with wardRentPerSqmYen = -1000, fee = 0, mult = 1, layout 1R
    // (min=18, mid=21, max=25):
    //   low    = round(-1000 * 18 * 0.9) = -16200
    //   median = round(-1000 * 21)       = -21000
    //   high   = round(-1000 * 25 * 1.1) = -27500
    // -16200 <= -21000 is false, so the invariant is violated and must throw.
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

// ---------------------------------------------------------------------------
// estimateRent — management fee is added, not scaled
// ---------------------------------------------------------------------------

describe("estimateRent — management fee handling", () => {
  it("fee is added unscaled to low, median, and high (differencing two runs)", () => {
    // wardRentPerSqmYen = 4000, layout = 1LDK, multiplier = 1.05, same
    // land-price/source inputs in both runs — only managementFeeYen differs
    // (5000 vs 9000, a difference of 4000). If the fee were scaled by the
    // multiplier or by area, the resulting deltas would not equal 4000.
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

// ---------------------------------------------------------------------------
// estimateRent — confidence downgrades
// ---------------------------------------------------------------------------

describe("estimateRent — confidence downgrades", () => {
  it("landPriceUsedFallback: true (threaded from computeLandPriceMultiplier's pointCount fallback) lowers confidence by one step", () => {
    // Realistic wiring: pointCount = 2 < MIN_LAND_PRICE_POINTS (3), so
    // computeLandPriceMultiplier falls back, and estimateRent is given
    // its multiplier AND its usedFallback flag (not re-derived from pointCount).
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
    expect(result.confidence).toBe("medium"); // high -> medium
  });

  it("landPricePointCount >= MIN_LAND_PRICE_POINTS but landPriceUsedFallback: true (median-missing case) still lowers confidence by one step", () => {
    // This is the plumbing gap the review caught: pointCount alone can't
    // tell estimateRent a fallback happened, because
    // computeLandPriceMultiplier also falls back to 1.0 when a median is
    // missing/non-positive, independent of pointCount. Here pointCount = 5
    // (well above MIN_LAND_PRICE_POINTS = 3) but the caller still threads
    // usedFallback: true through, because the ward median came back null.
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
    expect(result.confidence).toBe("medium"); // high -> medium, exactly one step
  });

  it("landPriceUsedFallback: false does not trigger the land-price downgrade, regardless of pointCount", () => {
    const result = estimateRent({
      ...FIXED_INPUT_BASE,
      layout: "1R",
      landPricePointCount: 3,
      landPriceUsedFallback: false,
    });
    expect(result.confidence).toBe("high"); // no downgrade
  });

  it("a source period more than 2 years older than currentYear lowers confidence by one step", () => {
    const result = estimateRent({
      ...FIXED_INPUT_BASE,
      layout: "1R",
      sourcePeriod: "2020", // currentYear 2026 - 2020 = 6 > 2
    });
    expect(result.confidence).toBe("medium"); // high -> medium
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

// ---------------------------------------------------------------------------
// computeLandPriceMultiplier
// ---------------------------------------------------------------------------

describe("computeLandPriceMultiplier", () => {
  it("clamps to LAND_PRICE_MULTIPLIER_MAX (1.15) when the raw ratio exceeds it", () => {
    // ratio = 1,600,000 / 100,000 = 16; 16 ** 0.25 = 2.0 exactly (2^4 = 16).
    // 2.0 > 1.15, so it clamps to the max.
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
    // ratio = 100,000 / 1,600,000 = 0.0625; 0.0625 ** 0.25 = 0.5 exactly (0.5^4 = 0.0625).
    // 0.5 < 0.85, so it clamps to the min.
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
    // ratio = 550,000 / 500,000 = 1.1; 1.1 ** 0.25 = 1.0241136890844451
    // (computed once with `node -e "console.log(1.1 ** 0.25)"`), which is
    // within [0.85, 1.15] so it passes through unclamped.
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

// ---------------------------------------------------------------------------
// pickRentStat
// ---------------------------------------------------------------------------

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
    // currentYear 2026 - reins period 2026 = age 0, within 2 years -> high.
    const result = pickRentStat([estat2023, reins2026Q2], { currentYear: 2026 });
    expect(result.stat).toBe(reins2026Q2);
    expect(result.baseConfidence).toBe("high");
  });

  it("falls back to the most recent e-Stat row when REINS is missing", () => {
    // currentYear 2026 - estat period 2024 = age 2, not older than 5 -> medium.
    const result = pickRentStat([estat2024], { currentYear: 2026 });
    expect(result.stat).toBe(estat2024);
    expect(result.baseConfidence).toBe("medium");
  });

  it("falls back to e-Stat when the only REINS row is older than 2 years", () => {
    // reins period 2020Q1 -> year 2020; currentYear 2026 - 2020 = age 6 > 2,
    // so REINS is skipped and the (more recent) e-Stat row 2024 is used.
    // age for estat: 2026 - 2024 = 2, not older than 5 -> medium.
    const result = pickRentStat([reinsStale2020Q1, estat2023, estat2024], {
      currentYear: 2026,
    });
    expect(result.stat).toBe(estat2024);
    expect(result.baseConfidence).toBe("medium");
  });

  it("downgrades to low confidence when the chosen e-Stat row is older than 5 years", () => {
    // currentYear 2026 - estat period 2023 = age 3 -> NOT low yet (test above already
    // covers a fresh case at age 2 = medium); use an older row to cross the 5-year line.
    // estat period 2018 -> age = 2026 - 2018 = 8 > 5 -> low.
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

// ---------------------------------------------------------------------------
// rentStatBaseConfidence
//
// Extracted from `pickRentStat`'s two branches specifically so a caller that
// already knows which (source, period) backs a STORED estimate (Task 10's
// `/v1/optimize` and `/v1/neighborhoods/:id`, recomputing `estimateRent` for
// a user-chosen layout) can reconstruct the correct `baseConfidence` INPUT,
// rather than feeding a row's own already fallback/staleness-ADJUSTED
// `rent_confidence` column back in as `baseConfidence` — which would
// double-apply those downgrades on every recompute. These are the same
// (source, period, currentYear) combinations `pickRentStat`'s own tests
// above already exercise indirectly; this describes the classification
// function directly and in isolation.
// ---------------------------------------------------------------------------

describe("rentStatBaseConfidence", () => {
  it("a reins source is always 'high', regardless of age", () => {
    // Mirrors pickRentStat's reins branch: it only ever SELECTS a reins row
    // when age <= RENT_STAT_RECENT_MAX_AGE_YEARS, so the base confidence
    // for a reins pick is unconditionally "high" — staleness is instead
    // re-evaluated independently by estimateRent's own age check, using
    // whatever currentYear the caller supplies at recompute time.
    expect(rentStatBaseConfidence("reins", "2026Q2", 2026)).toBe("high");
  });

  it("a reins source is 'high' even when its period is old (age 11)", () => {
    // Deliberately calling this with an old reins period some caller might
    // still be recomputing from (e.g. a station whose stored rent_source
    // predates a recent pickRentStat run) — rentStatBaseConfidence itself
    // does not gate on age for reins; estimateRent's separate staleness
    // check is what would still downgrade the FINAL confidence in that
    // case.
    expect(rentStatBaseConfidence("reins", "2015Q1", 2026)).toBe("high");
  });

  it("an estat source at age 2 (not older than 5) is 'medium'", () => {
    // currentYear 2026 - period 2024 = age 2.
    expect(rentStatBaseConfidence("estat", "2024", 2026)).toBe("medium");
  });

  it("an estat source at age 0 is 'medium'", () => {
    expect(rentStatBaseConfidence("estat", "2026", 2026)).toBe("medium");
  });

  it("an estat source at exactly age 5 (the boundary) is still 'medium'", () => {
    // RENT_STAT_OLD_MIN_AGE_YEARS is 5; the check is "age > 5", so age
    // exactly 5 does NOT cross into "low" — matches pickRentStat's own
    // "downgrades to low confidence when...older than 5 years" test, which
    // uses age 8 (unambiguously past the boundary) rather than the
    // boundary itself.
    expect(rentStatBaseConfidence("estat", "2021", 2026)).toBe("medium");
  });

  it("an estat source older than 5 years (age 6) is 'low'", () => {
    expect(rentStatBaseConfidence("estat", "2020", 2026)).toBe("low");
  });

  it("pickRentStat's own results are unchanged by delegating to this function (regression check)", () => {
    // Re-asserts the exact same (stat, baseConfidence) pairs as the
    // describe("pickRentStat", ...) block above, confirming the refactor
    // that extracted rentStatBaseConfidence did not alter pickRentStat's
    // observable behavior.
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

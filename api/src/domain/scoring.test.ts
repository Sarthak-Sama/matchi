import type { FactorEvidence, OptimizationRequest } from "@tokyo/shared";
import { CATCHMENT_LABEL, COMMUTE_LABEL, RENT_LABEL } from "@tokyo/shared";
import type { RentEstimateResult } from "@tokyo/shared";
import { describe, expect, it } from "vitest";

import type { CommuteEstimateResult } from "./transit/commute.js";
import type { Candidate, LifestyleMetricsInput, ScoredCandidate } from "./scoring.js";
import {
  applyHardFilters,
  buildReasons,
  rankCandidates,
  scoreAffordability,
  scoreCandidate,
  scoreCommute,
  scoreLifestyle,
} from "./scoring.js";

function makeRent(overrides: Partial<RentEstimateResult> = {}): RentEstimateResult {
  return {
    lowYen: 100_000,
    medianYen: 120_000,
    highYen: 140_000,
    layout: "1K",
    assumedSizeSqmMin: 20,
    assumedSizeSqmMax: 28,
    assumedSizeSqmMid: 24,
    managementFeeYen: 5_000,
    wardRentPerSqmYen: 3_000,
    landPriceMultiplier: 1,
    landPricePointCount: 5,
    source: "reins",
    sourcePeriod: "2026Q1",
    confidence: "high",
    label: RENT_LABEL,
    ...overrides,
  };
}

function makeCommute(overrides: Partial<CommuteEstimateResult> = {}): CommuteEstimateResult {
  return {
    totalMinutes: 30,
    accessWalkMinutes: 8,
    railMinutes: 18,
    waitMinutes: 4,
    transferCount: 0,
    transferPenaltyMinutes: 0,
    destinationWalkMinutes: 0,
    confidence: "high",
    label: COMMUTE_LABEL,
    path: [],
    ...overrides,
  };
}

function makeLifestyle(overrides: Partial<LifestyleMetricsInput> = {}): LifestyleMetricsInput {
  return {
    normAmenitySupermarket: 50,
    normAmenityRestaurant: 50,
    normQuietness: 50,
    normAmenityConvenience: 50,
    normAmenityCuisineVariety: 50,
    normGreenSpace: 50,
    normAmenityLateNight: 50,
    normAmenityHealth: 50,
    supermarketCount: 5,
    restaurantCount: 10,
    cafeCount: 2,
    convenienceCount: 3,
    cuisineVarietyCount: 4,
    greenSpaceShare: 0.2,
    lateNightCount: 2,
    healthCount: 1,
    sourceDate: "2025-01-01",
    confidence: "medium",
    ...overrides,
  };
}

function makeCandidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    stationGroupId: "sg-1",
    nameEn: "Test Station",
    nameJa: "テスト駅",
    wardCode: "13101",
    wardNameEn: "Test Ward",
    wardNameJa: "テスト区",
    centroid: { lat: 35.6, lon: 139.7 },
    rent: makeRent(),
    commute: makeCommute(),
    lifestyle: makeLifestyle(),
    isDestinationAccessStation: false,
    ...overrides,
  };
}

function makeRequest(overrides: Partial<OptimizationRequest> = {}): OptimizationRequest {
  return {
    destinationStationGroupId: "sg-dest",
    arrivalTime: "09:00",
    monthlyBudgetYen: 200_000,
    layout: "1K",
    maxCommuteMinutes: 60,
    preferences: {
      konbini: "low",
      supermarkets: "low",
      restaurants: "low",
      quietness: "low",
    },
    ...overrides,
  };
}

function makeScored(overrides: {
  stationGroupId: string;
  overallScore: number;
  totalMinutes: number;
  medianYen: number;
}): ScoredCandidate {
  return {
    stationGroupId: overrides.stationGroupId,
    nameEn: overrides.stationGroupId,
    nameJa: overrides.stationGroupId,
    wardCode: "13101",
    wardNameEn: "Test Ward",
    wardNameJa: "テスト区",
    centroid: { lat: 35.6, lon: 139.7 },
    overallScore: overrides.overallScore,
    rent: makeRent({ medianYen: overrides.medianYen }),

    commute: {
      ...makeCommute({ totalMinutes: overrides.totalMinutes }),
      path: [] as {
        stationGroupId: string;
        nameEn: string;
        nameJa: string;
        lineName: string | null;
      }[],
    },
    factors: [],
    reasonsFor: [],
    reasonsAgainst: [],
    catchmentLabel: CATCHMENT_LABEL,
    isDestinationAccessStation: false,
  };
}

function makeFactor(
  overrides: Partial<FactorEvidence> & Pick<FactorEvidence, "key">,
): FactorEvidence {
  return {
    label: overrides.key,
    rawValue: 0,
    rawValueLabel: `${overrides.key} raw`,
    componentScore: 50,
    effectiveWeight: 0.1,
    pointContribution: 5,
    sourceDate: null,
    confidence: "medium",
    explanation: `${overrides.key} explanation`,
    direction: "neutral",
    ...overrides,
  };
}

describe("scoreAffordability", () => {
  const budget = 200_000;

  it("scores exactly 100 at 80% of budget (the full-score threshold)", () => {
    expect(scoreAffordability(160_000, budget)).toBe(100);
  });

  it("scores exactly 0 at the budget", () => {
    expect(scoreAffordability(200_000, budget)).toBe(0);
  });

  it("scores exactly 50 at 90% of budget (midpoint of the linear region)", () => {
    expect(scoreAffordability(180_000, budget)).toBe(50);
  });

  it("scores exactly 0 above budget", () => {
    expect(scoreAffordability(250_000, budget)).toBe(0);
  });
});

describe("scoreCommute", () => {
  const maxCommuteMinutes = 45;

  it("scores exactly 100 at 15 minutes", () => {
    expect(scoreCommute(15, maxCommuteMinutes)).toBe(100);
  });

  it("scores exactly 0 at the max", () => {
    expect(scoreCommute(45, maxCommuteMinutes)).toBe(0);
  });

  it("scores exactly 50 at the midpoint between 15 and max", () => {
    expect(scoreCommute(30, maxCommuteMinutes)).toBe(50);
  });
});

describe("scoreLifestyle weight normalization", () => {
  it("all four preferences 'low' -> each effective lifestyle share is exactly 0.25 (0.10 of overall)", () => {
    const request = makeRequest();
    const { factors } = scoreLifestyle(makeLifestyle(), request.preferences);

    expect(factors).toHaveLength(4);
    for (const f of factors) {
      expect(f.effectiveWeight).toBe(0.1);
    }
  });

  it("one 'essential' + three 'low' -> shares are exactly 8/11, 1/11, 1/11, 1/11", () => {
    const preferences = {
      konbini: "essential",
      supermarkets: "low",
      restaurants: "low",
      quietness: "low",
    } as const;
    const { factors } = scoreLifestyle(makeLifestyle(), preferences);
    const byKey = Object.fromEntries(factors.map((f) => [f.key, f]));

    expect(byKey["konbini"]!.effectiveWeight).toBeCloseTo(0.290909090909, 10);
    expect(byKey["konbini"]!.effectiveWeight * 11).toBeCloseTo(0.4 * 8, 10);

    for (const key of ["supermarkets", "restaurants", "quietness"] as const) {
      expect(byKey[key]!.effectiveWeight).toBeCloseTo(0.036363636364, 10);
      expect(byKey[key]!.effectiveWeight * 11).toBeCloseTo(0.4 * 1, 10);
    }
  });
});

describe("scoreLifestyle axis selection", () => {
  it("omits an unrated axis entirely rather than weighting it zero", () => {
    const { factors } = scoreLifestyle(makeLifestyle(), {
      konbini: "low",
      quietness: "essential",
    });

    expect(factors.map((f) => f.key)).toEqual(["quietness", "konbini"]);
  });

  it("keeps lifestyle at the full 40% when only one axis is rated", () => {
    const { score, factors } = scoreLifestyle(makeLifestyle({ normQuietness: 70 }), {
      quietness: "low",
    });

    expect(factors).toHaveLength(1);
    expect(factors[0]!.effectiveWeight).toBe(0.4);
    expect(factors[0]!.pointContribution).toBe(28); // 70 * 0.4
    expect(score).toBe(70);
  });

  it("returns a zero score and no factors when no axis is rated (never NaN)", () => {
    const { score, factors } = scoreLifestyle(makeLifestyle(), {});

    expect(score).toBe(0);
    expect(Number.isNaN(score)).toBe(false);
    expect(factors).toEqual([]);
  });

  it("keeps overallScore finite and rank order intact when no axis is rated", () => {
    const request = makeRequest({ preferences: {} });
    const cheap = scoreCandidate(
      makeCandidate({ stationGroupId: "sg-cheap", rent: makeRent({ medianYen: 100_000 }) }),
      request,
    );
    const pricey = scoreCandidate(
      makeCandidate({ stationGroupId: "sg-pricey", rent: makeRent({ medianYen: 190_000 }) }),
      request,
    );

    expect(Number.isFinite(cheap.overallScore)).toBe(true);
    expect(Number.isFinite(pricey.overallScore)).toBe(true);
    expect(cheap.factors.map((f) => f.key)).toEqual(["affordability", "commute"]);
    expect(rankCandidates([pricey, cheap]).map((c) => c.stationGroupId)).toEqual([
      "sg-cheap",
      "sg-pricey",
    ]);
  });
});

describe("scoreCandidate — fully worked example", () => {
  const request = makeRequest({
    monthlyBudgetYen: 200_000,
    maxCommuteMinutes: 45,
    preferences: {
      konbini: "medium",
      supermarkets: "high",
      restaurants: "low",
      quietness: "low",
    },
  });

  const candidate = makeCandidate({
    rent: makeRent({ medianYen: 140_000 }),
    commute: makeCommute({ totalMinutes: 30 }),
    lifestyle: makeLifestyle({
      normAmenityConvenience: 80,
      normAmenitySupermarket: 90,
      normAmenityRestaurant: 40,
      normQuietness: 60,
      supermarketCount: 12,
      restaurantCount: 15,
      cafeCount: 3,
    }),
  });

  const result = scoreCandidate(candidate, request);
  const byKey = Object.fromEntries(result.factors.map((f) => [f.key, f]));

  it("computes each factor's componentScore, effectiveWeight, and pointContribution exactly", () => {
    expect(byKey["affordability"]!.componentScore).toBe(100);
    expect(byKey["affordability"]!.effectiveWeight).toBe(0.3);
    expect(byKey["affordability"]!.pointContribution).toBe(30);
    expect(byKey["affordability"]!.rawValueLabel).toBe("¥140,000 modeled area rent");

    expect(byKey["commute"]!.componentScore).toBe(50);
    expect(byKey["commute"]!.effectiveWeight).toBe(0.3);
    expect(byKey["commute"]!.pointContribution).toBe(15);
    expect(byKey["commute"]!.rawValueLabel).toBe("30 min typical weekday estimate");

    expect(byKey["konbini"]!.effectiveWeight).toBe(0.1);
    expect(byKey["konbini"]!.pointContribution).toBe(8);

    expect(byKey["supermarkets"]!.effectiveWeight).toBe(0.2);
    expect(byKey["supermarkets"]!.pointContribution).toBe(18);
    expect(byKey["supermarkets"]!.rawValueLabel).toBe("12 supermarkets within 800 m");

    expect(byKey["restaurants"]!.effectiveWeight).toBe(0.05);
    expect(byKey["restaurants"]!.pointContribution).toBe(2);
    expect(byKey["restaurants"]!.rawValueLabel).toBe("18 restaurants and cafés within 800 m");

    expect(byKey["quietness"]!.effectiveWeight).toBe(0.05);
    expect(byKey["quietness"]!.pointContribution).toBe(3);
  });

  it("sums the six point contributions to exactly the overall score (76)", () => {
    const sum = result.factors.reduce((s, f) => s + f.pointContribution, 0);
    expect(sum).toBe(76);
    expect(result.overallScore).toBe(76);
  });

  it("wires buildReasons(factors) end-to-end with weighted lifestyle reasons", () => {
    expect(result.reasonsFor).toEqual([
      "Affordability is a strength: ¥140,000 modeled area rent.",
      "Supermarkets is a strength: 12 supermarkets within 800 m.",
      "Konbini is a strength: 3 convenience stores within 800 m.",
    ]);
    expect(result.reasonsAgainst).toEqual([]);
  });

  it("does not use any forbidden rent language anywhere in generated strings", () => {
    const strings = [
      ...result.factors.map((f) => f.rawValueLabel),
      ...result.factors.map((f) => f.explanation),
      ...result.reasonsFor,
      ...result.reasonsAgainst,
    ].join(" ");
    expect(strings).not.toMatch(/available rent|listing|for rent/i);
    expect(strings).toContain(RENT_LABEL);
  });
});

describe("scoreCandidate — point contributions sum to overallScore across several candidates", () => {
  const request = makeRequest({
    monthlyBudgetYen: 300_000,
    maxCommuteMinutes: 90,
    preferences: {
      konbini: "medium",
      supermarkets: "medium",
      restaurants: "medium",
      quietness: "low",
    },
  });

  const cases: Candidate[] = [
    makeCandidate({
      stationGroupId: "sg-a",
      rent: makeRent({ medianYen: 100_000 }),
      commute: makeCommute({ totalMinutes: 10 }),
      lifestyle: makeLifestyle({
        normAmenityConvenience: 20,
        normAmenitySupermarket: 30,
        normAmenityRestaurant: 40,
        normQuietness: 90,
      }),
    }),
    makeCandidate({
      stationGroupId: "sg-b",
      rent: makeRent({ medianYen: 290_000 }),
      commute: makeCommute({ totalMinutes: 85 }),
      lifestyle: makeLifestyle({
        normAmenityConvenience: 5,
        normAmenitySupermarket: 5,
        normAmenityRestaurant: 5,
        normQuietness: 5,
      }),
    }),
    makeCandidate({
      stationGroupId: "sg-c",
      rent: makeRent({ medianYen: 200_000 }),
      commute: makeCommute({ totalMinutes: 45 }),
      lifestyle: makeLifestyle({
        normAmenityConvenience: 100,
        normAmenitySupermarket: 0,
        normAmenityRestaurant: 100,
        normQuietness: 0,
      }),
    }),
  ];

  it.each(cases.map((c) => [c.stationGroupId, c] as const))(
    "%s: sum(factors[].pointContribution) === overallScore",
    (_id, candidate) => {
      const result = scoreCandidate(candidate, request);
      const sum = result.factors.reduce((s, f) => s + f.pointContribution, 0);

      expect(sum).toBeCloseTo(result.overallScore, 9);
    },
  );
});

describe("scoreCandidate — reconciliation on a non-boundary score", () => {
  const request = makeRequest({
    monthlyBudgetYen: 300_000,
    maxCommuteMinutes: 50,
    preferences: {
      konbini: "high",
      supermarkets: "medium",
      restaurants: "medium",
      quietness: "low",
    },
  });

  const candidate = makeCandidate({
    rent: makeRent({ medianYen: 205_000 }),
    commute: makeCommute({ totalMinutes: 27 }),
    lifestyle: makeLifestyle({
      normAmenityConvenience: 55,
      normAmenitySupermarket: 77,
      normAmenityRestaurant: 32,
      normQuietness: 61,
    }),
  });

  const result = scoreCandidate(candidate, request);
  const byKey = Object.fromEntries(result.factors.map((f) => [f.key, f]));

  it("rounds each pointContribution to one decimal at construction", () => {
    expect(byKey["affordability"]!.pointContribution).toBeCloseTo(30, 10);
    expect(byKey["commute"]!.pointContribution).toBeCloseTo(19.7, 10);
    expect(byKey["konbini"]!.pointContribution).toBeCloseTo(9.8, 10);
    expect(byKey["supermarkets"]!.pointContribution).toBeCloseTo(6.8, 10);
    expect(byKey["restaurants"]!.pointContribution).toBeCloseTo(2.8, 10);
    expect(byKey["quietness"]!.pointContribution).toBeCloseTo(2.7, 10);
  });

  it("overallScore is exactly the sum of the rounded contributions (71.8), not a round of the raw total", () => {
    expect(result.overallScore).toBe(71.8);

    const sum = result.factors.reduce((s, f) => s + f.pointContribution, 0);

    expect(sum).toBe(result.overallScore);

    const rawSum =
      (475 / 6) * 0.3 +
      (460 / 7) * 0.3 +
      55 * (8 / 45) +
      77 * (4 / 45) +
      32 * (4 / 45) +
      61 * (2 / 45);
    expect(Math.abs(rawSum - result.overallScore)).toBeGreaterThan(0.04);
  });
});

describe("scoreCandidate — overallScore never exceeds 100 despite per-factor rounding drift", () => {
  const request = makeRequest({
    monthlyBudgetYen: 200_000,
    maxCommuteMinutes: 60,
    preferences: {
      konbini: "low",
      supermarkets: "low",
      restaurants: "high",
      quietness: "essential",
    },
  });

  const candidate = makeCandidate({
    rent: makeRent({ medianYen: 100_000 }), // <= 0.6*200,000 -> affordability = 100
    commute: makeCommute({ totalMinutes: 10 }), // <= 15 -> commute = 100
    lifestyle: makeLifestyle({
      normAmenityConvenience: 100,
      normAmenitySupermarket: 100,
      normAmenityRestaurant: 100,
      normQuietness: 100,
    }),
  });

  it("the unclamped sum of rounded contributions would be 100.1", () => {
    const result = scoreCandidate(candidate, request);
    const sum = result.factors.reduce((s, f) => s + f.pointContribution, 0);
    expect(sum).toBeCloseTo(100.1, 10);
  });

  it("overallScore is clamped to exactly 100, not 100.1", () => {
    const result = scoreCandidate(candidate, request);
    expect(result.overallScore).toBe(100);
  });
});

describe("scoreCandidate — overallScore stays within [0, 100] generally", () => {
  it.each([
    ["all-low, min inputs", "low", "low", "low", "low", 0, 0, 0, 0] as const,
    [
      "all-essential, max inputs",
      "essential",
      "essential",
      "essential",
      "essential",
      100,
      100,
      100,
      100,
    ] as const,
    ["mixed", "medium", "high", "essential", "low", 73, 12, 88, 40] as const,
  ])("%s", (_label, konbini, supermarkets, restaurants, quietness, nk, ns, nr, nq) => {
    const request = makeRequest({
      monthlyBudgetYen: 200_000,
      maxCommuteMinutes: 60,
      preferences: { konbini, supermarkets, restaurants, quietness },
    });
    const candidate = makeCandidate({
      rent: makeRent({ medianYen: 100_000 }),
      commute: makeCommute({ totalMinutes: 10 }),
      lifestyle: makeLifestyle({
        normAmenityConvenience: nk,
        normAmenitySupermarket: ns,
        normAmenityRestaurant: nr,
        normQuietness: nq,
      }),
    });
    const result = scoreCandidate(candidate, request);
    expect(result.overallScore).toBeGreaterThanOrEqual(0);
    expect(result.overallScore).toBeLessThanOrEqual(100);
  });
});

describe("applyHardFilters", () => {
  it("excludes an over-budget candidate and counts it under rent", () => {
    const request = makeRequest({ monthlyBudgetYen: 200_000, maxCommuteMinutes: 60 });
    const candidate = makeCandidate({
      rent: makeRent({ medianYen: 250_000 }),
      commute: makeCommute({ totalMinutes: 30 }),
    });

    const { feasible, diagnostics } = applyHardFilters([candidate], request);

    expect(feasible).toHaveLength(0);
    expect(diagnostics.excludedByRent).toBe(1);
    expect(diagnostics.excludedByCommute).toBe(0);
    expect(diagnostics.excludedByDisconnected).toBe(0);
  });

  it("excludes an over-cap commute candidate and counts it under commute", () => {
    const request = makeRequest({ monthlyBudgetYen: 200_000, maxCommuteMinutes: 60 });
    const candidate = makeCandidate({
      rent: makeRent({ medianYen: 100_000 }),
      commute: makeCommute({ totalMinutes: 90 }),
    });

    const { feasible, diagnostics } = applyHardFilters([candidate], request);

    expect(feasible).toHaveLength(0);
    expect(diagnostics.excludedByCommute).toBe(1);
    expect(diagnostics.excludedByRent).toBe(0);
  });

  it("a disconnected candidate is counted under disconnected and NOT double-counted, even when it would also fail commute/rent", () => {
    const request = makeRequest({ monthlyBudgetYen: 200_000, maxCommuteMinutes: 60 });
    const candidate = makeCandidate({
      rent: makeRent({ medianYen: 999_999 }),
      commute: null,
    });

    const { diagnostics } = applyHardFilters([candidate], request);

    expect(diagnostics.excludedByDisconnected).toBe(1);
    expect(diagnostics.excludedByCommute).toBe(0);
    expect(diagnostics.excludedByRent).toBe(0);
  });

  it("counts reconcile: excludedByDisconnected + excludedByCommute + excludedByRent + feasibleCount === candidatesConsidered", () => {
    const request = makeRequest({ monthlyBudgetYen: 200_000, maxCommuteMinutes: 60 });
    const candidates = [
      makeCandidate({ stationGroupId: "feasible-1" }), // rent 120k, commute 30 -> feasible
      makeCandidate({
        stationGroupId: "rent-excluded",
        rent: makeRent({ medianYen: 250_000 }),
        commute: makeCommute({ totalMinutes: 30 }),
      }),
      makeCandidate({
        stationGroupId: "commute-excluded",

        rent: makeRent({ medianYen: 300_000 }),
        commute: makeCommute({ totalMinutes: 90 }),
      }),
      makeCandidate({
        stationGroupId: "disconnected",

        rent: makeRent({ medianYen: 999_999 }),
        commute: null,
      }),
      makeCandidate({ stationGroupId: "feasible-2" }), // rent 120k, commute 30 -> feasible
    ];

    const { feasible, diagnostics } = applyHardFilters(candidates, request);

    expect(diagnostics.candidatesConsidered).toBe(5);
    expect(diagnostics.excludedByDisconnected).toBe(1);
    expect(diagnostics.excludedByCommute).toBe(1);
    expect(diagnostics.excludedByRent).toBe(1);
    expect(diagnostics.feasibleCount).toBe(2);
    expect(
      diagnostics.excludedByDisconnected +
        diagnostics.excludedByCommute +
        diagnostics.excludedByRent +
        diagnostics.feasibleCount,
    ).toBe(diagnostics.candidatesConsidered);
    expect(feasible.map((c) => c.stationGroupId).sort()).toEqual(["feasible-1", "feasible-2"]);
    expect(diagnostics.suggestion).toBeNull();
  });

  it("an 'essential' preference does not remove any candidate from feasible", () => {
    const request = makeRequest({
      monthlyBudgetYen: 200_000,
      maxCommuteMinutes: 60,
      preferences: {
        konbini: "essential",
        supermarkets: "essential",
        restaurants: "essential",
        quietness: "essential",
      },
    });

    const candidate = makeCandidate({
      rent: makeRent({ medianYen: 100_000 }),
      commute: makeCommute({ totalMinutes: 30 }),
      lifestyle: makeLifestyle({
        normAmenityConvenience: 0,
        normAmenitySupermarket: 0,
        normAmenityRestaurant: 0,
        normQuietness: 0,
      }),
    });

    const { feasible, diagnostics } = applyHardFilters([candidate], request);

    expect(feasible).toHaveLength(1);
    expect(diagnostics.feasibleCount).toBe(1);
    expect(diagnostics.excludedByDisconnected).toBe(0);
    expect(diagnostics.excludedByCommute).toBe(0);
    expect(diagnostics.excludedByRent).toBe(0);
  });

  describe("empty result suggestion", () => {
    it("names rent as the dominant reason and derives the suggested budget from the 25th percentile of excluded medians", () => {
      const request = makeRequest({ monthlyBudgetYen: 100_000, maxCommuteMinutes: 60 });
      const medians = [150_000, 160_000, 140_000, 155_000];
      const candidates = medians.map((medianYen, i) =>
        makeCandidate({
          stationGroupId: `sg-${i}`,
          rent: makeRent({ medianYen }),
          commute: makeCommute({ totalMinutes: 30 }),
        }),
      );

      const { diagnostics } = applyHardFilters(candidates, request);

      expect(diagnostics.feasibleCount).toBe(0);
      expect(diagnostics.excludedByRent).toBe(4);
      expect(diagnostics.suggestion).toBe(
        "No areas fit. Rent excluded 4 of 4 areas — try raising the budget to about ¥148,000.",
      );
    });

    it("names commute as the dominant reason and derives the suggested minutes from the 25th percentile of excluded commute minutes", () => {
      const request = makeRequest({ monthlyBudgetYen: 500_000, maxCommuteMinutes: 30 });
      const minutes = [40, 50, 45, 60];
      const candidates = minutes.map((totalMinutes, i) =>
        makeCandidate({
          stationGroupId: `sg-${i}`,
          rent: makeRent({ medianYen: 100_000 }),
          commute: makeCommute({ totalMinutes }),
        }),
      );

      const { diagnostics } = applyHardFilters(candidates, request);

      expect(diagnostics.feasibleCount).toBe(0);
      expect(diagnostics.excludedByCommute).toBe(4);
      expect(diagnostics.suggestion).toBe(
        "No areas fit. Commute excluded 4 of 4 areas — try raising the max commute to about 44 minutes.",
      );
    });

    it("names disconnected as the dominant reason when every candidate is unreachable", () => {
      const request = makeRequest({ monthlyBudgetYen: 500_000, maxCommuteMinutes: 90 });
      const candidates = [0, 1, 2].map((i) =>
        makeCandidate({ stationGroupId: `sg-${i}`, commute: null }),
      );

      const { diagnostics } = applyHardFilters(candidates, request);

      expect(diagnostics.feasibleCount).toBe(0);
      expect(diagnostics.excludedByDisconnected).toBe(3);
      expect(diagnostics.suggestion).toBe(
        "No areas fit. No commute route was found for 3 of 3 areas — try a different destination station or arrival time.",
      );
    });
  });
});

describe("rankCandidates", () => {
  it("sorts by overallScore desc, then commute asc, then rent median asc, assigning rank from 1", () => {
    const a = makeScored({
      stationGroupId: "a",
      overallScore: 80,
      totalMinutes: 30,
      medianYen: 100_000,
    });
    const b = makeScored({
      stationGroupId: "b",
      overallScore: 80,
      totalMinutes: 20,
      medianYen: 90_000,
    });
    const c = makeScored({
      stationGroupId: "c",
      overallScore: 80,
      totalMinutes: 20,
      medianYen: 80_000,
    });
    const d = makeScored({
      stationGroupId: "d",
      overallScore: 90,
      totalMinutes: 999,
      medianYen: 999_999,
    });

    const ranked = rankCandidates([a, b, c, d]);

    expect(ranked.map((r) => r.stationGroupId)).toEqual(["d", "c", "b", "a"]);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3, 4]);
  });
});

describe("factor direction thresholds", () => {
  it("is neutral exactly at the 66 boundary, positive just above it", () => {
    const preferences = makeRequest().preferences;
    const { factors: atBoundary } = scoreLifestyle(
      makeLifestyle({ normAmenityConvenience: 66 }),
      preferences,
    );
    const { factors: justAbove } = scoreLifestyle(
      makeLifestyle({ normAmenityConvenience: 67 }),
      preferences,
    );

    expect(atBoundary.find((f) => f.key === "konbini")!.direction).toBe("neutral");
    expect(justAbove.find((f) => f.key === "konbini")!.direction).toBe("positive");
  });

  it("is neutral exactly at the 34 boundary, negative just below it", () => {
    const preferences = makeRequest().preferences;
    const { factors: atBoundary } = scoreLifestyle(
      makeLifestyle({ normAmenityConvenience: 34 }),
      preferences,
    );
    const { factors: justBelow } = scoreLifestyle(
      makeLifestyle({ normAmenityConvenience: 33 }),
      preferences,
    );

    expect(atBoundary.find((f) => f.key === "konbini")!.direction).toBe("neutral");
    expect(justBelow.find((f) => f.key === "konbini")!.direction).toBe("negative");
  });
});

describe("scoreCandidate", () => {
  it("throws when handed a disconnected candidate (a caller bug — applyHardFilters should have removed it)", () => {
    const request = makeRequest();
    const candidate = makeCandidate({ commute: null });
    expect(() => scoreCandidate(candidate, request)).toThrow(/disconnected/i);
  });
});

describe("buildReasons", () => {
  it("selects up to three reasonsFor and reasonsAgainst, sorted by effective weight then gap size", () => {
    const alpha = makeFactor({
      key: "alpha",
      label: "Alpha",
      componentScore: 90, // gap = 0.90-0.66 = 0.24
      effectiveWeight: 0.3,
      rawValueLabel: "alpha raw",
    });
    const bravo = makeFactor({
      key: "bravo",
      label: "Bravo",
      componentScore: 95, // gap = 0.29 (largest gap, smallest weight)
      effectiveWeight: 0.1,
      rawValueLabel: "bravo raw",
    });
    const charlie = makeFactor({
      key: "charlie",
      label: "Charlie",
      componentScore: 70, // gap = 0.04
      effectiveWeight: 0.2,
      rawValueLabel: "charlie raw",
    });
    const delta = makeFactor({
      key: "delta",
      label: "Delta",
      componentScore: 67, // gap = 0.01 (smallest gap, but LARGEST weight)
      effectiveWeight: 0.4,
      rawValueLabel: "delta raw",
    });

    const echo = makeFactor({
      key: "echo",
      label: "Echo",
      componentScore: 10, // gap = 0.34-0.10 = 0.24
      effectiveWeight: 0.3,
      rawValueLabel: "echo raw",
      direction: "negative",
    });
    const foxtrot = makeFactor({
      key: "foxtrot",
      label: "Foxtrot",
      componentScore: 5, // gap = 0.29
      effectiveWeight: 0.3,
      rawValueLabel: "foxtrot raw",
      direction: "negative",
    });
    const golf = makeFactor({
      key: "golf",
      label: "Golf",
      componentScore: 33, // gap = 0.01, but weight 0.5 wins on the primary key
      effectiveWeight: 0.5,
      rawValueLabel: "golf raw",
      direction: "negative",
    });

    const hotel = makeFactor({
      key: "hotel",
      label: "Hotel",
      componentScore: 50,
      effectiveWeight: 0.6,
      rawValueLabel: "hotel raw",
      direction: "neutral",
    });

    const positiveFactors = [alpha, bravo, charlie, delta].map((f) => ({
      ...f,
      direction: "positive" as const,
    }));

    const { reasonsFor, reasonsAgainst } = buildReasons([
      ...positiveFactors,
      echo,
      foxtrot,
      golf,
      hotel,
    ]);

    expect(reasonsFor).toEqual([
      "Delta is a strength: delta raw.",
      "Alpha is a strength: alpha raw.",
      "Charlie is a strength: charlie raw.",
    ]);
    expect(reasonsAgainst).toEqual([
      "Golf is a weakness: golf raw.",
      "Foxtrot is a weakness: foxtrot raw.",
      "Echo is a weakness: echo raw.",
    ]);
  });

  it("returns empty arrays when no factor crosses either threshold", () => {
    const neutral = makeFactor({ key: "n1", componentScore: 50, direction: "neutral" });
    const { reasonsFor, reasonsAgainst } = buildReasons([neutral]);
    expect(reasonsFor).toEqual([]);
    expect(reasonsAgainst).toEqual([]);
  });
});

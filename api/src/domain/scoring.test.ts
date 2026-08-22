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

// ---------------------------------------------------------------------------
// Fixture factories
// ---------------------------------------------------------------------------

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
    confidence: "high",
    label: COMMUTE_LABEL,
    path: [],
    ...overrides,
  };
}

function makeLifestyle(overrides: Partial<LifestyleMetricsInput> = {}): LifestyleMetricsInput {
  return {
    normFloodSafety: 50,
    normAmenitySupermarket: 50,
    normAmenityRestaurant: 50,
    normQuietness: 50,
    supermarketCount: 5,
    restaurantCount: 10,
    cafeCount: 2,
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
      floodSafety: "low",
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
    // See the matching comment in scoring.ts: convert the readonly `path`
    // array to a plain mutable one to match `NeighborhoodResult["commute"]`.
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
  };
}

/** Minimal but schema-complete FactorEvidence, for buildReasons unit tests. */
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

// ---------------------------------------------------------------------------
// scoreAffordability
// ---------------------------------------------------------------------------

describe("scoreAffordability", () => {
  const budget = 200_000;

  it("scores exactly 100 at 60% of budget (the full-score threshold)", () => {
    expect(scoreAffordability(120_000, budget)).toBe(100);
  });

  it("scores exactly 0 at the budget", () => {
    expect(scoreAffordability(200_000, budget)).toBe(0);
  });

  it("scores exactly 50 at 80% of budget (midpoint of the linear region)", () => {
    // By hand: threshold = 0.6*200000 = 120000. At 160000 (80% of budget):
    // 100*(200000-160000)/(200000-120000) = 100*40000/80000 = 50.
    expect(scoreAffordability(160_000, budget)).toBe(50);
  });

  it("scores exactly 0 above budget", () => {
    expect(scoreAffordability(250_000, budget)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// scoreCommute
// ---------------------------------------------------------------------------

describe("scoreCommute", () => {
  const maxCommuteMinutes = 45;

  it("scores exactly 100 at 15 minutes", () => {
    expect(scoreCommute(15, maxCommuteMinutes)).toBe(100);
  });

  it("scores exactly 0 at the max", () => {
    expect(scoreCommute(45, maxCommuteMinutes)).toBe(0);
  });

  it("scores exactly 50 at the midpoint between 15 and max", () => {
    // By hand: midpoint of [15, 45] is 30.
    // 100*(45-30)/(45-15) = 100*15/30 = 50.
    expect(scoreCommute(30, maxCommuteMinutes)).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// scoreLifestyle — weight normalization
// ---------------------------------------------------------------------------

describe("scoreLifestyle weight normalization", () => {
  it("all four preferences 'low' -> each effective lifestyle share is exactly 0.25 (0.10 of overall)", () => {
    const request = makeRequest();
    const { factors } = scoreLifestyle(makeLifestyle(), request.preferences);

    expect(factors).toHaveLength(4);
    for (const f of factors) {
      // share = 1/4 = 0.25 exactly (multiplying by the power-of-two 0.25
      // introduces no additional floating-point rounding).
      expect(f.effectiveWeight).toBe(0.1);
    }
  });

  it("one 'essential' + three 'low' -> shares are exactly 8/11, 1/11, 1/11, 1/11", () => {
    const preferences = {
      floodSafety: "essential",
      supermarkets: "low",
      restaurants: "low",
      quietness: "low",
    } as const;
    const { factors } = scoreLifestyle(makeLifestyle(), preferences);
    const byKey = Object.fromEntries(factors.map((f) => [f.key, f]));

    // By hand: total importance = 8 + 1 + 1 + 1 = 11.
    //   floodSafety share = 8/11 = 0.7272727272727273; effectiveWeight = 0.4 * 8/11 = 0.290909...
    //   the other three shares = 1/11 = 0.09090909090909091; effectiveWeight = 0.4 * 1/11 = 0.036363...
    // Verified two independent ways: a literal hand-computed decimal, and
    // cross-multiplication (effectiveWeight * 11 === 0.4 * importance),
    // which uses a different arithmetic path than the implementation
    // (division then multiplication) so it isn't just re-deriving the
    // same expression.
    expect(byKey["floodSafety"]!.effectiveWeight).toBeCloseTo(0.290909090909, 10);
    expect(byKey["floodSafety"]!.effectiveWeight * 11).toBeCloseTo(0.4 * 8, 10);

    for (const key of ["supermarkets", "restaurants", "quietness"] as const) {
      expect(byKey[key]!.effectiveWeight).toBeCloseTo(0.036363636364, 10);
      expect(byKey[key]!.effectiveWeight * 11).toBeCloseTo(0.4 * 1, 10);
    }
  });
});

// ---------------------------------------------------------------------------
// scoreCandidate — fully worked example (point contributions sum to overallScore)
// ---------------------------------------------------------------------------

describe("scoreCandidate — fully worked example", () => {
  // By hand, all six factors:
  //
  //   affordability: rent 140,000 vs budget 200,000.
  //     threshold = 0.6*200000 = 120000; 140000 is between 120000 and 200000.
  //     componentScore = 100*(200000-140000)/(200000-120000) = 100*60000/80000 = 75
  //     effectiveWeight = 0.3 -> contribution = 75*0.3 = 22.5
  //
  //   commute: 30 min vs cap 45 min.
  //     componentScore = 100*(45-30)/(45-15) = 100*15/30 = 50
  //     effectiveWeight = 0.3 -> contribution = 50*0.3 = 15
  //
  //   preferences: floodSafety=medium(2), supermarkets=high(4), restaurants=low(1), quietness=low(1)
  //     total importance = 2+4+1+1 = 8
  //     shares: floodSafety=2/8=0.25, supermarkets=4/8=0.5, restaurants=1/8=0.125, quietness=1/8=0.125
  //     effectiveWeights (0.4*share): floodSafety=0.1, supermarkets=0.2, restaurants=0.05, quietness=0.05
  //
  //   floodSafety: norm=80 -> contribution = 80*0.1 = 8
  //   supermarkets: norm=90 -> contribution = 90*0.2 = 18
  //   restaurants: norm=40 -> contribution = 40*0.05 = 2
  //   quietness: norm=60 -> contribution = 60*0.05 = 3
  //
  //   overallScore = 22.5 + 15 + 8 + 18 + 2 + 3 = 68.5

  const request = makeRequest({
    monthlyBudgetYen: 200_000,
    maxCommuteMinutes: 45,
    preferences: {
      floodSafety: "medium",
      supermarkets: "high",
      restaurants: "low",
      quietness: "low",
    },
  });

  const candidate = makeCandidate({
    rent: makeRent({ medianYen: 140_000 }),
    commute: makeCommute({ totalMinutes: 30 }),
    lifestyle: makeLifestyle({
      normFloodSafety: 80,
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
    expect(byKey["affordability"]!.componentScore).toBe(75);
    expect(byKey["affordability"]!.effectiveWeight).toBe(0.3);
    expect(byKey["affordability"]!.pointContribution).toBe(22.5);
    expect(byKey["affordability"]!.rawValueLabel).toBe("¥140,000 modeled area rent");

    expect(byKey["commute"]!.componentScore).toBe(50);
    expect(byKey["commute"]!.effectiveWeight).toBe(0.3);
    expect(byKey["commute"]!.pointContribution).toBe(15);
    expect(byKey["commute"]!.rawValueLabel).toBe("30 min typical weekday estimate");

    expect(byKey["floodSafety"]!.effectiveWeight).toBe(0.1);
    expect(byKey["floodSafety"]!.pointContribution).toBe(8);

    expect(byKey["supermarkets"]!.effectiveWeight).toBe(0.2);
    expect(byKey["supermarkets"]!.pointContribution).toBe(18);
    expect(byKey["supermarkets"]!.rawValueLabel).toBe("12 supermarkets within 800 m");

    expect(byKey["restaurants"]!.effectiveWeight).toBe(0.05);
    expect(byKey["restaurants"]!.pointContribution).toBe(2);
    expect(byKey["restaurants"]!.rawValueLabel).toBe("18 restaurants and cafés within 800 m");

    expect(byKey["quietness"]!.effectiveWeight).toBe(0.05);
    expect(byKey["quietness"]!.pointContribution).toBe(3);
  });

  it("sums the six point contributions to exactly the overall score (68.5)", () => {
    const sum = result.factors.reduce((s, f) => s + f.pointContribution, 0);
    expect(sum).toBe(68.5);
    expect(result.overallScore).toBe(68.5);
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
  const request = makeRequest({ monthlyBudgetYen: 300_000, maxCommuteMinutes: 90 });

  const cases: Candidate[] = [
    makeCandidate({
      stationGroupId: "sg-a",
      rent: makeRent({ medianYen: 100_000 }),
      commute: makeCommute({ totalMinutes: 10 }),
      lifestyle: makeLifestyle({
        normFloodSafety: 20,
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
        normFloodSafety: 5,
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
        normFloodSafety: 100,
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

// ---------------------------------------------------------------------------
// applyHardFilters
// ---------------------------------------------------------------------------

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
      // Would also fail rent if it were ever checked — proves disconnected
      // truly short-circuits before the other two rules run.
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
        // Also over budget, to prove commute wins the first-match race.
        rent: makeRent({ medianYen: 300_000 }),
        commute: makeCommute({ totalMinutes: 90 }),
      }),
      makeCandidate({
        stationGroupId: "disconnected",
        // Also over budget, to prove disconnected wins the first-match race.
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
        floodSafety: "essential",
        supermarkets: "essential",
        restaurants: "essential",
        quietness: "essential",
      },
    });
    // Worst possible lifestyle metrics — an essential preference must not
    // turn into a filter no matter how bad the underlying data is.
    const candidate = makeCandidate({
      rent: makeRent({ medianYen: 100_000 }),
      commute: makeCommute({ totalMinutes: 30 }),
      lifestyle: makeLifestyle({
        normFloodSafety: 0,
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

      // By hand: sorted medians = [140000, 150000, 155000, 160000].
      // 25th percentile (linear interpolation, n=4): idx = 0.25*(4-1) = 0.75
      //   lower=140000 (index 0), upper=150000 (index 1), weight=0.75
      //   value = 140000 + (150000-140000)*0.75 = 140000 + 7500 = 147500
      // Rounded to the nearest ¥1,000 -> 148,000 (Math.round(147.5) = 148).
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

      // By hand: sorted minutes = [40, 45, 50, 60].
      // 25th percentile: idx = 0.25*3 = 0.75, lower=40, upper=45, weight=0.75
      //   value = 40 + (45-40)*0.75 = 40 + 3.75 = 43.75 -> rounds to 44.
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

// ---------------------------------------------------------------------------
// rankCandidates
// ---------------------------------------------------------------------------

describe("rankCandidates", () => {
  it("sorts by overallScore desc, then commute asc, then rent median asc, assigning rank from 1", () => {
    const a = makeScored({
      stationGroupId: "a",
      overallScore: 80,
      totalMinutes: 30,
      medianYen: 100_000,
    });
    const b = makeScored({
      // Same score as a, shorter commute -> ranks above a.
      stationGroupId: "b",
      overallScore: 80,
      totalMinutes: 20,
      medianYen: 90_000,
    });
    const c = makeScored({
      // Same score and commute as b, cheaper rent -> ranks above b.
      stationGroupId: "c",
      overallScore: 80,
      totalMinutes: 20,
      medianYen: 80_000,
    });
    const d = makeScored({
      // Highest score wins regardless of the (deliberately terrible)
      // commute/rent tiebreaker values.
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

// ---------------------------------------------------------------------------
// buildReasons
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// direction classification boundaries (exercised through scoreLifestyle)
// ---------------------------------------------------------------------------

describe("factor direction thresholds", () => {
  it("is neutral exactly at the 66 boundary, positive just above it", () => {
    const preferences = makeRequest().preferences;
    const { factors: atBoundary } = scoreLifestyle(
      makeLifestyle({ normFloodSafety: 66 }),
      preferences,
    );
    const { factors: justAbove } = scoreLifestyle(
      makeLifestyle({ normFloodSafety: 67 }),
      preferences,
    );

    expect(atBoundary.find((f) => f.key === "floodSafety")!.direction).toBe("neutral");
    expect(justAbove.find((f) => f.key === "floodSafety")!.direction).toBe("positive");
  });

  it("is neutral exactly at the 34 boundary, negative just below it", () => {
    const preferences = makeRequest().preferences;
    const { factors: atBoundary } = scoreLifestyle(
      makeLifestyle({ normFloodSafety: 34 }),
      preferences,
    );
    const { factors: justBelow } = scoreLifestyle(
      makeLifestyle({ normFloodSafety: 33 }),
      preferences,
    );

    expect(atBoundary.find((f) => f.key === "floodSafety")!.direction).toBe("neutral");
    expect(justBelow.find((f) => f.key === "floodSafety")!.direction).toBe("negative");
  });
});

// ---------------------------------------------------------------------------
// scoreCandidate defensive guard
// ---------------------------------------------------------------------------

describe("scoreCandidate", () => {
  it("throws when handed a disconnected candidate (a caller bug — applyHardFilters should have removed it)", () => {
    const request = makeRequest();
    const candidate = makeCandidate({ commute: null });
    expect(() => scoreCandidate(candidate, request)).toThrow(/disconnected/i);
  });
});

describe("buildReasons", () => {
  it("selects up to three reasonsFor and reasonsAgainst, sorted by effective weight then gap size", () => {
    // Positive factors (componentScore > 66): Delta has the smallest gap
    // above 66 but the largest weight, so it must still rank first.
    // Bravo has the largest gap but the smallest weight, so it must be
    // DROPPED (only 3 of the 4 positive factors fit).
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

    // Negative factors (componentScore < 34): Golf has the highest weight
    // and wins outright; Foxtrot and Echo tie on weight (0.3) and are
    // broken by gap size (Foxtrot's gap of 0.29 beats Echo's 0.24).
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

    // A neutral factor must appear in neither list.
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

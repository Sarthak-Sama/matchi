import { describe, expect, it } from "vitest";

import type { FactorEvidence, NeighborhoodResult } from "@tokyo/shared";

import {
  bilingualLabel,
  commuteDisplayTerms,
  deriveResultsSummary,
  formatYenCompact,
  googleMapsUrl,
  localitySecondaryLabel,
  pickCompromise,
  pickStrength,
  wardDisplayName,
} from "./format";

function factor(overrides: Partial<FactorEvidence> & { key: string }): FactorEvidence {
  return {
    label: overrides.key,
    rawValue: 0,
    rawValueLabel: `${overrides.key} raw value`,
    componentScore: 50,
    effectiveWeight: 1,
    pointContribution: 0,
    sourceDate: null,
    confidence: "medium",
    explanation: `${overrides.key} explanation`,
    direction: "positive",
    ...overrides,
  };
}

function result(overrides: Partial<NeighborhoodResult> = {}): NeighborhoodResult {
  return {
    localityId: "13110:abc",
    nameEn: "五本木",
    nameJa: "五本木",
    wardCode: "13110",
    wardNameEn: "Meguro",
    wardNameJa: "目黒区",
    centroid: { lat: 35.63, lon: 139.68 },
    polygon: null,
    nearbyStations: [],
    catchmentLabel: "official town locality boundary (chōme combined)",
    rank: 1,
    overallScore: 90,
    rent: {
      lowYen: 99_444,
      medianYen: 129_786,
      highYen: 167_713,
      layout: "1LDK",
      assumedSizeSqmMin: 32,
      assumedSizeSqmMax: 45,
      assumedSizeSqmMid: 38,
      managementFeeYen: 4462,
      wardRentPerSqmYen: 3298,
      landPriceMultiplier: 1,
      landPricePointCount: 2,
      source: "estat",
      sourcePeriod: "2023",
      confidence: "low",
      label: "modeled area rent",
    },
    commute: {
      sampleNumber: 2,
      mode: "transit",
      totalMinutes: 15.79,
      rangeMinutes: { min: 13.98, max: 17.79 },
      accessWalkMinutes: 5,
      railMinutes: 6.79,
      waitMinutes: 4,
      transferCount: 0,
      transferPenaltyMinutes: 0,
      destinationWalkMinutes: 0,
      confidence: "low",
      label: "typical weekday estimate",
      path: [],
    },
    factors: [],
    reasonsFor: [],
    reasonsAgainst: [],
    ...overrides,
  } as NeighborhoodResult;
}

describe("bilingualLabel", () => {
  it("shows one name when both columns carry the same string", () => {
    expect(bilingualLabel("渋谷", "渋谷")).toBe("渋谷");
  });

  it("pairs a real romanization with the Japanese name", () => {
    expect(bilingualLabel("Yutenji", "祐天寺")).toBe("Yutenji (祐天寺)");
  });

  it("falls back to whichever name exists", () => {
    expect(bilingualLabel("Yutenji", null)).toBe("Yutenji");
    expect(bilingualLabel("", "祐天寺")).toBe("祐天寺");
  });
});

describe("pickStrength", () => {
  it("prefers a lifestyle factor over affordability and commute", () => {
    const strength = pickStrength(
      result({
        factors: [
          factor({ key: "affordability", componentScore: 100 }),
          factor({ key: "commute", componentScore: 97 }),
          factor({
            key: "supermarkets",
            componentScore: 100,
            rawValueLabel: "14 supermarkets within 800 m",
            explanation: "14 supermarkets within 800 m, weighted at 13.3% of your overall score.",
          }),
        ],
      }),
    );

    expect(strength?.short).toBe("14 supermarkets within 800 m");
    expect(strength?.text).toContain("weighted at 13.3%");
  });

  it("falls back to the API's own reason when no lifestyle axis was scored", () => {
    const strength = pickStrength(
      result({
        factors: [factor({ key: "affordability", componentScore: 100 })],
        reasonsFor: ["Affordability is a strength: ¥129,786 modeled area rent."],
      }),
    );

    expect(strength?.short).toBe("Affordability is a strength: ¥129,786 modeled area rent.");
  });

  it("returns null when there is nothing to say", () => {
    expect(pickStrength(result())).toBeNull();
  });
});

describe("pickCompromise", () => {
  it("uses a stated reason against when the API gives one", () => {
    const compromise = pickCompromise(
      result({ reasonsAgainst: ["Quietness is weak: 21/100 quietness proxy."] }),
    );

    expect(compromise).toEqual({
      text: "Quietness is weak: 21/100 quietness proxy.",
      short: "Quietness is weak: 21/100 quietness proxy.",
      derived: false,
    });
  });

  it("names the weakest component when the API states no reason against", () => {
    const compromise = pickCompromise(
      result({
        factors: [
          factor({ key: "supermarkets", label: "Supermarkets", componentScore: 100 }),
          factor({ key: "quietness", label: "Quietness", componentScore: 72 }),
        ],
      }),
    );

    expect(compromise?.derived).toBe(true);
    expect(compromise?.short).toBe("Quietness is the weakest component (72/100)");
    expect(compromise?.text).toContain("weakest part of the fit at 72 out of 100");
  });

  it("returns null when there are no factors to reason from", () => {
    expect(pickCompromise(result())).toBeNull();
  });
});

describe("commuteDisplayTerms", () => {
  it("makes the legs sum exactly to the displayed total", () => {
    const terms = commuteDisplayTerms(result().commute);

    expect(terms.accessWalk + terms.rail + terms.wait + terms.destinationWalk).toBe(terms.total);
  });
});

describe("deriveResultsSummary", () => {
  it("declines to characterize a shortlist too short to have a pattern", () => {
    expect(deriveResultsSummary([result(), result()], "渋谷")).toBeNull();
  });

  it("names the dominant ward when most matches share one", () => {
    const results = [
      result({ wardNameEn: "Meguro" }),
      result({ wardNameEn: "Meguro" }),
      result({ wardNameEn: "Setagaya" }),
    ];

    expect(deriveResultsSummary(results, "渋谷")).toContain("cluster in Meguro-ku");
  });
});

describe("localitySecondaryLabel", () => {
  it("joins the ward and the walk to the nearest station", () => {
    const label = localitySecondaryLabel(
      result({
        wardNameEn: "Shibuya",
        nearbyStations: [
          { stationGroupId: "s1", nameEn: "Hatsudai", nameJa: "初台", walkMinutes: 6 },
        ],
      }),
    );

    expect(label).toBe("Shibuya-ku · 6 min walk to Hatsudai Station");
  });

  it("falls back to the ward alone when there is no nearby station", () => {
    const label = localitySecondaryLabel(result({ wardNameEn: "Shibuya", nearbyStations: [] }));

    expect(label).toBe("Shibuya-ku");
  });

  it("uses the Japanese name when the station's nameEn is just a Japanese fallback", () => {
    const label = localitySecondaryLabel(
      result({
        wardNameEn: "Meguro",
        nearbyStations: [
          { stationGroupId: "s1", nameEn: "祐天寺", nameJa: "祐天寺", walkMinutes: 4 },
        ],
      }),
    );

    expect(label).toBe("Meguro-ku · 4 min walk to 祐天寺 Station");
  });

  it("does not double up when the resolved name already ends in Station or 駅", () => {
    const englishSuffix = localitySecondaryLabel(
      result({
        wardNameEn: "Chiyoda",
        nearbyStations: [
          { stationGroupId: "s1", nameEn: "Tokyo Station", nameJa: "東京駅", walkMinutes: 3 },
        ],
      }),
    );
    expect(englishSuffix).toBe("Chiyoda-ku · 3 min walk to Tokyo Station");

    const japaneseSuffix = localitySecondaryLabel(
      result({
        wardNameEn: "Shibuya",
        nearbyStations: [{ stationGroupId: "s1", nameEn: "", nameJa: "渋谷駅", walkMinutes: 2 }],
      }),
    );
    expect(japaneseSuffix).toBe("Shibuya-ku · 2 min walk to 渋谷駅");
  });

  it("picks the shortest walk even when it is not the first entry", () => {
    const label = localitySecondaryLabel(
      result({
        wardNameEn: "Shibuya",
        nearbyStations: [
          { stationGroupId: "s1", nameEn: "Yoyogi", nameJa: "代々木", walkMinutes: 9 },
          { stationGroupId: "s2", nameEn: "Hatsudai", nameJa: "初台", walkMinutes: 6 },
        ],
      }),
    );

    expect(label).toBe("Shibuya-ku · 6 min walk to Hatsudai Station");
  });

  it("rounds a fractional walk time", () => {
    const label = localitySecondaryLabel(
      result({
        wardNameEn: "Setagaya",
        nearbyStations: [
          { stationGroupId: "s1", nameEn: "Sangenjaya", nameJa: "三軒茶屋", walkMinutes: 5.6 },
        ],
      }),
    );

    expect(label).toBe("Setagaya-ku · 6 min walk to Sangenjaya Station");
  });
});

describe("formatting", () => {
  it("builds a Google Maps search URL for a neighborhood centroid", () => {
    expect(googleMapsUrl(35.63, 139.68)).toBe(
      "https://www.google.com/maps/search/?api=1&query=35.63%2C139.68",
    );
  });

  it("compacts yen to thousands and millions", () => {
    expect(formatYenCompact(168_000)).toBe("¥168k");
    expect(formatYenCompact(1_250_000)).toBe("¥1.3M");
  });

  it("adds the ward suffix only when it is missing", () => {
    expect(wardDisplayName("Meguro")).toBe("Meguro-ku");
    expect(wardDisplayName("Meguro City")).toBe("Meguro-ku");
    expect(wardDisplayName("Meguro-ku")).toBe("Meguro-ku");
  });
});

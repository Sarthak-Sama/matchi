/**
 * Tests for the N02 -> `rail_lines.mode` classifier. Every case below uses
 * an operator/class combination that actually occurs in the 2025 N02
 * export inside the Tokyo bounding box.
 */

import { describe, expect, it } from "vitest";

import { classifyRailMode } from "./rail-mode.js";

function input(railwayClass: string, operatorType: string, operator: string) {
  return { railwayClass, operatorType, operator };
}

describe("classifyRailMode", () => {
  it("classifies JR ordinary railways as commuter rail", () => {
    expect(classifyRailMode(input("11", "2", "東日本旅客鉄道"))).toBe("commuter_rail");
    expect(classifyRailMode(input("11", "1", "東海旅客鉄道"))).toBe("commuter_rail");
  });

  it("classifies Tokyo Metro as subway despite being a private operator", () => {
    // N02_002=4 is the same operator type Tokyu and Keio carry.
    expect(classifyRailMode(input("12", "4", "東京地下鉄"))).toBe("subway");
  });

  it("classifies municipally operated ordinary railways as subway", () => {
    expect(classifyRailMode(input("12", "3", "東京都"))).toBe("subway");
    expect(classifyRailMode(input("12", "3", "横浜市"))).toBe("subway");
  });

  it("classifies private and third-sector ordinary railways as commuter rail", () => {
    for (const operator of ["東急電鉄", "京王電鉄", "東武鉄道"]) {
      expect(classifyRailMode(input("12", "4", operator))).toBe("commuter_rail");
    }
    for (const operator of ["首都圏新都市鉄道", "東京臨海高速鉄道", "北総鉄道", "埼玉高速鉄道"]) {
      expect(classifyRailMode(input("12", "5", operator))).toBe("commuter_rail");
    }
  });

  // MLIT gives monorails four codes: suspended (14, 22) and straddle
  // (15, 23). Mapping only the two that appear inside Tokyo's bbox would
  // silently drop Chiba, Tama, Osaka and Okinawa.
  it("classifies all four monorail classes as monorail", () => {
    expect(classifyRailMode(input("14", "4", "湘南モノレール"))).toBe("monorail");
    expect(classifyRailMode(input("15", "4", "東京モノレール"))).toBe("monorail");
    expect(classifyRailMode(input("15", "4", "舞浜リゾートライン"))).toBe("monorail");
    expect(classifyRailMode(input("22", "4", "千葉都市モノレール"))).toBe("monorail");
    expect(classifyRailMode(input("23", "4", "多摩都市モノレール"))).toBe("monorail");
    expect(classifyRailMode(input("23", "5", "沖縄都市モノレール"))).toBe("monorail");
  });

  it("classifies tramways, guideways, funiculars and maglev as local rail", () => {
    expect(classifyRailMode(input("21", "4", "東急電鉄"))).toBe("local_rail");
    expect(classifyRailMode(input("24", "5", "ゆりかもめ"))).toBe("local_rail");
    expect(classifyRailMode(input("16", "3", "埼玉新都市交通"))).toBe("local_rail");
    expect(classifyRailMode(input("13", "4", "大山観光電鉄"))).toBe("local_rail");
    expect(classifyRailMode(input("25", "5", "愛知高速交通"))).toBe("local_rail");
  });

  // The reason the classifier reads N02_001 before the operator name.
  it("does NOT call 東京都's tram or guideway a subway", () => {
    expect(classifyRailMode(input("21", "3", "東京都"))).toBe("local_rail");
    expect(classifyRailMode(input("24", "3", "東京都"))).toBe("local_rail");
    // ...while the same operator's ordinary railway still is one.
    expect(classifyRailMode(input("12", "3", "東京都"))).toBe("subway");
  });

  it("returns null for an unmapped railway class rather than guessing", () => {
    // Every code present in the 2025 export is mapped, so null is reached
    // only by a code MLIT has not used before.
    expect(classifyRailMode(input("99", "4", "架空鉄道"))).toBeNull();
    expect(classifyRailMode({ railwayClass: null, operatorType: null, operator: null })).toBeNull();
  });
});

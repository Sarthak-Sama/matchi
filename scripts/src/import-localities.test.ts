import iconv from "iconv-lite";
import { describe, expect, it } from "vitest";

import { normalizeLocalityName } from "./import-localities.js";
import {
  buildRomanizationIndex,
  parseJapanPostCsv,
  resolveLocalityNames,
} from "./import-localities/romanization.js";

describe("normalizeLocalityName", () => {
  it("dissolves numeric and Japanese chome suffixes without changing the base name", () => {
    expect(normalizeLocalityName("初台１丁目")).toBe("初台");
    expect(normalizeLocalityName("初台2丁目")).toBe("初台");
    expect(normalizeLocalityName("初台一丁目")).toBe("初台");
    expect(normalizeLocalityName("代々木")).toBe("代々木");
  });
});

/**
 * Builds a fake Japan Post romanized-address CSV as Shift-JIS bytes, matching the
 * 7-column shape `parseJapanPostCsv` parses: [postalCode, prefJa, cityJa, townJa,
 * prefRo, cityRo, townRo].
 */
function japanPostCsv(
  rows: readonly { cityJa: string; townJa: string; townRo: string }[],
): Buffer {
  const text = rows
    .map((row) =>
      ["1000000", "東京都", row.cityJa, row.townJa, "TOKYO TO", "SHIBUYA KU", row.townRo]
        .map((field) => `"${field}"`)
        .join(","),
    )
    .join("\n");
  return iconv.encode(text, "Shift_JIS");
}

// Mirrors import-localities.ts's grouped-map / resolveLocalityNames key: wardCode and
// nameJa joined by NUL, built with fromCodePoint rather than a literal NUL byte in
// this source file.
const NUL = String.fromCodePoint(0);
function localityKey(wardCode: string, nameJa: string): string {
  return wardCode + NUL + nameJa;
}

describe("import-localities romanization join (Task 3 wiring)", () => {
  it("resolves Hatsudai/初台, Hatagaya/幡ケ谷 and Yoyogi/代々木 for real Shibuya ward rows, end to end through the exported Task 2 functions", () => {
    // In-memory Shift-JIS fixture standing in for data/locality-romanization.csv —
    // no filesystem or database access.
    const bytes = japanPostCsv([
      { cityJa: "渋谷区", townJa: "初台", townRo: "HATSUDAI" },
      { cityJa: "渋谷区", townJa: "幡ヶ谷", townRo: "HATAGAYA" },
      { cityJa: "渋谷区", townJa: "代々木", townRo: "YOYOGI" },
    ]);
    const index = buildRomanizationIndex(parseJapanPostCsv(bytes));

    // Stands in for the grouped e-Stat localities import-localities.ts builds, joined
    // with the ward_code -> name_ja row a SELECT against `wards` would return.
    const { nameEnByKey } = resolveLocalityNames({
      localities: [
        { wardCode: "13113", wardNameJa: "渋谷区", nameJa: "初台" },
        { wardCode: "13113", wardNameJa: "渋谷区", nameJa: "幡ケ谷" },
        { wardCode: "13113", wardNameJa: "渋谷区", nameJa: "代々木" },
      ],
      index,
      overrides: [],
    });

    expect(nameEnByKey.get(localityKey("13113", "初台"))).toBe("Hatsudai");
    expect(nameEnByKey.get(localityKey("13113", "幡ケ谷"))).toBe("Hatagaya");
    expect(nameEnByKey.get(localityKey("13113", "代々木"))).toBe("Yoyogi");
    expect(nameEnByKey.size).toBe(3);
  });

  it("throws — failing the import — when a grouped locality has no Japan Post match and no override", () => {
    const bytes = japanPostCsv([{ cityJa: "渋谷区", townJa: "初台", townRo: "HATSUDAI" }]);
    const index = buildRomanizationIndex(parseJapanPostCsv(bytes));

    expect(() =>
      resolveLocalityNames({
        localities: [
          { wardCode: "13113", wardNameJa: "渋谷区", nameJa: "初台" },
          { wardCode: "13113", wardNameJa: "渋谷区", nameJa: "存在しない町" },
        ],
        index,
        overrides: [],
      }),
    ).toThrow(/存在しない町/);
  });
});

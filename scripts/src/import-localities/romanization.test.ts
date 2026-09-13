import iconv from "iconv-lite";
import { describe, expect, it } from "vitest";

import {
  buildRomanizationIndex,
  normalizeForMatch,
  parseJapanPostCsv,
  resolveLocalityNames,
  toDisplayRomanization,
} from "./romanization.js";
import { ROMANIZATION_OVERRIDES } from "./romanization-overrides.js";

/**
 * Builds a fake Japan Post romanized-address CSV as Shift-JIS bytes, matching the
 * 7-column shape this module parses: [postalCode, prefJa, cityJa, townJa, prefRo,
 * cityRo, townRo]. Each field is quoted, as Japan Post emits them.
 */
function japanPostCsv(
  rows: readonly {
    postalCode?: string;
    prefJa?: string;
    cityJa: string;
    townJa: string;
    prefRo?: string;
    cityRo?: string;
    townRo: string;
  }[],
): Buffer {
  const text = rows
    .map((row) =>
      [
        row.postalCode ?? "1000000",
        row.prefJa ?? "東京都",
        row.cityJa,
        row.townJa,
        row.prefRo ?? "TOKYO TO",
        row.cityRo ?? "SHIBUYA KU",
        row.townRo,
      ]
        .map((field) => `"${field}"`)
        .join(","),
    )
    .join("\n");
  return iconv.encode(text, "Shift_JIS");
}

/**
 * Builds the same NUL-joined `wardCode` + `nameJa` key resolveLocalityNames uses for
 * `nameEnByKey`, without spelling out a literal "<digits> <kanji>" string (which this
 * key format deliberately does not use — it is NUL, not a space).
 */
const NUL = String.fromCodePoint(0);
function localityKey(wardCode: string, nameJa: string): string {
  return wardCode + NUL + nameJa;
}

describe("parseJapanPostCsv Shift-JIS decoding", () => {
  it("round-trips Japanese town names through Shift-JIS", () => {
    const bytes = japanPostCsv([{ cityJa: "渋谷区", townJa: "初台", townRo: "HATSUDAI" }]);
    const rows = parseJapanPostCsv(bytes);
    expect(rows).toEqual([{ wardNameJa: "渋谷区", matchKey: "初台", nameEn: "Hatsudai" }]);
  });
});

describe("toDisplayRomanization", () => {
  it("title cases a single word", () => {
    expect(toDisplayRomanization("HATSUDAI")).toBe("Hatsudai");
  });

  it("title cases each word of a multi-word romanization", () => {
    expect(toDisplayRomanization("SENJU AKEBONOCHO")).toBe("Senju Akebonocho");
  });
});

describe("normalizeForMatch chome removal", () => {
  it("dissolves a full-width numeral chome suffix", () => {
    expect(normalizeForMatch("初台１丁目")).toBe("初台");
  });

  it("dissolves an ASCII numeral chome suffix", () => {
    expect(normalizeForMatch("初台2丁目")).toBe("初台");
  });

  it("dissolves a kanji numeral chome suffix", () => {
    expect(normalizeForMatch("初台一丁目")).toBe("初台");
  });

  it("dissolves a bare chome suffix with no numeral", () => {
    expect(normalizeForMatch("初台丁目")).toBe("初台");
  });
});

describe("normalizeForMatch ケ/ヶ equivalence", () => {
  it("keys 幡ケ谷 (regular KE) and 幡ヶ谷 (small KE) the same", () => {
    expect(normalizeForMatch("幡ケ谷")).toBe(normalizeForMatch("幡ヶ谷"));
  });

  it("lets a 幡ヶ谷 postal row match a 幡ケ谷 e-Stat name via the index", () => {
    const rows = parseJapanPostCsv(
      japanPostCsv([{ cityJa: "渋谷区", townJa: "幡ヶ谷", townRo: "HATAGAYA" }]),
    );
    const index = buildRomanizationIndex(rows);
    const { nameEnByKey } = resolveLocalityNames({
      localities: [{ wardCode: "13113", wardNameJa: "渋谷区", nameJa: "幡ケ谷" }],
      index,
      overrides: [],
    });
    expect(nameEnByKey.get(localityKey("13113", "幡ケ谷"))).toBe("Hatagaya");
  });
});

describe("parseJapanPostCsv postal annotations", () => {
  it("skips the 'no town listed' catch-all row", () => {
    const rows = parseJapanPostCsv(
      japanPostCsv([
        { cityJa: "港区", townJa: "以下に掲載がない場合", townRo: "IKA NI KEISAI GA NAI BAAI" },
      ]),
    );
    expect(rows).toEqual([]);
  });

  it("strips a closed full-width annotation from townJa and the matching ASCII annotation from townRo", () => {
    const rows = parseJapanPostCsv(
      japanPostCsv([
        {
          cityJa: "渋谷区",
          townJa: "恵比寿　（次のビルを除く）",
          townRo: "EBISU (TSUGINOBIRUONOZOKU)",
        },
      ]),
    );
    expect(rows).toEqual([{ wardNameJa: "渋谷区", matchKey: "恵比寿", nameEn: "Ebisu" }]);
  });

  it("strips a truncated, unclosed annotation", () => {
    const rows = parseJapanPostCsv(
      japanPostCsv([{ cityJa: "中央区", townJa: "銀座（１", townRo: "GINZA" }]),
    );
    expect(rows).toEqual([{ wardNameJa: "中央区", matchKey: "銀座", nameEn: "Ginza" }]);
  });
});

describe("parseJapanPostCsv sub-town ideographic space", () => {
  it("treats the ideographic space as a sub-town separator, not an annotation boundary", () => {
    const rows = parseJapanPostCsv(
      japanPostCsv([{ cityJa: "足立区", townJa: "千住　曙町", townRo: "SENJU AKEBONOCHO" }]),
    );
    expect(rows).toEqual([
      { wardNameJa: "足立区", matchKey: "千住曙町", nameEn: "Senju Akebonocho" },
    ]);
  });
});

describe("resolveLocalityNames duplicate detection", () => {
  it("throws, naming the locality, when two postal rows give the same ward+key different romanizations", () => {
    const rows = parseJapanPostCsv(
      japanPostCsv([
        { cityJa: "新宿区", townJa: "四谷", townRo: "YOTSUYA" },
        { cityJa: "新宿区", townJa: "四谷", townRo: "YOTUYA" },
      ]),
    );
    const index = buildRomanizationIndex(rows);
    expect(() =>
      resolveLocalityNames({
        localities: [{ wardCode: "13104", wardNameJa: "新宿区", nameJa: "四谷" }],
        index,
        overrides: [],
      }),
    ).toThrow(/13104 四谷/);
  });
});

describe("resolveLocalityNames overrides", () => {
  it("lets an override win over an index hit for the same locality", () => {
    const rows = parseJapanPostCsv(
      japanPostCsv([{ cityJa: "千代田区", townJa: "三崎町", townRo: "MISAKICHO" }]),
    );
    const index = buildRomanizationIndex(rows);
    const { nameEnByKey } = resolveLocalityNames({
      localities: [{ wardCode: "13101", wardNameJa: "千代田区", nameJa: "三崎町" }],
      index,
      overrides: [
        { wardCode: "13101", nameJa: "三崎町", nameEn: "KandaMisakicho", reason: "test override" },
      ],
    });
    expect(nameEnByKey.get(localityKey("13101", "三崎町"))).toBe("KandaMisakicho");
  });

  it("throws when a supplied override matches no e-Stat locality (stale override)", () => {
    expect(() =>
      resolveLocalityNames({
        localities: [{ wardCode: "13101", wardNameJa: "千代田区", nameJa: "神田" }],
        index: buildRomanizationIndex(
          parseJapanPostCsv(
            japanPostCsv([{ cityJa: "千代田区", townJa: "神田", townRo: "KANDA" }]),
          ),
        ),
        overrides: [
          { wardCode: "13101", nameJa: "存在しない町", nameEn: "Nonexistent", reason: "stale" },
        ],
      }),
    ).toThrow(/存在しない町/);
  });
});

describe("resolveLocalityNames missing romanization", () => {
  it("throws and names every missing locality", () => {
    const index = buildRomanizationIndex(
      parseJapanPostCsv(japanPostCsv([{ cityJa: "渋谷区", townJa: "初台", townRo: "HATSUDAI" }])),
    );
    expect(() =>
      resolveLocalityNames({
        localities: [
          { wardCode: "13113", wardNameJa: "渋谷区", nameJa: "存在しない町１" },
          { wardCode: "13113", wardNameJa: "渋谷区", nameJa: "存在しない町２" },
        ],
        index,
        overrides: [],
      }),
    ).toThrow(/存在しない町１.*存在しない町２|存在しない町２.*存在しない町１/s);
  });
});

describe("resolveLocalityNames canonical fixtures", () => {
  it("resolves Hatsudai/初台, Hatagaya/幡ケ谷 and Yoyogi/代々木 to the exact expected pairs", () => {
    const rows = parseJapanPostCsv(
      japanPostCsv([
        { cityJa: "渋谷区", townJa: "初台", townRo: "HATSUDAI" },
        { cityJa: "渋谷区", townJa: "幡ヶ谷", townRo: "HATAGAYA" },
        { cityJa: "渋谷区", townJa: "代々木", townRo: "YOYOGI" },
      ]),
    );
    const index = buildRomanizationIndex(rows);
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
  });
});

describe("ROMANIZATION_OVERRIDES", () => {
  it("pins the 13103 waterfront placeholder nameJa to the single U+2010 HYPHEN character", () => {
    const entry = ROMANIZATION_OVERRIDES.find((o) => o.wardCode === "13103");
    expect(entry).toBeDefined();
    expect(entry?.nameJa.length).toBe(1);
    expect(entry?.nameJa.codePointAt(0)).toBe(0x2010);
    // Guard against a future edit silently "fixing" this to an ASCII hyphen-minus
    // (U+002D) or an em/en dash (U+2013/U+2014) — it must stay the placeholder e-Stat
    // itself emits.
    expect(entry?.nameJa).not.toBe("-");
  });

  it("has exactly 11 entries, the complete measured set with no Japan Post match", () => {
    expect(ROMANIZATION_OVERRIDES.length).toBe(11);
  });
});

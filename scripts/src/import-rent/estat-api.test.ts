import { describe, expect, it } from "vitest";

import { ESTAT_RENT_TABLE_ID, ESTAT_TIME, TOKYO_WARD_CODES, parseEstatApiResponse } from "./estat-api.js";

function response(values = TOKYO_WARD_CODES) {
  return {
    GET_STATS_DATA: {
      RESULT: { STATUS: 0 },
      STATISTICAL_DATA: {
        TABLE_INF: { "@id": ESTAT_RENT_TABLE_ID },
        DATA_INF: { VALUE: values.map((area) => ({ "@area": area, "@cat01": "3", "@cat02": "2", "@time": ESTAT_TIME, "@unit": "円", $: "4200" })) },
      },
    },
  };
}

describe("e-Stat v3 response validation", () => {
  it("accepts exactly the requested 23 ward rent values", () => {
    const result = parseEstatApiResponse(response(), { tableId: ESTAT_RENT_TABLE_ID, cat01: "3", cat02: "2" });
    expect(result.values).toHaveLength(23);
    expect(result.values[0]).toMatchObject({ area: "13101", value: 4200 });
  });

  it("rejects incomplete or duplicate ward coverage before writes", () => {
    expect(() => parseEstatApiResponse(response(TOKYO_WARD_CODES.slice(1)), { tableId: ESTAT_RENT_TABLE_ID, cat01: "3", cat02: "2" })).toThrow(/missing ward/);
    expect(() => parseEstatApiResponse(response([...TOKYO_WARD_CODES.slice(0, 22), "13101"]), { tableId: ESTAT_RENT_TABLE_ID, cat01: "3", cat02: "2" })).toThrow(/duplicate ward/);
  });

  it("rejects dimensions other than the requested private-rental slice", () => {
    const bad = response() as { GET_STATS_DATA: { STATISTICAL_DATA: { DATA_INF: { VALUE: Array<Record<string, string>> } } } };
    bad.GET_STATS_DATA.STATISTICAL_DATA.DATA_INF.VALUE[0]!["@cat02"] = "1";
    expect(() => parseEstatApiResponse(bad, { tableId: ESTAT_RENT_TABLE_ID, cat01: "3", cat02: "2" })).toThrow(/unexpected dimensions/);
  });
});

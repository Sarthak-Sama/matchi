import { describe, expect, it } from "vitest";
import { checkGrounding, collectNumbers, extractFigures } from "./grounding.js";

const results = [
  {
    shortlist: [
      { area_id: "a1", rent_yen: 82000, commute_min: 24, p_best_pct: 41 },
      { area_id: "a2", rent_yen: 118400, commute_min: 90.4, p_best: 0.27 },
      { area_id: "a3", rent_yen: 95000, commute_min: 31, note: "about 12,000 yen cheaper" },
    ],
  },
];
const profile = { budget_yen: 150000, commute_cap_min: 45 };
const check = (reply: string) => checkGrounding({ reply, toolResults: results, profile });

describe("collectNumbers", () => {
  it("walks nested values, strings and array lengths", () => {
    const collected = collectNumbers([...results, profile, null, undefined]);
    expect(collected.values).toEqual(expect.arrayContaining([82000, 24, 0.27, 12000, 150000, 1, 2, 3]));
    expect(collected.counts).toContain(3);
  });
});

describe("extractFigures", () => {
  it("reads yen forms", () => {
    const figures = extractFigures("¥82,000, 82,000 yen, 8.2万, 8.2万円, 82000円, ￥８２，０００, ¥82k");
    expect(figures.map((f) => f.unit)).toEqual(Array(7).fill("yen"));
    expect(figures.map((f) => f.value)).toEqual(Array(7).fill(82000));
  });

  it("reads minutes, hours, percent and area counts", () => {
    expect(extractFigures("24 min, 31分, 1.5 hours, 2時間, 41%, 27 percent, 3 areas")).toEqual([
      { raw: "24 min", value: 24, unit: "minutes" },
      { raw: "31分", value: 31, unit: "minutes" },
      { raw: "1.5 hours", value: 1.5, unit: "hours" },
      { raw: "2時間", value: 2, unit: "hours" },
      { raw: "41%", value: 41, unit: "percent" },
      { raw: "27 percent", value: 27, unit: "percent" },
      { raw: "3 areas", value: 3, unit: "count" },
    ]);
  });

  it("ignores numbers without a unit", () => {
    expect(extractFigures("In 2026, option 2 on line 7 has 82k fans")).toEqual([]);
  });
});

describe("checkGrounding", () => {
  it("passes figures copied from tool results and the profile", () => {
    expect(
      check("Of 3 areas, the first is ¥82,000 at 24 minutes with a 41% chance; your budget is 15万円 and cap 45分."),
    ).toEqual({ pass: true });
  });

  it("matches after rounding: rent to 1,000 yen, whole minutes, whole percent", () => {
    expect(check("The second is 118,000 yen, 90 minutes (1.5 hours), 27% likely.")).toEqual({ pass: true });
  });

  it("matches numbers quoted inside result strings", () => {
    expect(check("It is 12,000 yen cheaper.")).toEqual({ pass: true });
  });

  it("returns the unmatched figures", () => {
    const outcome = check("Rent is ¥79,000 and the ride is 24 minutes, 55% likely, across 7 areas.");
    expect(outcome).toEqual({
      pass: false,
      unmatched: [
        { raw: "¥79,000", value: 79000, unit: "yen" },
        { raw: "55%", value: 55, unit: "percent" },
        { raw: "7 areas", value: 7, unit: "count" },
      ],
    });
  });

  it("does not let a yen figure match a rounding of a different thousand", () => {
    expect(check("It costs 8.3万.").pass).toBe(false);
  });

  it("passes a reply with no figures and fails any figure with no results", () => {
    expect(check("Tell me where you work.")).toEqual({ pass: true });
    expect(checkGrounding({ reply: "About 20 minutes.", toolResults: [] }).pass).toBe(false);
  });
});

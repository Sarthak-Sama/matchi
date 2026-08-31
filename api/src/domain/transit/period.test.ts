import { describe, expect, it } from "vitest";

import { resolvePeriod } from "./period.js";

describe("resolvePeriod", () => {
  it("is off-peak just before the window (07:29)", () => {
    expect(resolvePeriod("07:29")).toBe("offpeak");
  });

  it("is peak at the inclusive start (07:30)", () => {
    expect(resolvePeriod("07:30")).toBe("peak");
  });

  it("is peak just before the exclusive end (09:59)", () => {
    expect(resolvePeriod("09:59")).toBe("peak");
  });

  it("is off-peak at the exclusive end (10:00)", () => {
    expect(resolvePeriod("10:00")).toBe("offpeak");
  });

  it("is off-peak well outside the window (23:00)", () => {
    expect(resolvePeriod("23:00")).toBe("offpeak");
  });

  it("throws on a malformed time", () => {
    expect(() => resolvePeriod("9:30")).toThrow();
    expect(() => resolvePeriod("25:00")).toThrow();
  });
});

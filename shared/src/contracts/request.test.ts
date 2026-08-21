import { describe, expect, it } from "vitest";

import { optimizationRequestSchema } from "./request.js";

function validRequest() {
  return {
    destinationStationGroupId: "shinjuku",
    arrivalTime: "09:00",
    monthlyBudgetYen: 150_000,
    layout: "1K",
    maxCommuteMinutes: 45,
    preferences: {
      floodSafety: "medium",
      supermarkets: "high",
      restaurants: "low",
      quietness: "essential",
    },
  };
}

describe("optimizationRequestSchema", () => {
  it("accepts a valid request", () => {
    const result = optimizationRequestSchema.safeParse(validRequest());
    expect(result.success).toBe(true);
  });

  it("rejects a malformed arrivalTime (out-of-range hour)", () => {
    const result = optimizationRequestSchema.safeParse({
      ...validRequest(),
      arrivalTime: "25:00",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a malformed arrivalTime (missing leading zero)", () => {
    const result = optimizationRequestSchema.safeParse({
      ...validRequest(),
      arrivalTime: "9:00",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a non-integer budget", () => {
    const result = optimizationRequestSchema.safeParse({
      ...validRequest(),
      monthlyBudgetYen: 150_000.5,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a zero budget", () => {
    const result = optimizationRequestSchema.safeParse({
      ...validRequest(),
      monthlyBudgetYen: 0,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a negative budget", () => {
    const result = optimizationRequestSchema.safeParse({
      ...validRequest(),
      monthlyBudgetYen: -1000,
    });
    expect(result.success).toBe(false);
  });

  it("rejects maxCommuteMinutes of 4 (below min)", () => {
    const result = optimizationRequestSchema.safeParse({
      ...validRequest(),
      maxCommuteMinutes: 4,
    });
    expect(result.success).toBe(false);
  });

  it("rejects maxCommuteMinutes of 181 (above max)", () => {
    const result = optimizationRequestSchema.safeParse({
      ...validRequest(),
      maxCommuteMinutes: 181,
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown layout", () => {
    const result = optimizationRequestSchema.safeParse({
      ...validRequest(),
      layout: "4LDK",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown importance value", () => {
    const result = optimizationRequestSchema.safeParse({
      ...validRequest(),
      preferences: {
        ...validRequest().preferences,
        quietness: "critical",
      },
    });
    expect(result.success).toBe(false);
  });

  it("rejects an extra unknown top-level key", () => {
    const result = optimizationRequestSchema.safeParse({
      ...validRequest(),
      extraField: "not allowed",
    });
    expect(result.success).toBe(false);
  });
});

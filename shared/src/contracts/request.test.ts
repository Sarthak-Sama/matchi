import { describe, expect, it } from "vitest";

import { LIFESTYLE_AXIS_IDS, MAX_SELECTED_LIFESTYLE_AXES } from "../config/lifestyle-axes.js";
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

describe("optimizationRequestSchema preferences", () => {
  it("accepts a single rated axis (the rest omitted, not rated low)", () => {
    const result = optimizationRequestSchema.safeParse({
      ...validRequest(),
      preferences: { quietness: "high" },
    });
    expect(result.success).toBe(true);
    expect(result.data?.preferences).toEqual({ quietness: "high" });
  });

  it("accepts the maximum allowed number of axes", () => {
    const preferences = Object.fromEntries(
      LIFESTYLE_AXIS_IDS.slice(0, MAX_SELECTED_LIFESTYLE_AXES).map((id) => [id, "medium"]),
    );
    const result = optimizationRequestSchema.safeParse({ ...validRequest(), preferences });
    expect(result.success).toBe(true);
  });

  it("rejects selecting every registered axis when that exceeds the maximum allowed", () => {
    // With nine registered axes and a max of five, submitting all of them
    // (the app's own untouched default state before Task 4's frontend fix)
    // must 400 rather than silently accept — this is exactly the guard
    // MAX_SELECTED_LIFESTYLE_AXES exists to enforce as the axis set grows.
    expect(LIFESTYLE_AXIS_IDS.length).toBeGreaterThan(MAX_SELECTED_LIFESTYLE_AXES);
    const preferences = Object.fromEntries(LIFESTYLE_AXIS_IDS.map((id) => [id, "medium"]));
    const result = optimizationRequestSchema.safeParse({ ...validRequest(), preferences });
    expect(result.success).toBe(false);
  });

  it("rejects an empty preferences object (no axis rated)", () => {
    const result = optimizationRequestSchema.safeParse({ ...validRequest(), preferences: {} });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["preferences"]);
  });

  it("rejects an unknown axis key rather than silently dropping it", () => {
    const result = optimizationRequestSchema.safeParse({
      ...validRequest(),
      preferences: { ...validRequest().preferences, hilliness: "high" },
    });
    expect(result.success).toBe(false);
  });

  it("names the offending axis in the error path", () => {
    const result = optimizationRequestSchema.safeParse({
      ...validRequest(),
      preferences: { ...validRequest().preferences, quietness: "critical" },
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["preferences", "quietness"]);
  });
});

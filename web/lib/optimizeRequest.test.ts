import { MAX_SELECTED_LIFESTYLE_AXES } from "@tokyo/shared";
import { describe, expect, it } from "vitest";

import { buildOptimizationRequest, validateSearchInputs } from "./optimizeRequest";

const EMPTY_PREFERENCES = {
  supermarkets: undefined,
  restaurants: undefined,
  quietness: undefined,
  konbini: undefined,
  cuisineVariety: undefined,
  greenSpace: undefined,
  lateNight: undefined,
  health: undefined,
} as const;

describe("buildOptimizationRequest", () => {
  it("builds a destinationStationGroupId request for a station destination", () => {
    const request = buildOptimizationRequest({
      selectedDestination: { kind: "station", stationGroupId: "st-shibuya", label: "Shibuya" },
      arrivalTime: "08:30",
      monthlyBudgetYen: 200_000,
      layout: "1LDK",
      maxCommuteMinutes: 45,
      preferences: { ...EMPTY_PREFERENCES, supermarkets: "high" },
    });

    expect(request).toEqual({
      destinationStationGroupId: "st-shibuya",
      arrivalTime: "08:30",
      monthlyBudgetYen: 200_000,
      layout: "1LDK",
      maxCommuteMinutes: 45,
      preferences: { ...EMPTY_PREFERENCES, supermarkets: "high" },
    });
  });

  it("builds a destinationPoint request for a point destination", () => {
    const request = buildOptimizationRequest({
      selectedDestination: { kind: "point", lat: 35.65, lon: 139.7, label: "Some Point" },
      arrivalTime: "09:00",
      monthlyBudgetYen: 150_000,
      layout: "1K",
      maxCommuteMinutes: 30,
      preferences: EMPTY_PREFERENCES,
    });

    expect(request).toMatchObject({
      destinationPoint: { lat: 35.65, lon: 139.7, label: "Some Point" },
    });
    expect(request).not.toHaveProperty("destinationStationGroupId");
  });
});

describe("validateSearchInputs", () => {
  it("rejects when no destination is selected", () => {
    const result = validateSearchInputs(null, { ...EMPTY_PREFERENCES, supermarkets: "high" });
    expect(result).toEqual({
      ok: false,
      message: "Choose a destination from the suggestions list first.",
    });
  });

  it("rejects when no lifestyle axis is selected", () => {
    const result = validateSearchInputs(
      { kind: "station", stationGroupId: "st-shibuya", label: "Shibuya" },
      EMPTY_PREFERENCES,
    );
    expect(result).toEqual({
      ok: false,
      message: "Select at least one lifestyle priority before searching.",
    });
  });

  it("rejects when more than the max lifestyle axes are selected", () => {
    const result = validateSearchInputs(
      { kind: "station", stationGroupId: "st-shibuya", label: "Shibuya" },
      {
        supermarkets: "high",
        restaurants: "high",
        quietness: "high",
        konbini: "high",
        cuisineVariety: "high",
        greenSpace: "high",
        lateNight: undefined,
        health: undefined,
      },
    );
    expect(result).toEqual({
      ok: false,
      message: `Select at most ${MAX_SELECTED_LIFESTYLE_AXES} lifestyle priorities.`,
    });
  });

  it("accepts a valid destination with an in-range axis count and returns the narrowed destination", () => {
    const destination = {
      kind: "station" as const,
      stationGroupId: "st-shibuya",
      label: "Shibuya",
    };
    const result = validateSearchInputs(destination, {
      ...EMPTY_PREFERENCES,
      supermarkets: "high",
    });
    expect(result).toEqual({ ok: true, destination });
  });
});

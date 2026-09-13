import { describe, expect, it } from "vitest";

import { buildSearchQueryString, parseSearchParams } from "./searchParams";

describe("parseSearchParams / buildSearchQueryString round-trip", () => {
  it("round-trips a station destination with a subset of lifestyle axes", () => {
    const queryString = buildSearchQueryString({
      selectedDestination: { kind: "station", stationGroupId: "st-shibuya", label: "Shibuya" },
      arrivalTime: "08:30",
      maxCommuteMinutes: 45,
      monthlyBudgetYen: 200_000,
      layout: "1LDK",
      preferences: {
        supermarkets: "high",
        restaurants: undefined,
        quietness: "medium",
        konbini: undefined,
        cuisineVariety: undefined,
        greenSpace: undefined,
        lateNight: undefined,
        health: undefined,
      },
    });

    const parsed = parseSearchParams(`?${queryString}`);

    expect(parsed.destination).toEqual({
      kind: "station",
      stationGroupId: "st-shibuya",
      label: "Shibuya",
    });
    expect(parsed.arrivalTime).toBe("08:30");
    expect(parsed.maxCommuteMinutes).toBe(45);
    expect(parsed.monthlyBudgetYen).toBe(200_000);
    expect(parsed.layout).toBe("1LDK");
    expect(parsed.preferenceOverrides).toEqual({ supermarkets: "high", quietness: "medium" });
  });

  it("round-trips a point destination", () => {
    const queryString = buildSearchQueryString({
      selectedDestination: { kind: "point", lat: 35.6595, lon: 139.7005, label: "Some Point" },
      arrivalTime: "09:00",
      maxCommuteMinutes: 30,
      monthlyBudgetYen: 150_000,
      layout: "1K",
      preferences: {
        supermarkets: undefined,
        restaurants: undefined,
        quietness: undefined,
        konbini: undefined,
        cuisineVariety: undefined,
        greenSpace: undefined,
        lateNight: undefined,
        health: undefined,
      },
    });

    const parsed = parseSearchParams(`?${queryString}`);

    expect(parsed.destination).toEqual({
      kind: "point",
      lat: 35.6595,
      lon: 139.7005,
      label: "Some Point",
    });
  });
});

describe("parseSearchParams", () => {
  it("returns null destination and empty overrides for an empty query string", () => {
    const parsed = parseSearchParams("");
    expect(parsed.destination).toBeNull();
    expect(parsed.arrivalTime).toBeNull();
    expect(parsed.maxCommuteMinutes).toBeNull();
    expect(parsed.monthlyBudgetYen).toBeNull();
    expect(parsed.layout).toBeNull();
    expect(parsed.preferenceOverrides).toEqual({});
  });

  it("falls back to 'Destination point' when a point deep-link carries no label", () => {
    const parsed = parseSearchParams("?destLat=35.5&destLon=139.5");
    expect(parsed.destination).toEqual({
      kind: "point",
      lat: 35.5,
      lon: 139.5,
      label: "Destination point",
    });
  });

  it("falls back to the station id as the label when a station deep-link carries no label", () => {
    const parsed = parseSearchParams("?dest=st-ueno");
    expect(parsed.destination).toEqual({
      kind: "station",
      stationGroupId: "st-ueno",
      label: "st-ueno",
    });
  });

  it("prefers the point destination over a station id when both are present", () => {
    const parsed = parseSearchParams("?dest=st-ueno&destLat=35.5&destLon=139.5");
    expect(parsed.destination?.kind).toBe("point");
  });

  it("ignores an empty arrival param instead of overwriting with an empty string", () => {
    const parsed = parseSearchParams("?arrival=");
    expect(parsed.arrivalTime).toBeNull();
  });

  it("preserves today's behavior of yielding NaN for a non-numeric maxCommute/budget", () => {
    const parsed = parseSearchParams("?maxCommute=abc&budget=xyz");
    expect(parsed.maxCommuteMinutes).toBeNaN();
    expect(parsed.monthlyBudgetYen).toBeNaN();
  });

  it("ignores an unrecognized layout value", () => {
    const parsed = parseSearchParams("?layout=not-a-real-layout");
    expect(parsed.layout).toBeNull();
  });

  it("ignores an unrecognized importance value for a lifestyle axis", () => {
    const parsed = parseSearchParams("?supermarkets=not-a-real-importance");
    expect(parsed.preferenceOverrides.supermarkets).toBeUndefined();
  });
});

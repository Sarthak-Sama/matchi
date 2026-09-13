import { describe, expect, it } from "vitest";

import { haversineMeters } from "./geo.js";

describe("haversineMeters", () => {
  it("returns 0 for identical points", () => {
    expect(haversineMeters(35.681, 139.767, 35.681, 139.767)).toBe(0);
  });

  it("is symmetric", () => {
    const a = { lat: 35.681236, lon: 139.767125 };
    const b = { lat: 35.658034, lon: 139.701636 };
    expect(haversineMeters(a.lat, a.lon, b.lat, b.lon)).toBeCloseTo(
      haversineMeters(b.lat, b.lon, a.lat, a.lon),
      9,
    );
  });

  it("matches the known distance between Tokyo Station and Shibuya Station", () => {
    // Tokyo Station and Shibuya Station are roughly 6.5km apart.
    const tokyoStation = { lat: 35.681236, lon: 139.767125 };
    const shibuyaStation = { lat: 35.658034, lon: 139.701636 };
    const metres = haversineMeters(
      tokyoStation.lat,
      tokyoStation.lon,
      shibuyaStation.lat,
      shibuyaStation.lon,
    );
    expect(metres).toBeGreaterThan(6_000);
    expect(metres).toBeLessThan(7_000);
  });
});

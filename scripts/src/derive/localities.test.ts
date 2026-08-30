import { describe, expect, it } from "vitest";

import { sufficiencyScore } from "./localities.js";

describe("locality sufficiency scoring", () => {
  it("saturates at a practical target instead of rewarding unlimited density", () => {
    expect(sufficiencyScore(4, 4)).toBe(100);
    expect(sufficiencyScore(400, 4)).toBe(100);
    expect(sufficiencyScore(1, 4)).toBeGreaterThan(0);
    expect(sufficiencyScore(1, 4)).toBeLessThan(100);
  });
});

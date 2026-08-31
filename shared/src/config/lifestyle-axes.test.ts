import { describe, expect, it } from "vitest";

import {
  isValidSelectedAxisCount,
  LIFESTYLE_AXIS_IDS,
  MAX_SELECTED_LIFESTYLE_AXES,
  MIN_SELECTED_LIFESTYLE_AXES,
} from "./lifestyle-axes.js";

describe("isValidSelectedAxisCount", () => {
  it.each([
    [0, false],
    [MIN_SELECTED_LIFESTYLE_AXES, true],
    [MAX_SELECTED_LIFESTYLE_AXES, true],
    [MAX_SELECTED_LIFESTYLE_AXES + 1, false],
  ])("%i selected axes -> %s", (count, expected) => {
    expect(isValidSelectedAxisCount(count)).toBe(expected);
  });

  it("rejects rating every registered axis once the axis set grows past the max", () => {
    expect(LIFESTYLE_AXIS_IDS.length).toBeGreaterThan(MAX_SELECTED_LIFESTYLE_AXES);
    expect(isValidSelectedAxisCount(LIFESTYLE_AXIS_IDS.length)).toBe(false);
  });
});

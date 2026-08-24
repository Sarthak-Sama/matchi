import { describe, expect, it } from "vitest";

import {
  isValidSelectedAxisCount,
  LIFESTYLE_AXIS_IDS,
  MAX_SELECTED_LIFESTYLE_AXES,
  MIN_SELECTED_LIFESTYLE_AXES,
} from "./lifestyle-axes.js";

describe("isValidSelectedAxisCount", () => {
  // The bounds are tested here directly (not only through
  // `optimizationRequestSchema`) as the rule itself, independent of how the
  // request contract happens to enforce it.
  it.each([
    [0, false],
    [MIN_SELECTED_LIFESTYLE_AXES, true],
    [MAX_SELECTED_LIFESTYLE_AXES, true],
    [MAX_SELECTED_LIFESTYLE_AXES + 1, false],
  ])("%i selected axes -> %s", (count, expected) => {
    expect(isValidSelectedAxisCount(count)).toBe(expected);
  });

  it("rejects rating every registered axis once the axis set grows past the max", () => {
    // The registry now lists nine axes against a max of five, so this is
    // reachable from a real request — `.strict()` no longer makes the upper
    // bound unreachable the way it did with the original four axes.
    expect(LIFESTYLE_AXIS_IDS.length).toBeGreaterThan(MAX_SELECTED_LIFESTYLE_AXES);
    expect(isValidSelectedAxisCount(LIFESTYLE_AXIS_IDS.length)).toBe(false);
  });
});

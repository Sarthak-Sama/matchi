import { describe, expect, it } from "vitest";

import {
  isValidSelectedAxisCount,
  LIFESTYLE_AXIS_IDS,
  MAX_SELECTED_LIFESTYLE_AXES,
  MIN_SELECTED_LIFESTYLE_AXES,
} from "./lifestyle-axes.js";

describe("isValidSelectedAxisCount", () => {
  // The bounds are tested here rather than only through
  // `optimizationRequestSchema` because the upper bound is currently
  // unreachable from a request: `.strict()` rejects unknown axis keys, so
  // no payload can select more axes than exist. This is the rule itself.
  it.each([
    [0, false],
    [MIN_SELECTED_LIFESTYLE_AXES, true],
    [MAX_SELECTED_LIFESTYLE_AXES, true],
    [MAX_SELECTED_LIFESTYLE_AXES + 1, false],
  ])("%i selected axes -> %s", (count, expected) => {
    expect(isValidSelectedAxisCount(count)).toBe(expected);
  });

  it("accepts rating every registered axis", () => {
    expect(isValidSelectedAxisCount(LIFESTYLE_AXIS_IDS.length)).toBe(true);
  });
});

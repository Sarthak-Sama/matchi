import { describe, expect, it } from "vitest";

import { LAYOUT_IDS, LAYOUTS, optimizationRequestSchema, RENT_LABEL } from "./index.js";

describe("@tokyo/shared barrel", () => {
  it("re-exports scoring config", () => {
    expect(LAYOUT_IDS).toEqual(["1R", "1K", "1DK", "1LDK", "2K_2DK", "2LDK", "3LDK"]);
    expect(RENT_LABEL).toBe("modeled area rent");
  });

  it("re-exports contracts", () => {
    expect(Object.keys(LAYOUTS)).toHaveLength(7);
    expect(optimizationRequestSchema).toBeDefined();
  });
});

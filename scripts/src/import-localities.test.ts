import { describe, expect, it } from "vitest";

import { normalizeLocalityName } from "./import-localities.js";

describe("normalizeLocalityName", () => {
  it("dissolves numeric and Japanese chome suffixes without changing the base name", () => {
    expect(normalizeLocalityName("初台１丁目")).toBe("初台");
    expect(normalizeLocalityName("初台2丁目")).toBe("初台");
    expect(normalizeLocalityName("初台一丁目")).toBe("初台");
    expect(normalizeLocalityName("代々木")).toBe("代々木");
  });
});

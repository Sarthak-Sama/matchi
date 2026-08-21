import { describe, expect, it } from "vitest";

import { SHARED_PACKAGE_NAME } from "./index.js";

describe("@tokyo/shared", () => {
  it("exports the package name constant", () => {
    expect(SHARED_PACKAGE_NAME).toBe("@tokyo/shared");
  });
});

import { describe, expect, it } from "vitest";

import { createRequestGeneration } from "./requestGeneration";

describe("createRequestGeneration", () => {
  it("invalidates an older generation when a newer request begins", () => {
    const requests = createRequestGeneration();
    const olderRequest = requests.begin();
    const newerRequest = requests.begin();

    expect(requests.isCurrent(olderRequest)).toBe(false);
    expect(requests.isCurrent(newerRequest)).toBe(true);
  });
});

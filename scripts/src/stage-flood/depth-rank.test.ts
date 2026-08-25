import { describe, expect, it } from "vitest";

import { floodDepthFromA31201, MAX_DEPTH_RANK } from "./depth-rank.js";

describe("floodDepthFromA31201", () => {
  it("maps codes 1-5 onto the matching rank and band label", () => {
    expect(floodDepthFromA31201(1)).toEqual({ depthRank: 1, depthCategory: "0.5m未満" });
    expect(floodDepthFromA31201(2)).toEqual({ depthRank: 2, depthCategory: "0.5m以上3.0m未満" });
    expect(floodDepthFromA31201(3)).toEqual({ depthRank: 3, depthCategory: "3.0m以上5.0m未満" });
    expect(floodDepthFromA31201(4)).toEqual({ depthRank: 4, depthCategory: "5.0m以上10.0m未満" });
    expect(floodDepthFromA31201(5)).toEqual({
      depthRank: 5,
      depthCategory: "10.0m以上20.0m未満",
    });
  });

  // MLIT splits the deepest band in two; the schema tops out at 5. Folding
  // 6 into 5 keeps the worst areas worst — dropping it would make 20m+
  // inundation zones read as having no flood data at all.
  it("folds the 20m-and-above band into rank 5 rather than dropping it", () => {
    expect(floodDepthFromA31201(6)).toEqual({ depthRank: 5, depthCategory: "20.0m以上" });
    expect(floodDepthFromA31201(6)?.depthRank).toBe(MAX_DEPTH_RANK);
  });

  it("accepts a numeric string, since GeoJSON property types vary by export", () => {
    expect(floodDepthFromA31201("3")).toEqual({ depthRank: 3, depthCategory: "3.0m以上5.0m未満" });
  });

  it("returns null for codes MLIT does not document, rather than guessing a severity", () => {
    for (const bad of [0, 7, -1, 2.5, "", null, undefined, "deep"]) {
      expect(floodDepthFromA31201(bad)).toBeNull();
    }
  });
});

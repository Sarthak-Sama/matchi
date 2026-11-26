import { LAYOUTS } from "@tokyo/shared";
import { describe, expect, it, vi } from "vitest";

import type { DbPool } from "../db.js";
import { loadFeatureStore, toModelParams } from "./feature-store.js";

function area(id: string): Record<string, unknown> {
  return { locality_id: id, name_en: null, name_ja: id, ward_code: "13101", lat: 35.6, lon: 139.7 };
}

function stubPool(areas: Record<string, unknown>[], params: { key: string; value: number }[]): DbPool {
  return {
    query: vi.fn(async (text: string) => {
      if (text.includes("agent.area_features") && text.includes("ORDER BY locality_id")) return { rows: areas };
      if (text.includes("agent.model_params")) return { rows: params };
      if (/agent\.(commute_error_model|rent_size_curve|ward_rent_bands)/.test(text)) return { rows: [] };
      if (text.includes("col_description")) {
        return {
          rows: [
            { column_name: "locality_id", comment: "Stable id" },
            { column_name: "name_en", comment: null },
          ],
        };
      }
      throw new Error(`unexpected query: ${text}`);
    }),
  };
}

describe("toModelParams", () => {
  it("maps rent_land_elasticity and LAYOUTS mid sizes", () => {
    const p = toModelParams([
      { key: "rent_land_elasticity", value: 0.3555 },
      { key: "reach_decay_minutes", value: 10 },
    ]);
    expect(p.rentElasticity).toBe(0.3555);
    expect(p.layoutAreaSqm["1K"]).toBe(LAYOUTS["1K"].midSqm);
    expect(Object.keys(p.layoutAreaSqm)).toHaveLength(Object.keys(LAYOUTS).length);
  });

  it("throws when the elasticity row is missing", () => {
    expect(() => toModelParams([{ key: "reach_decay_minutes", value: 10 }])).toThrow(/rent_land_elasticity/);
  });
});

describe("loadFeatureStore", () => {
  it("returns areas, index, params and non-null column comments", async () => {
    const store = await loadFeatureStore(
      stubPool([area("a"), area("b")], [{ key: "rent_land_elasticity", value: 0.36 }]),
    );
    expect(store.areas.map((a) => a.locality_id)).toEqual(["a", "b"]);
    expect(store.areaIndex.get("b")).toBe(1);
    expect(store.params.rentElasticity).toBe(0.36);
    expect(store.columnComments).toEqual({ locality_id: "Stable id" });
  });

  it("rejects an empty view and duplicate ids", async () => {
    const params = [{ key: "rent_land_elasticity", value: 0.36 }];
    await expect(loadFeatureStore(stubPool([], params))).rejects.toThrow(/no rows/);
    await expect(loadFeatureStore(stubPool([area("a"), area("a")], params))).rejects.toThrow(/duplicate/);
  });
});

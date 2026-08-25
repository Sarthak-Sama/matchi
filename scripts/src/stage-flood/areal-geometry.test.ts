import { describe, expect, it } from "vitest";

import { toArealGeometry } from "./areal-geometry.js";

const SQUARE = [
  [
    [139.7, 35.6],
    [139.71, 35.6],
    [139.71, 35.61],
    [139.7, 35.61],
    [139.7, 35.6],
  ],
];

describe("toArealGeometry", () => {
  it("passes Polygon and MultiPolygon through untouched", () => {
    const polygon = { type: "Polygon", coordinates: SQUARE };
    expect(toArealGeometry(polygon)).toBe(polygon);

    const multi = { type: "MultiPolygon", coordinates: [SQUARE] };
    expect(toArealGeometry(multi)).toBe(multi);
  });

  // The real shape GDAL returns when a flood polygon grazes a ward edge.
  it("extracts the polygon from a collection that also holds a clip sliver", () => {
    const result = toArealGeometry({
      type: "GeometryCollection",
      geometries: [
        { type: "LineString", coordinates: [[139.7, 35.6], [139.71, 35.6]] },
        { type: "Polygon", coordinates: SQUARE },
      ],
    });
    expect(result).toEqual({ type: "MultiPolygon", coordinates: [SQUARE] });
  });

  it("flattens MultiPolygon members of a collection rather than nesting them", () => {
    const result = toArealGeometry({
      type: "GeometryCollection",
      geometries: [
        { type: "MultiPolygon", coordinates: [SQUARE, SQUARE] },
        { type: "Point", coordinates: [139.7, 35.6] },
      ],
    });
    expect(result).toEqual({ type: "MultiPolygon", coordinates: [SQUARE, SQUARE] });
  });

  it("returns null when a clip left no area at all", () => {
    expect(
      toArealGeometry({
        type: "GeometryCollection",
        geometries: [
          { type: "LineString", coordinates: [[139.7, 35.6], [139.71, 35.6]] },
          { type: "Point", coordinates: [139.7, 35.6] },
        ],
      }),
    ).toBeNull();
    expect(toArealGeometry({ type: "LineString", coordinates: [] })).toBeNull();
    expect(toArealGeometry(null)).toBeNull();
    expect(toArealGeometry(undefined)).toBeNull();
  });
});

/**
 * Reduces a clipped GeoJSON geometry to its areal part.
 *
 * Clipping a polygon against a boundary does not always yield a polygon.
 * Where a flood polygon merely grazes a ward edge, GDAL returns a
 * `GeometryCollection` holding the real polygon alongside zero-area
 * slivers — a `LineString` along the shared edge, or a `Point` at a
 * touching corner. `import-mlit/flood.ts` requires a Polygon or
 * MultiPolygon and rejects the collection outright, which aborts the whole
 * import on the first graze (feature #1175 of the real Tokyo clip).
 *
 * Dropping the non-areal members is the correct reduction, not a
 * convenience: a zero-area sliver contributes nothing to
 * `derive/flood.ts`'s `share * depth_rank`, so keeping it could only
 * distort the result. This mirrors the `ST_CollectionExtract(..., 3)`
 * already applied on the PostGIS side for green spaces.
 */

export interface GeoJSONGeometry {
  readonly type: string;
  readonly coordinates?: unknown;
  readonly geometries?: readonly GeoJSONGeometry[];
}

/**
 * Returns a Polygon/MultiPolygon geometry, or null when the input holds no
 * areal part at all (a clip that produced only an edge or a corner).
 */
export function toArealGeometry(geometry: unknown): GeoJSONGeometry | null {
  if (typeof geometry !== "object" || geometry === null) return null;
  const geom = geometry as GeoJSONGeometry;

  if (geom.type === "Polygon" || geom.type === "MultiPolygon") return geom;

  if (geom.type === "GeometryCollection") {
    const polygons: unknown[] = [];
    for (const member of geom.geometries ?? []) {
      if (member.type === "Polygon") {
        polygons.push(member.coordinates);
      } else if (member.type === "MultiPolygon" && Array.isArray(member.coordinates)) {
        polygons.push(...member.coordinates);
      }
    }
    if (polygons.length === 0) return null;
    return { type: "MultiPolygon", coordinates: polygons };
  }

  return null;
}

export interface GeoJSONFeature {
  readonly type: "Feature";
  readonly properties: Readonly<Record<string, unknown>> | null;
  readonly geometry: GeoJSONGeometry;
}

export interface GeoJSONGeometry {
  readonly type: string;
  readonly coordinates: unknown;
}

type Position = readonly [number, number];

export function parseFeatureCollection(raw: string, label: string): readonly GeoJSONFeature[] {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`${label}: not valid JSON (${message})`, { cause: err });
  }

  if (
    typeof json !== "object" ||
    json === null ||
    (json as Record<string, unknown>)["type"] !== "FeatureCollection" ||
    !Array.isArray((json as Record<string, unknown>)["features"])
  ) {
    throw new Error(`${label}: expected a GeoJSON FeatureCollection`);
  }

  return (json as { features: readonly GeoJSONFeature[] }).features;
}

export function pickProperty(
  properties: Readonly<Record<string, unknown>>,
  candidates: readonly string[],
): unknown {
  for (const key of candidates) {
    const value = properties[key];
    if (value !== undefined && value !== null && value !== "") {
      return value;
    }
  }
  return undefined;
}

const JAPAN_BOUNDS = { minLon: 122, maxLon: 154, minLat: 20, maxLat: 46 } as const;

export function assertJapanBounds(lon: number, lat: number, context: string): void {
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
    throw new Error(`${context}: non-finite coordinate [${String(lon)}, ${String(lat)}]`);
  }
  if (
    lon < JAPAN_BOUNDS.minLon ||
    lon > JAPAN_BOUNDS.maxLon ||
    lat < JAPAN_BOUNDS.minLat ||
    lat > JAPAN_BOUNDS.maxLat
  ) {
    throw new Error(
      `${context}: coordinate [${lon}, ${lat}] is outside Japan's bounding box — check for a ` +
        `swapped lat/lon pair or a source file that isn't in EPSG:4326.`,
    );
  }
}

function toPosition(value: unknown, context: string): Position {
  if (!Array.isArray(value) || value.length < 2) {
    throw new Error(`${context}: expected a [lon, lat] coordinate pair`);
  }
  const [lon, lat] = value as [unknown, unknown];
  if (typeof lon !== "number" || typeof lat !== "number") {
    throw new Error(`${context}: coordinate pair must be numeric`);
  }
  assertJapanBounds(lon, lat, context);
  return [lon, lat];
}

export function pointGeometryToLonLat(geometry: GeoJSONGeometry, context: string): Position {
  if (geometry.type !== "Point") {
    throw new Error(`${context}: expected a Point geometry, got ${geometry.type}`);
  }
  return toPosition(geometry.coordinates, context);
}

function ringWKT(ring: unknown, context: string): string {
  if (!Array.isArray(ring)) {
    throw new Error(`${context}: expected a ring of coordinates`);
  }
  const positions = ring.map((p) => toPosition(p, context));
  return `(${positions.map(([lon, lat]) => `${lon} ${lat}`).join(", ")})`;
}

function polygonWKT(polygon: unknown, context: string): string {
  if (!Array.isArray(polygon)) {
    throw new Error(`${context}: expected a polygon (array of rings)`);
  }
  return `(${polygon.map((ring) => ringWKT(ring, context)).join(", ")})`;
}

export function polygonGeometryToMultiPolygonWKT(
  geometry: GeoJSONGeometry,
  context: string,
): string {
  let polygons: unknown;
  if (geometry.type === "Polygon") {
    polygons = [geometry.coordinates];
  } else if (geometry.type === "MultiPolygon") {
    polygons = geometry.coordinates;
  } else {
    throw new Error(
      `${context}: expected a Polygon or MultiPolygon geometry, got ${geometry.type}`,
    );
  }
  if (!Array.isArray(polygons)) {
    throw new Error(`${context}: malformed polygon coordinates`);
  }
  return `MULTIPOLYGON(${polygons.map((p) => polygonWKT(p, context)).join(", ")})`;
}

function lineWKT(line: unknown, context: string): string {
  if (!Array.isArray(line)) {
    throw new Error(`${context}: expected a line (array of coordinates)`);
  }
  const positions = line.map((p) => toPosition(p, context));
  return `(${positions.map(([lon, lat]) => `${lon} ${lat}`).join(", ")})`;
}

export function lineGeometryToMultiLineStringWKT(
  geometry: GeoJSONGeometry,
  context: string,
): string {
  let lines: unknown;
  if (geometry.type === "LineString") {
    lines = [geometry.coordinates];
  } else if (geometry.type === "MultiLineString") {
    lines = geometry.coordinates;
  } else {
    throw new Error(
      `${context}: expected a LineString or MultiLineString geometry, got ${geometry.type}`,
    );
  }
  if (!Array.isArray(lines)) {
    throw new Error(`${context}: malformed line coordinates`);
  }
  return `MULTILINESTRING(${lines.map((l) => lineWKT(l, context)).join(", ")})`;
}

export function pointWKT([lon, lat]: Position): string {
  return `POINT(${lon} ${lat})`;
}

export function slug(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

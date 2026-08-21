/**
 * Small geometry helpers used by the seed fixtures: WKT builders and a
 * deterministic seeded PRNG for generating filler points. No `Math.random()`
 * and no clock reads anywhere in this module — the same seed always
 * produces the same sequence, which is what makes `pnpm db:seed` idempotent
 * (row-for-row identical) across runs.
 */

export type LonLat = readonly [lon: number, lat: number];

/** Metres per degree of latitude — constant everywhere. */
const METERS_PER_DEGREE_LAT = 111_320;

/** Metres per degree of longitude at a given latitude (shrinks toward the poles). */
function metersPerDegreeLon(latDeg: number): number {
  return METERS_PER_DEGREE_LAT * Math.cos((latDeg * Math.PI) / 180);
}

export function pointWKT([lon, lat]: LonLat): string {
  return `POINT(${lon} ${lat})`;
}

/** Closes the ring (repeats the first vertex) if the caller didn't already. */
function closedRing(vertices: readonly LonLat[]): readonly LonLat[] {
  const first = vertices[0];
  const last = vertices[vertices.length - 1];
  if (!first || !last) throw new Error("polygon needs at least 3 vertices");
  if (first[0] === last[0] && first[1] === last[1]) return vertices;
  return [...vertices, first];
}

function ringWKT(vertices: readonly LonLat[]): string {
  const ring = closedRing(vertices);
  return `(${ring.map(([lon, lat]) => `${lon} ${lat}`).join(", ")})`;
}

export function polygonWKT(vertices: readonly LonLat[]): string {
  return `POLYGON(${ringWKT(vertices)})`;
}

export function multiPolygonWKT(polygons: readonly (readonly LonLat[])[]): string {
  // Each polygon is itself wrapped in an extra pair of parens (one polygon
  // = one set of rings, here always just the single outer ring — no holes).
  return `MULTIPOLYGON(${polygons.map((p) => `(${ringWKT(p)})`).join(", ")})`;
}

export function lineStringWKT(vertices: readonly LonLat[]): string {
  return `(${vertices.map(([lon, lat]) => `${lon} ${lat}`).join(", ")})`;
}

export function multiLineStringWKT(lines: readonly (readonly LonLat[])[]): string {
  return `MULTILINESTRING(${lines.map((l) => lineStringWKT(l)).join(", ")})`;
}

/**
 * Deterministic PRNG (mulberry32). Same seed -> same sequence, every run,
 * on every machine. Used only for filler fixtures (bulk POIs / land-price
 * points); every fixture property later tests depend on is hand-authored,
 * not generated.
 */
export function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return function next(): number {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A uniform random float in `[min, max)` drawn from `rng`. */
export function randRange(rng: () => number, min: number, max: number): number {
  return min + rng() * (max - min);
}

/** A uniform random pick from a non-empty array. */
export function randChoice<T>(rng: () => number, items: readonly T[]): T {
  const item = items[Math.floor(rng() * items.length)];
  if (item === undefined) throw new Error("randChoice: empty array");
  return item;
}

/**
 * A point within `maxRadiusM` metres of `center`, drawn uniformly over the
 * disc (not just the bounding box) so filler stays realistically clustered
 * near the station it belongs to.
 */
export function jitterPoint(center: LonLat, maxRadiusM: number, rng: () => number): LonLat {
  const [lon, lat] = center;
  const r = maxRadiusM * Math.sqrt(rng());
  const theta = rng() * 2 * Math.PI;
  const dLat = (r * Math.sin(theta)) / METERS_PER_DEGREE_LAT;
  const dLon = (r * Math.cos(theta)) / metersPerDegreeLon(lat);
  return [lon + dLon, lat + dLat];
}

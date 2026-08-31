export type LonLat = readonly [lon: number, lat: number];

const METERS_PER_DEGREE_LAT = 111_320;

function metersPerDegreeLon(latDeg: number): number {
  return METERS_PER_DEGREE_LAT * Math.cos((latDeg * Math.PI) / 180);
}

export function pointWKT([lon, lat]: LonLat): string {
  return `POINT(${lon} ${lat})`;
}

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
  return `MULTIPOLYGON(${polygons.map((p) => `(${ringWKT(p)})`).join(", ")})`;
}

export function lineStringWKT(vertices: readonly LonLat[]): string {
  return `(${vertices.map(([lon, lat]) => `${lon} ${lat}`).join(", ")})`;
}

export function multiLineStringWKT(lines: readonly (readonly LonLat[])[]): string {
  return `MULTILINESTRING(${lines.map((l) => lineStringWKT(l)).join(", ")})`;
}

export function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return function next(): number {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randRange(rng: () => number, min: number, max: number): number {
  return min + rng() * (max - min);
}

export function randChoice<T>(rng: () => number, items: readonly T[]): T {
  const item = items[Math.floor(rng() * items.length)];
  if (item === undefined) throw new Error("randChoice: empty array");
  return item;
}

export function jitterPoint(center: LonLat, maxRadiusM: number, rng: () => number): LonLat {
  const [lon, lat] = center;
  const r = maxRadiusM * Math.sqrt(rng());
  const theta = rng() * 2 * Math.PI;
  const dLat = (r * Math.sin(theta)) / METERS_PER_DEGREE_LAT;
  const dLon = (r * Math.cos(theta)) / metersPerDegreeLon(lat);
  return [lon + dLon, lat + dLat];
}

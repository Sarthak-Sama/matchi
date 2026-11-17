import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { TOKYO_23_WARDS_BBOX } from "@tokyo/shared";

import { classifyRailMode } from "./stage-mlit/rail-mode.js";

interface Feature {
  readonly type: string;
  readonly properties: Record<string, unknown> | null;
  readonly geometry: { readonly type: string; readonly coordinates: unknown } | null;
}

interface FeatureCollection {
  readonly type: string;
  readonly features: readonly Feature[];
}

export interface StageMlitArgs {
  readonly stationsIn: string;
  readonly railIn: string;
  readonly wardsIn: string;
  readonly stationsOut: string;
  readonly railOut: string;
}

function flagValue(argv: readonly string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

export function parseArgs(argv: readonly string[]): StageMlitArgs {
  const stationsIn = flagValue(argv, "--stations-in");
  const railIn = flagValue(argv, "--rail-in");
  const wardsIn = flagValue(argv, "--wards");
  const stationsOut = flagValue(argv, "--stations-out");
  const railOut = flagValue(argv, "--rail-out");
  if (!stationsIn || !railIn || !wardsIn || !stationsOut || !railOut) {
    throw new Error(
      "stage:mlit requires --stations-in, --rail-in, --wards, --stations-out and --rail-out. See this " +
        "file's doc comment for a worked example.",
    );
  }
  return { stationsIn, railIn, wardsIn, stationsOut, railOut };
}

export function firstLonLat(coordinates: unknown): readonly [number, number] | null {
  let cursor: unknown = coordinates;
  while (Array.isArray(cursor) && Array.isArray(cursor[0])) cursor = cursor[0];
  if (!Array.isArray(cursor)) return null;
  const [lon, lat] = cursor;
  if (typeof lon !== "number" || typeof lat !== "number") return null;
  return [lon, lat];
}

export function withinTokyo(coordinates: unknown): boolean {
  const point = firstLonLat(coordinates);
  if (point === null) return false;
  const [lon, lat] = point;
  return (
    lon >= TOKYO_23_WARDS_BBOX.west &&
    lon <= TOKYO_23_WARDS_BBOX.east &&
    lat >= TOKYO_23_WARDS_BBOX.south &&
    lat <= TOKYO_23_WARDS_BBOX.north
  );
}

type Point = readonly [number, number];

function isPoint(value: unknown): value is Point {
  return Array.isArray(value) && typeof value[0] === "number" && typeof value[1] === "number";
}

function ringContains(point: Point, ring: unknown): boolean {
  if (!Array.isArray(ring)) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (!isPoint(a) || !isPoint(b)) continue;
    const [xi, yi] = a;
    const [xj, yj] = b;
    if (
      yi > point[1] !== yj > point[1] &&
      point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi
    )
      inside = !inside;
  }
  return inside;
}

export function pointInWardUnion(point: Point, wards: FeatureCollection): boolean {
  return createWardContains(wards)(point);
}

interface WardPolygon {
  readonly outer: unknown;
  readonly holes: readonly unknown[];
  readonly west: number;
  readonly south: number;
  readonly east: number;
  readonly north: number;
}

function ringBounds(
  ring: unknown,
): { west: number; south: number; east: number; north: number } | null {
  if (!Array.isArray(ring)) return null;
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const position of ring) {
    if (
      !Array.isArray(position) ||
      typeof position[0] !== "number" ||
      typeof position[1] !== "number"
    )
      continue;
    west = Math.min(west, position[0]);
    south = Math.min(south, position[1]);
    east = Math.max(east, position[0]);
    north = Math.max(north, position[1]);
  }
  return Number.isFinite(west) ? { west, south, east, north } : null;
}

function polygonRingSets(geometry: Feature["geometry"]): unknown {
  if (geometry?.type === "Polygon") return [geometry.coordinates];
  if (geometry?.type === "MultiPolygon") return geometry.coordinates;
  return [];
}

function pointInPolygon(point: Point, polygon: WardPolygon): boolean {
  const inBounds =
    point[0] >= polygon.west &&
    point[0] <= polygon.east &&
    point[1] >= polygon.south &&
    point[1] <= polygon.north;
  if (!inBounds) return false;
  return (
    ringContains(point, polygon.outer) && !polygon.holes.some((hole) => ringContains(point, hole))
  );
}

function createWardContains(wards: FeatureCollection): (point: Point) => boolean {
  const polygons: WardPolygon[] = [];
  for (const feature of wards.features) {
    const ringSets = polygonRingSets(feature.geometry);
    if (!Array.isArray(ringSets)) continue;
    for (const polygon of ringSets) {
      if (!Array.isArray(polygon) || !polygon[0]) continue;
      const bounds = ringBounds(polygon[0]);
      if (bounds) polygons.push({ outer: polygon[0], holes: polygon.slice(1), ...bounds });
    }
  }
  return (point) => polygons.some((polygon) => pointInPolygon(point, polygon));
}

export function centroidOfLineGeometry(geometry: Feature["geometry"]): Point | null {
  if (!geometry || (geometry.type !== "LineString" && geometry.type !== "MultiLineString"))
    return null;
  const lines = geometry.type === "LineString" ? [geometry.coordinates] : geometry.coordinates;
  let lon = 0;
  let lat = 0;
  let total = 0;
  for (const line of Array.isArray(lines) ? lines : []) {
    if (!Array.isArray(line)) continue;
    for (let i = 1; i < line.length; i += 1) {
      const a = line[i - 1];
      const b = line[i];
      if (!isPoint(a) || !isPoint(b)) continue;
      const [ax, ay] = a;
      const [bx, by] = b;
      const length = Math.hypot(bx - ax, by - ay);
      lon += ((ax + bx) / 2) * length;
      lat += ((ay + by) / 2) * length;
      total += length;
    }
  }
  return total > 0 ? [lon / total, lat / total] : null;
}

function readCollection(path: string): FeatureCollection {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !Array.isArray((parsed as Record<string, unknown>)["features"])
  ) {
    throw new Error(`${path}: expected a GeoJSON FeatureCollection with a "features" array`);
  }
  return parsed as FeatureCollection;
}

function writeCollection(path: string, features: readonly Feature[]): void {
  writeFileSync(path, JSON.stringify({ type: "FeatureCollection", features }));
}

function stringProp(properties: Record<string, unknown> | null, key: string): string | null {
  const value = properties?.[key];
  return typeof value === "string" || typeof value === "number" ? String(value) : null;
}

export interface StageResult {
  readonly stationsWritten: number;
  readonly railLinesWritten: number;
  readonly railSectionsDissolved: number;
  readonly unclassified: readonly string[];
}

export function stageStations(collection: FeatureCollection, wards: FeatureCollection): Feature[] {
  const staged: Feature[] = [];
  const wardContains = createWardContains(wards);
  for (const feature of collection.features) {
    const geometry = feature.geometry;
    if (geometry === null) continue;
    const point =
      geometry.type === "Point"
        ? firstLonLat(geometry.coordinates)
        : centroidOfLineGeometry(geometry);
    if (!point)
      throw new Error(
        `stage:mlit — station geometry is "${geometry.type}", expected Point or LineString`,
      );
    if (!wardContains(point)) continue;
    staged.push({ ...feature, geometry: { type: "Point", coordinates: point } });
  }
  return staged;
}

interface LineGroup {
  operator: string;
  nameJa: string;
  mode: string;

  parts: unknown[];
  sections: number;
}

export function stageRailLines(
  collection: FeatureCollection,
  wards: FeatureCollection,
): {
  readonly features: Feature[];
  readonly unclassified: string[];
  readonly sectionsDissolved: number;
} {
  const unclassified = new Set<string>();

  const groups = new Map<string, LineGroup>();
  const wardContains = createWardContains(wards);
  let sectionsDissolved = 0;

  for (const feature of collection.features) {
    const geometry = feature.geometry;
    if (geometry === null) continue;
    const probe = firstLonLat(geometry.coordinates);
    if (probe === null || (!wardContains(probe) && !withinTokyo(geometry.coordinates))) continue;

    const properties = feature.properties;
    const operator = stringProp(properties, "N02_004");
    const nameJa = stringProp(properties, "N02_003");
    const mode = classifyRailMode({
      railwayClass: stringProp(properties, "N02_001"),
      operatorType: stringProp(properties, "N02_002"),
      operator,
    });

    if (mode === null) {
      const railwayClass = stringProp(properties, "N02_001") ?? "(no N02_001)";
      unclassified.add(`${operator ?? "(unknown operator)"} [N02_001=${railwayClass}]`);
      continue;
    }
    if (operator === null || nameJa === null) continue;

    sectionsDissolved += 1;
    const key = `${operator}\u0000${nameJa}`;
    const group = groups.get(key) ?? { operator, nameJa, mode, parts: [], sections: 0 };
    group.sections += 1;
    if (geometry.type === "LineString") {
      group.parts.push(geometry.coordinates);
    } else if (geometry.type === "MultiLineString" && Array.isArray(geometry.coordinates)) {
      group.parts.push(...geometry.coordinates);
    }
    groups.set(key, group);
  }

  const features: Feature[] = [...groups.values()].map((group) => ({
    type: "Feature",
    properties: {
      N02_003: group.nameJa,
      N02_004: group.operator,
      mode: group.mode,
      section_count: group.sections,
    },
    geometry: { type: "MultiLineString", coordinates: group.parts },
  }));

  return { features, unclassified: [...unclassified].sort(), sectionsDissolved };
}

export function runStageMlit(args: StageMlitArgs): StageResult {
  const wards = readCollection(args.wardsIn);
  const stations = stageStations(readCollection(args.stationsIn), wards);
  writeCollection(args.stationsOut, stations);

  const rail = stageRailLines(readCollection(args.railIn), wards);
  writeCollection(args.railOut, rail.features);

  return {
    stationsWritten: stations.length,
    railLinesWritten: rail.features.length,
    railSectionsDissolved: rail.sectionsDissolved,
    unclassified: rail.unclassified,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const result = runStageMlit(args);

  console.log(
    `stage:mlit — stations=${String(result.stationsWritten)} -> ${args.stationsOut}\n` +
      `stage:mlit — rail_lines=${String(result.railLinesWritten)} ` +
      `(dissolved from ${String(result.railSectionsDissolved)} sections) -> ${args.railOut}`,
  );

  if (result.unclassified.length > 0) {
    console.warn(
      `stage:mlit — ${String(result.unclassified.length)} operator/class combination(s) could not ` +
        `be classified into a rail mode and were EXCLUDED:\n  ` +
        result.unclassified.join("\n  "),
    );
  }
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  });
}

/**
 * `pnpm stage:mlit` — turns the raw MLIT N02 railway export into the two
 * files `pnpm import:mlit` expects.
 *
 *   pnpm stage:mlit \
 *     --stations-in  data/staged/mlit/n02-25-stations-centroids.geojson \
 *     --rail-in      data/staged/mlit/n02-25-rail-sections.geojson \
 *     --stations-out data/stations.geojson \
 *     --rail-out     data/rail-lines.geojson
 *
 * Two gaps between what MLIT publishes and what the importers require,
 * both documented in the importers themselves:
 *
 * 1. **Stations arrive as LineStrings.** MLIT models a station as the
 *    short segment of track inside it, but `import-mlit/stations.ts` needs
 *    a Point. Each segment collapses to its centroid. The input this
 *    script reads has already had that conversion applied; this script
 *    verifies it rather than assuming it, because a LineString slipping
 *    through would fail deep inside the import with a less obvious message.
 *
 * 2. **Rail sections carry no `mode`.** `import-mlit/rail-lines.ts`
 *    requires one and says so explicitly. `stage-mlit/rail-mode.ts`
 *    derives it from `N02_001`/`N02_002`/`N02_004`.
 *
 * 3. **N02 ships rail SECTIONS; `rail_lines` wants one row per LINE.** Each
 *    N02 feature is a short segment of track, and 1,737 Tokyo segments
 *    share just 68 operator+line names. Because `import-mlit/rail-lines.ts`
 *    derives its natural key from exactly that pair, importing the raw
 *    sections upserts all of them onto 68 rows and each line ends up
 *    holding one arbitrary 1-5 km stub instead of its full length. That is
 *    not a cosmetic loss: `import:transit --from-topology` orders stations
 *    along a line's geometry, so with stub geometry 76% of station groups
 *    got no rail edges at all and the graph validator rejected the import.
 *    Sections are therefore dissolved here into one MultiLineString per
 *    line, which is the shape `lineGeometryToMultiLineStringWKT` expects.
 *
 * Both datasets are nationwide — 10,234 stations and 21,933 rail sections
 * covering all of Japan, including Kagoshima and Okinawa. Both are
 * filtered to `TOKYO_23_WARDS_BBOX`, the same bounding box `import:osm`
 * uses, so the two imports describe the same area.
 *
 * This script writes files and touches no database.
 */

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
  const stationsOut = flagValue(argv, "--stations-out");
  const railOut = flagValue(argv, "--rail-out");
  if (!stationsIn || !railIn || !stationsOut || !railOut) {
    throw new Error(
      "stage:mlit requires --stations-in, --rail-in, --stations-out and --rail-out. See this " +
        "file's doc comment for a worked example.",
    );
  }
  return { stationsIn, railIn, stationsOut, railOut };
}

/** First coordinate pair of any geometry, used for the bounding-box test. */
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

export function stageStations(collection: FeatureCollection): Feature[] {
  const staged: Feature[] = [];
  for (const feature of collection.features) {
    const geometry = feature.geometry;
    if (geometry === null) continue;
    if (geometry.type !== "Point") {
      throw new Error(
        `stage:mlit — station geometry is "${geometry.type}", expected "Point". MLIT ships ` +
          `stations as LineStrings; convert them to centroids before running this script.`,
      );
    }
    if (!withinTokyo(geometry.coordinates)) continue;
    staged.push(feature);
  }
  return staged;
}

interface LineGroup {
  operator: string;
  nameJa: string;
  mode: string;
  /** Every section's LineString, accumulated into one MultiLineString. */
  parts: unknown[];
  sections: number;
}

export function stageRailLines(collection: FeatureCollection): {
  readonly features: Feature[];
  readonly unclassified: string[];
  readonly sectionsDissolved: number;
} {
  const unclassified = new Set<string>();
  // Keyed by operator + line name, the same pair
  // `import-mlit/rail-lines.ts` builds its natural key from.
  const groups = new Map<string, LineGroup>();
  let sectionsDissolved = 0;

  for (const feature of collection.features) {
    const geometry = feature.geometry;
    if (geometry === null || !withinTokyo(geometry.coordinates)) continue;

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
  const stations = stageStations(readCollection(args.stationsIn));
  writeCollection(args.stationsOut, stations);

  const rail = stageRailLines(readCollection(args.railIn));
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

  // Per the plan: report any line that cannot be classified, rather than
  // bucketing it into a mode it does not belong to.
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

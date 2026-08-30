/**
 * Generates `web/app/components/tokyo-wards.ts` — the static SVG plate the
 * landing hero and the search hero draw.
 *
 * The hero needs Tokyo's real shape, but the frontend must not pay for it:
 * fetching boundaries at runtime would put a megabyte of geometry and a
 * round trip in front of the first paint, for a graphic that never changes.
 * So the geometry is simplified, projected, and frozen into a source file
 * here — a build-time step run by hand whenever the ward import changes,
 * not part of `data:refresh`.
 *
 * The projection is deliberately the same equirectangular-with-cos(latitude)
 * one `ResultsMap` applies at runtime, so the hero plate and the results map
 * share a cartography rather than merely a palette.
 *
 * Usage: pnpm build:ward-plate
 */

import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { createPool } from "./lib/db.js";

/** Douglas–Peucker tolerance in degrees (~140 m). Keeps every ward's
 *  silhouette legible at hero size while cutting the payload ~50x. */
const SIMPLIFY_TOLERANCE_DEG = 0.0016;

const VIEW_WIDTH = 620;
const VIEW_HEIGHT = 560;
const PADDING = 14;

/**
 * The anchors most readers already hold in their head.
 *
 * The romanizations are supplied here rather than read from the database
 * on purpose: MLIT ships no English station names (`name_en` repeats
 * `name_ja`), and a hero whose six labels all read "新宿 / 新宿" orients
 * nobody. These six are editorial labelling of six named landmarks, not
 * data — which is why they live in this script and never reach a result.
 */
const REFERENCE_STATIONS = [
  { nameJa: "新宿", romanized: "Shinjuku" },
  { nameJa: "池袋", romanized: "Ikebukuro" },
  { nameJa: "上野", romanized: "Ueno" },
  { nameJa: "東京", romanized: "Tokyo" },
  { nameJa: "渋谷", romanized: "Shibuya" },
  { nameJa: "品川", romanized: "Shinagawa" },
] as const;

/**
 * Two files, not one. The ward outlines and reference stations are drawn by
 * both heroes; the 937 locality points and the worked example are drawn
 * only by the landing plate. Emitting them separately keeps roughly fifteen
 * kilobytes of coordinates out of the search page's bundle — this repo
 * disables webpack's module concatenation (see web/next.config.ts), so
 * unused exports from a shared module are not reliably shaken out.
 */
const WARDS_PATH = new URL("../../web/app/components/tokyo-wards.ts", import.meta.url);
const LOCALITIES_PATH = new URL(
  "../../web/app/components/landing/tokyo-localities.ts",
  import.meta.url,
);

/**
 * The worked example the landing page animates: a real request, sent to a
 * real `/v1/optimize`, whose real winners are frozen into the plate. The
 * landing page states these parameters on screen beside the result, so the
 * reader is looking at output from the actual engine rather than at a
 * designer's guess about what output might look like.
 *
 * If the API is unreachable when this script runs, generation fails loudly
 * rather than emitting a plate with an invented shortlist.
 */
const EXAMPLE_REQUEST = {
  destinationNameJa: "渋谷",
  arrivalTime: "08:30",
  maxCommuteMinutes: 45,
  monthlyBudgetYen: 200_000,
  layout: "1LDK",
  preferences: { supermarkets: "medium", quietness: "high" },
} as const;

const API_BASE_URL = process.env["API_BASE_URL"] ?? "http://localhost:4000";

type Ring = [number, number][];
interface GeoJsonPolygon {
  readonly type: "Polygon" | "MultiPolygon";
  readonly coordinates: Ring[][] | Ring[];
}
interface WardRow {
  readonly ward_code: string;
  readonly name_en: string;
  readonly name_ja: string;
  readonly geojson: GeoJsonPolygon;
}
interface StationRow {
  readonly name_ja: string;
  readonly lat: number;
  readonly lon: number;
}

interface LocalityRow {
  readonly locality_id: string;
  readonly lat: number;
  readonly lon: number;
}

interface OptimizeResult {
  readonly localityId: string;
  readonly nameJa: string;
  readonly nameEn: string;
  readonly wardNameEn: string;
  readonly rank: number;
  readonly overallScore: number;
  readonly rent: { readonly lowYen: number; readonly highYen: number };
  readonly commute: { readonly totalMinutes: number; readonly transferCount: number };
  readonly factors: readonly {
    readonly key: string;
    readonly label: string;
    readonly componentScore: number;
    readonly rawValueLabel: string;
  }[];
}

interface OptimizeDiagnostics {
  readonly candidatesConsidered: number;
  readonly excludedByRent: number;
  readonly excludedByCommute: number;
  readonly excludedByDisconnected: number;
  /** Authoritative: the engine's own count of what cleared every filter. */
  readonly feasibleCount: number;
}

/**
 * Counts of the evidence behind each lifestyle axis. Each axis rests on a
 * different kind of record — points of interest, distinct cuisine tags,
 * park polygons, zoning and rail geometry — so the landing page states the
 * unit rather than pretending they are all the same measurement.
 */
const AXIS_EVIDENCE_SQL = `
  SELECT
    (SELECT count(*) FROM pois WHERE category IN ('supermarket','grocery')) AS supermarkets,
    (SELECT count(*) FROM pois WHERE category IN ('restaurant','cafe')) AS restaurants,
    (SELECT count(*) FROM pois WHERE category = 'convenience') AS konbini,
    (SELECT count(*) FROM pois WHERE category = 'health') AS health,
    (SELECT count(DISTINCT cuisine) FROM pois WHERE cuisine IS NOT NULL) AS cuisine_variety,
    (SELECT count(*) FROM pois
      WHERE category IN ('restaurant','cafe','bar','convenience')
        AND (opening_hours = '24/7' OR opening_hours ~ '-2[3-9]:[0-5][0-9]')) AS late_night,
    (SELECT count(*) FROM green_spaces) AS green_space,
    (SELECT count(*) FROM zoning_areas) AS zoning_areas,
    (SELECT count(*) FROM rail_edges) AS rail_edges,
    (SELECT count(*) FROM station_groups) AS station_groups
`;

function ringsOf(geometry: GeoJsonPolygon): Ring[] {
  return geometry.type === "MultiPolygon"
    ? (geometry.coordinates as Ring[][]).flat()
    : (geometry.coordinates as Ring[]);
}

/**
 * A fixed, seedless shuffle: the same input always produces the same
 * output, so regenerating the plate does not churn the file for no reason.
 */
function shuffleDeterministically(items: readonly string[]): string[] {
  const out = [...items];
  let seed = 20260830;
  for (let index = out.length - 1; index > 0; index -= 1) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    const swap = seed % (index + 1);
    const a = out[index];
    const b = out[swap];
    if (a !== undefined && b !== undefined) {
      out[index] = b;
      out[swap] = a;
    }
  }
  return out;
}

/**
 * The fields the landing page shows from the top recommendation. Pulled
 * apart here rather than in the page so the generated module carries the
 * engine's output verbatim and the page does no interpreting of its own.
 */
function describeTopResult(results: readonly OptimizeResult[]): unknown {
  const top = results[0];
  if (top === undefined) throw new Error("no top result to describe");
  const lifestyle = top.factors.filter(
    (factor) => factor.key !== "affordability" && factor.key !== "commute",
  );
  const strongest = [...lifestyle].sort((a, b) => b.componentScore - a.componentScore)[0];
  const weakest = [...top.factors].sort((a, b) => a.componentScore - b.componentScore)[0];
  if (strongest === undefined || weakest === undefined) {
    throw new Error("top result carried no factors");
  }
  return {
    nameJa: top.nameJa,
    nameEn: top.nameEn,
    wardNameEn: top.wardNameEn,
    score: Math.round(top.overallScore),
    commuteMinutes: Math.round(top.commute.totalMinutes),
    transfers: top.commute.transferCount,
    rentLowYen: top.rent.lowYen,
    rentHighYen: top.rent.highYen,
    strength: strongest.rawValueLabel,
    weakest: { label: weakest.label, score: Math.round(weakest.componentScore) },
  };
}

/** Groups emitted literals so the generated array is not one line per number. */
function chunk(items: readonly string[], perLine: number): string[] {
  const lines: string[] = [];
  for (let index = 0; index < items.length; index += perLine) {
    lines.push(items.slice(index, index + perLine).join(" "));
  }
  return lines;
}

/**
 * Runs `EXAMPLE_REQUEST` against a live API and returns the shortlist it
 * produced. Throws rather than falling back: a plate that animates an
 * invented shortlist would be worse than no plate at all.
 */
async function fetchExampleShortlist(pool: {
  query: <T>(sql: string, values?: unknown[]) => Promise<{ rows: T[] }>;
}): Promise<{
  readonly results: readonly OptimizeResult[];
  readonly diagnostics: OptimizeDiagnostics;
  readonly destination: { readonly lat: number; readonly lon: number };
}> {
  const { rows } = await pool.query<{
    station_group_id: string;
    lat: number;
    lon: number;
  }>(
    `SELECT station_group_id, ST_Y(point) AS lat, ST_X(point) AS lon
       FROM station_groups WHERE name_ja = $1 ORDER BY station_group_id LIMIT 1`,
    [EXAMPLE_REQUEST.destinationNameJa],
  );
  const destinationRow = rows[0];
  if (destinationRow === undefined) {
    throw new Error(`no station group named "${EXAMPLE_REQUEST.destinationNameJa}"`);
  }
  const destinationStationGroupId = destinationRow.station_group_id;

  const response = await fetch(`${API_BASE_URL}/v1/optimize`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      destinationStationGroupId,
      arrivalTime: EXAMPLE_REQUEST.arrivalTime,
      maxCommuteMinutes: EXAMPLE_REQUEST.maxCommuteMinutes,
      monthlyBudgetYen: EXAMPLE_REQUEST.monthlyBudgetYen,
      layout: EXAMPLE_REQUEST.layout,
      preferences: EXAMPLE_REQUEST.preferences,
    }),
  });
  if (!response.ok) {
    throw new Error(
      `example /v1/optimize failed (${String(response.status)}) — is the API running at ${API_BASE_URL}?`,
    );
  }
  const body = (await response.json()) as {
    results?: OptimizeResult[];
    diagnostics?: OptimizeDiagnostics;
  };
  const results = body.results ?? [];
  const diagnostics = body.diagnostics;
  if (results.length === 0) throw new Error("example /v1/optimize returned no results");
  if (diagnostics === undefined) throw new Error("example /v1/optimize returned no diagnostics");
  return {
    results,
    diagnostics,
    destination: { lat: destinationRow.lat, lon: destinationRow.lon },
  };
}

export interface PlateSources {
  readonly wards: string;
  readonly localities: string;
}

export async function buildWardPlate(): Promise<PlateSources> {
  const pool = createPool();
  try {
    const { rows: wards } = await pool.query<WardRow>(
      `SELECT ward_code, name_en, name_ja,
              ST_AsGeoJSON(ST_SimplifyPreserveTopology(geom, $1))::json AS geojson
         FROM wards
        ORDER BY name_en`,
      [SIMPLIFY_TOLERANCE_DEG],
    );
    if (wards.length === 0) throw new Error("no wards found — run the ward import first");

    const { rows: stations } = await pool.query<StationRow>(
      `SELECT DISTINCT ON (name_ja) name_ja,
              ST_Y(point) AS lat, ST_X(point) AS lon
         FROM station_groups
        WHERE name_ja = ANY($1)
        ORDER BY name_ja, station_group_id`,
      [REFERENCE_STATIONS.map((station) => station.nameJa)],
    );

    // Every area the engine weighs, so the plate can draw the real
    // candidate set rather than a decorative scatter.
    const { rows: localities } = await pool.query<LocalityRow>(
      `SELECT locality_id, ST_Y(centroid) AS lat, ST_X(centroid) AS lon
         FROM localities
        WHERE centroid IS NOT NULL
        ORDER BY locality_id`,
    );

    const example = await fetchExampleShortlist(pool);

    const { rows: evidenceRows } = await pool.query<Record<string, string>>(AXIS_EVIDENCE_SQL);
    const evidence = evidenceRows[0];
    if (evidence === undefined) throw new Error("axis evidence query returned no rows");

    // A spread of real place names for the index band. Ordered by a hash of
    // the id rather than alphabetically, so the band reads as a cross-section
    // of the city instead of a run of one ward's neighbours.
    const { rows: nameRows } = await pool.query<{ name_ja: string }>(
      `SELECT DISTINCT ON (name_ja) name_ja
         FROM localities
        WHERE name_ja <> ''
        ORDER BY name_ja, md5(locality_id)
        LIMIT 400`,
    );
    const indexNames = shuffleDeterministically(nameRows.map((row) => row.name_ja)).slice(0, 96);

    const points = wards.flatMap((ward) => ringsOf(ward.geojson).flat());
    const lons = points.map(([lon]) => lon);
    const lats = points.map(([, lat]) => lat);
    const minLon = Math.min(...lons);
    const maxLon = Math.max(...lons);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);

    // One cos(latitude) factor for the whole plate: over 30 km of latitude
    // the error is far below a pixel at this scale, and a constant keeps the
    // projection invertible and identical to the runtime map's.
    const lonScale = Math.cos(((minLat + maxLat) / 2) * (Math.PI / 180));
    const spanX = (maxLon - minLon) * lonScale;
    const spanY = maxLat - minLat;
    const scale = Math.min(
      (VIEW_WIDTH - PADDING * 2) / spanX,
      (VIEW_HEIGHT - PADDING * 2) / spanY,
    );
    const offsetX = (VIEW_WIDTH - spanX * scale) / 2;
    const offsetY = (VIEW_HEIGHT - spanY * scale) / 2;

    const project = (lat: number, lon: number): [number, number] => [
      offsetX + (lon - minLon) * lonScale * scale,
      offsetY + (maxLat - lat) * scale,
    ];

    const pathOf = (geometry: GeoJsonPolygon): string =>
      ringsOf(geometry)
        .map(
          (ring) =>
            ring
              .map(([lon, lat], index) => {
                const [x, y] = project(lat, lon);
                return `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
              })
              .join(" ") + "Z",
        )
        .join(" ");

    const orderedStations = REFERENCE_STATIONS.flatMap((reference) => {
      const row = stations.find((station) => station.name_ja === reference.nameJa);
      return row ? [{ ...reference, lat: row.lat, lon: row.lon }] : [];
    });

    const wardsSource = [
      "/**",
      " * GENERATED FILE — do not edit by hand.",
      " * Regenerate with `pnpm build:ward-plate` (see scripts/src/build-ward-plate.ts).",
      " *",
      ` * The 23 special wards, simplified to ${SIMPLIFY_TOLERANCE_DEG}° and projected into a`,
      ` * ${VIEW_WIDTH}x${VIEW_HEIGHT} viewBox with the same equirectangular/cos(latitude)`,
      " * projection `ResultsMap` uses at runtime, so the hero plate and the",
      " * results map read as one cartography.",
      " */",
      "",
      `export const WARD_PLATE_VIEWBOX = { width: ${VIEW_WIDTH}, height: ${VIEW_HEIGHT} } as const;`,
      "",
      "export interface WardShape {",
      "  readonly code: string;",
      "  readonly nameEn: string;",
      "  readonly nameJa: string;",
      "  readonly d: string;",
      "}",
      "",
      "export const WARD_SHAPES: readonly WardShape[] = [",
      ...wards.map(
        (ward) =>
          `  { code: ${JSON.stringify(ward.ward_code)}, nameEn: ${JSON.stringify(ward.name_en)}, ` +
          `nameJa: ${JSON.stringify(ward.name_ja)}, d: ${JSON.stringify(pathOf(ward.geojson))} },`,
      ),
      "];",
      "",
      "export interface PlateStation {",
      "  /** Editorial romanization — see REFERENCE_STATIONS in the generator. */",
      "  readonly romanized: string;",
      "  readonly nameJa: string;",
      "  readonly x: number;",
      "  readonly y: number;",
      "}",
      "",
      "/** Reference stations located from `station_groups`, projected identically. */",
      "export const PLATE_STATIONS: readonly PlateStation[] = [",
      ...orderedStations.map((station) => {
        const [x, y] = project(station.lat, station.lon);
        return (
          `  { romanized: ${JSON.stringify(station.romanized)}, nameJa: ${JSON.stringify(station.nameJa)}, ` +
          `x: ${x.toFixed(1)}, y: ${y.toFixed(1)} },`
        );
      }),
      "];",
      "",
    ].join("\n");

    const localitiesSource = [
      "/**",
      " * GENERATED FILE — do not edit by hand.",
      " * Regenerate with `pnpm build:ward-plate`.",
      " *",
      " * Every locality the engine weighs, projected into the same plate",
      " * space as a flat [x, y, x, y, ...] list — flat rather than tuples",
      " * because 937 two-element arrays cost several kilobytes in shape",
      " * alone. Read it with `localityPoint(index)`.",
      " *",
      " * Landing-page only: the search hero draws wards and stations, not",
      " * candidates, and should not pay for these coordinates.",
      " */",
      `export const LOCALITY_COUNT = ${String(localities.length)};`,
      "",
      "export const LOCALITY_XY: readonly number[] = [",
      ...chunk(
        localities.map((locality) => {
          const [x, y] = project(locality.lat, locality.lon);
          return `${x.toFixed(1)}, ${y.toFixed(1)},`;
        }),
        6,
      ).map((line) => `  ${line}`),
      "];",
      "",
      "/** The x/y of one locality, by index into `LOCALITY_XY`. */",
      "export function localityPoint(index: number): { x: number; y: number } {",
      "  return { x: LOCALITY_XY[index * 2] ?? 0, y: LOCALITY_XY[index * 2 + 1] ?? 0 };",
      "}",
      "",
      "/**",
      " * A real request sent to a real /v1/optimize, and the indices into",
      " * `LOCALITY_XY` of the areas that actually came back. The landing page",
      " * shows the parameters beside the outcome — it is a worked example,",
      " * not an illustration.",
      " */",
      "export interface ExampleSearch {",
      "  readonly destinationNameJa: string;",
      "  readonly arrivalTime: string;",
      "  readonly maxCommuteMinutes: number;",
      "  readonly monthlyBudgetYen: number;",
      "  readonly layout: string;",
      "  /** The destination, projected into plate space. */",
      "  readonly destination: { readonly x: number; readonly y: number };",
      "  readonly matchedIndices: readonly number[];",
      "  /**",
      "   * The engine's own account of what it ruled out, and why.",
      "   *",
      "   * `shortlisted` is the size of the returned shortlist, which is",
      "   * capped — it is NOT the number of areas that passed the filters.",
      "   * `qualified` is that number. Conflating them would overstate how",
      "   * much the limits actually narrow the city.",
      "   */",
      "  readonly funnel: {",
      "    readonly considered: number;",
      "    readonly excludedByCommute: number;",
      "    readonly excludedByRent: number;",
      "    readonly excludedByDisconnected: number;",
      "    readonly qualified: number;",
      "    readonly shortlisted: number;",
      "  };",
      "  /** The top recommendation, exactly as the engine returned it. */",
      "  readonly topResult: {",
      "    readonly nameJa: string;",
      "    readonly nameEn: string;",
      "    readonly wardNameEn: string;",
      "    readonly score: number;",
      "    readonly commuteMinutes: number;",
      "    readonly transfers: number;",
      "    readonly rentLowYen: number;",
      "    readonly rentHighYen: number;",
      "    readonly strength: string;",
      "    readonly weakest: { readonly label: string; readonly score: number };",
      "  };",
      "}",
      "",
      `export const EXAMPLE_SEARCH: ExampleSearch = ${JSON.stringify(
        {
          destinationNameJa: EXAMPLE_REQUEST.destinationNameJa,
          arrivalTime: EXAMPLE_REQUEST.arrivalTime,
          maxCommuteMinutes: EXAMPLE_REQUEST.maxCommuteMinutes,
          monthlyBudgetYen: EXAMPLE_REQUEST.monthlyBudgetYen,
          layout: EXAMPLE_REQUEST.layout,
          destination: (() => {
            const [x, y] = project(example.destination.lat, example.destination.lon);
            return { x: Number(x.toFixed(1)), y: Number(y.toFixed(1)) };
          })(),
          matchedIndices: example
            .results.map((result) =>
              localities.findIndex((locality) => locality.locality_id === result.localityId),
            )
            .filter((index) => index >= 0),
          funnel: {
            considered: example.diagnostics.candidatesConsidered,
            excludedByCommute: example.diagnostics.excludedByCommute,
            excludedByRent: example.diagnostics.excludedByRent,
            excludedByDisconnected: example.diagnostics.excludedByDisconnected,
            // The engine's own figure, not `considered` minus the exclusion
            // counts: a candidate can fail two filters at once, and
            // subtracting would count it twice and understate the result.
            qualified: example.diagnostics.feasibleCount,
            shortlisted: example.results.length,
          },
          topResult: describeTopResult(example.results),
        },
        null,
        2,
      )};`,
      "",
      "/**",
      " * A cross-section of real place names, for the index band. Ninety-six",
      " * of the 937, shuffled deterministically so the band reads as the city",
      " * rather than as one ward's alphabetical run.",
      " */",
      `export const INDEX_NAMES: readonly string[] = ${JSON.stringify(indexNames, null, 2)};`,
      "",
      "/**",
      " * What each lifestyle axis is actually counted from. The units differ",
      " * on purpose — an axis backed by park polygons is not measuring the",
      " * same kind of thing as one backed by shop locations, and flattening",
      " * them into a single figure would imply a comparability the data does",
      " * not have.",
      " */",
      "export interface AxisEvidence {",
      "  readonly count: number;",
      "  readonly unit: string;",
      "}",
      "",
      `export const AXIS_EVIDENCE: Readonly<Record<string, AxisEvidence>> = ${JSON.stringify(
        {
          supermarkets: { count: Number(evidence["supermarkets"]), unit: "supermarkets and grocers" },
          restaurants: { count: Number(evidence["restaurants"]), unit: "restaurants and cafés" },
          quietness: {
            count: Number(evidence["zoning_areas"]) + Number(evidence["rail_edges"]),
            unit: "zoning areas and rail segments",
          },
          konbini: { count: Number(evidence["konbini"]), unit: "convenience stores" },
          cuisineVariety: { count: Number(evidence["cuisine_variety"]), unit: "distinct cuisines" },
          greenSpace: { count: Number(evidence["green_space"]), unit: "parks and gardens" },
          lateNight: { count: Number(evidence["late_night"]), unit: "places open past 23:00" },
          health: { count: Number(evidence["health"]), unit: "clinics and pharmacies" },
        },
        null,
        2,
      )};`,
      "",
    ].join("\n");

    return { wards: wardsSource, localities: localitiesSource };
  } finally {
    await pool.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!process.env["DATABASE_URL"]) {
    console.error("DATABASE_URL is required for build:ward-plate");
    process.exit(1);
  }
  buildWardPlate()
    .then(async (sources) => {
      await writeFile(WARDS_PATH, sources.wards, "utf8");
      await writeFile(LOCALITIES_PATH, sources.localities, "utf8");
      console.log(`build:ward-plate — wrote ${fileURLToPath(WARDS_PATH)}`);
      console.log(`build:ward-plate — wrote ${fileURLToPath(LOCALITIES_PATH)}`);
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exit(1);
    });
}

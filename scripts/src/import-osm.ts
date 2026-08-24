/**
 * `pnpm import:osm` — imports points of interest and major roads from
 * OpenStreetMap (via the Overpass API) into `pois` and `major_roads`.
 *
 *   pnpm import:osm --file data/tokyo.osm.json
 *   pnpm import:osm --download   # queries Overpass directly; needs network
 *
 * Unlike `import:mlit`/`import:rent`, Overpass needs no credential — it is
 * a public API — so this script's input precedence is simpler and
 * explicit rather than auto-falling-back to a download attempt:
 *   1. `--file <path>` — read a previously saved (or hand-fetched) Overpass
 *      JSON response directly. This is the only path exercised by tests
 *      (see `scripts/src/fixtures/osm/` and this repo's no-network-at-
 *      test-time rule).
 *   2. `--download` — build the query in code (`import-osm/query.ts`,
 *      bounded to `TOKYO_23_WARDS_BBOX` from `@tokyo/shared`) and send it
 *      to the public Overpass API (`import-osm/download.ts`), politely:
 *      one request, a descriptive `User-Agent`, and a clear, specific
 *      error on 429 (rate-limited) or 504 (overloaded) rather than a raw
 *      failed-fetch exception.
 *   3. Neither flag: a clear error naming both options and a manual
 *      fallback (query Overpass yourself, e.g. via overpass-turbo.eu, and
 *      pass the saved response via --file).
 *
 * Parsing (`import-osm/parse.ts`) is pure and DB-free: it classifies every
 * element's tags against the brief's exact mapping (see that file's doc
 * comment for the full table), resolves coordinates (a node's own lat/lon;
 * a way/relation's `center`), and resolves road geometry (a highway way's
 * `geometry` array, kept as real linework — never a centroid, since
 * `derive`'s road-exposure metric needs genuine geometry to intersect
 * against). An element with no mapped tag is skipped, counted, and
 * reported — never an error. An element that DOES match a mapped tag but
 * is missing the coordinates/geometry its kind needs is a hard error that
 * aborts the whole run.
 *
 * An element can genuinely carry more than one mapped tag in a real
 * `--download` response — e.g. `shop=bakery` + `amenity=cafe` is a common,
 * legitimate OSM pattern, and Overpass returns each matched element's full
 * tag set regardless of which of our query's filters found it (see
 * `import-osm/parse.ts`'s doc comment for why). `shop` wins over `amenity`
 * by deliberate choice in that case, not because the situation is rare or
 * unreachable; `highway` always wins over both, which genuinely IS
 * unreachable from our own query (`highway` is a way-only tag in real OSM).
 * Every dual-tag resolution prints a warning naming both tags and the one
 * that won — worth reading after a live import, not noise.
 *
 * Following this repo's house pattern (Tasks 11-12): loading and parsing
 * happen inside the `fn` passed to `runImport` (`scripts/src/lib/
 * import-run.ts`), so a bad file/response causes a harmless no-op
 * rollback rather than a partial write.
 *
 * `pois` is upserted on its `(osm_type, osm_id)` unique constraint (now
 * also carrying the OSM `cuisine`/`opening_hours` tags verbatim, when
 * present), then any `source = 'openstreetmap'` row whose `(osm_type,
 * osm_id)` wasn't seen this run is deleted. `major_roads` and `green_spaces`
 * both have no natural key in the schema (surrogate `id` only), so —
 * following `import:mlit`'s land_prices/zoning/flood precedent — every
 * `source = 'openstreetmap'` row is deleted and this run's roads/green
 * spaces are freshly inserted, which is equivalent (delete-stale + upsert
 * reduces to delete-all + insert-all when there is no key to upsert
 * against). All deletes/upserts are scoped to `source = 'openstreetmap'`
 * only, so seeded and other-source rows are untouched.
 *
 * `OSM_ATTRIBUTION` (`@tokyo/shared`) is printed on every invocation of
 * `runOsmImport`, success or failure — this is an ODbL licence obligation,
 * not a nicety, so it is not gated behind a successful write.
 */

import { fileURLToPath } from "node:url";

import type { PoolClient } from "pg";

import { OSM_ATTRIBUTION, TOKYO_23_WARDS_BBOX } from "@tokyo/shared";

import { createPool } from "./lib/db.js";
import type { ImportResult } from "./lib/import-run.js";
import { runImport } from "./lib/import-run.js";
import { resolveSource } from "./lib/source-file.js";
import { expectRowCount } from "./lib/validate.js";
import { downloadOverpass } from "./import-osm/download.js";
import type { ParsedGreenSpace, ParsedPoi, ParsedRoad } from "./import-osm/parse.js";
import { parseOverpassResponse } from "./import-osm/parse.js";
import { buildOverpassQuery } from "./import-osm/query.js";

const SOURCE = "openstreetmap";

/** Sanity floor only — catches an empty/truncated response, not a coverage target. */
const MIN_OSM_ELEMENTS = 1;

const MANUAL_DOWNLOAD_URL =
  "https://overpass-turbo.eu/ (or any Overpass API mirror) — run a query for shop=supermarket/" +
  "greengrocer/butcher/bakery/grocery/convenience, amenity=restaurant/cafe/bar/pub/nightclub/clinic/" +
  "doctors/pharmacy/hospital/university/college/school, named office=*, leisure=park/garden, and " +
  "highway=motorway/trunk/primary within the Tokyo 23-ward bounding box (see " +
  "TOKYO_23_WARDS_BBOX in shared/src/config/scoring.ts), export the JSON response, and pass its " +
  "path via --file.";

export interface ImportOsmArgs {
  readonly filePath?: string;
  readonly download: boolean;
}

async function loadOverpassRaw(args: ImportOsmArgs): Promise<string> {
  if (args.filePath !== undefined) {
    return resolveSource({
      label: "Overpass",
      localPath: args.filePath,
      manualDownloadUrl: MANUAL_DOWNLOAD_URL,
    });
  }

  if (args.download) {
    const query = buildOverpassQuery(TOKYO_23_WARDS_BBOX);
    return downloadOverpass(query);
  }

  throw new Error(
    `import:osm — no input given. Pass --file <path to Overpass JSON> to read a saved response, or ` +
      `--download to query Overpass directly (requires network access). Manual fallback: ` +
      `${MANUAL_DOWNLOAD_URL}`,
  );
}

/**
 * Upserts `pois` on `(osm_type, osm_id)`, then deletes any existing
 * `source = 'openstreetmap'` row whose `(osm_type, osm_id)` pair wasn't
 * seen this run. The delete uses a parallel `unnest` of two arrays (rather
 * than a composite-array membership test) to express "not one of these
 * (type, id) pairs" cleanly in plain SQL.
 */
async function upsertPois(
  client: PoolClient,
  pois: readonly ParsedPoi[],
  sourceUpdatedAt: Date | null,
): Promise<number> {
  for (const p of pois) {
    await client.query(
      `INSERT INTO pois (category, name, name_en, osm_type, osm_id, point, source, source_updated_at, cuisine, opening_hours)
       VALUES ($1, $2, $3, $4, $5, ST_SetSRID(ST_MakePoint($6, $7), 4326), $8, $9, $10, $11)
       ON CONFLICT (osm_type, osm_id) DO UPDATE SET
         category = EXCLUDED.category,
         name = EXCLUDED.name,
         name_en = EXCLUDED.name_en,
         point = EXCLUDED.point,
         source = EXCLUDED.source,
         source_updated_at = EXCLUDED.source_updated_at,
         cuisine = EXCLUDED.cuisine,
         opening_hours = EXCLUDED.opening_hours,
         imported_at = now()`,
      [p.category, p.name, p.nameEn, p.osmType, p.osmId, p.lon, p.lat, SOURCE, sourceUpdatedAt, p.cuisine, p.openingHours],
    );
  }

  const seenTypes = pois.map((p) => p.osmType);
  const seenIds = pois.map((p) => p.osmId);
  await client.query(
    `DELETE FROM pois p
     WHERE p.source = $3
       AND NOT EXISTS (
         SELECT 1 FROM unnest($1::text[], $2::bigint[]) AS seen(osm_type, osm_id)
         WHERE seen.osm_type = p.osm_type AND seen.osm_id = p.osm_id
       )`,
    [seenTypes, seenIds, SOURCE],
  );

  return pois.length;
}

/**
 * `major_roads` has no natural key (surrogate `id` only) — see this file's
 * module doc comment for why delete-all-then-insert-all is the correct,
 * equivalent replacement for upsert-then-delete-stale here.
 */
async function replaceRoads(
  client: PoolClient,
  roads: readonly ParsedRoad[],
  sourceUpdatedAt: Date | null,
): Promise<number> {
  await client.query(`DELETE FROM major_roads WHERE source = $1`, [SOURCE]);
  for (const r of roads) {
    await client.query(
      `INSERT INTO major_roads (name, road_class, geom, source, source_updated_at)
       VALUES ($1, $2, ST_SetSRID(ST_GeomFromText($3), 4326), $4, $5)`,
      [r.name, r.roadClass, r.geomWKT, SOURCE, sourceUpdatedAt],
    );
  }
  return roads.length;
}

/**
 * `green_spaces` has no natural key (surrogate `id` only) — mirrors
 * `replaceRoads` above exactly; see this file's module doc comment for why
 * delete-all-then-insert-all is the correct, equivalent replacement for
 * upsert-then-delete-stale here.
 */
async function replaceGreenSpaces(
  client: PoolClient,
  greenSpaces: readonly ParsedGreenSpace[],
  sourceUpdatedAt: Date | null,
): Promise<number> {
  await client.query(`DELETE FROM green_spaces WHERE source = $1`, [SOURCE]);
  for (const g of greenSpaces) {
    await client.query(
      `INSERT INTO green_spaces (name, leisure_class, geom, source, source_updated_at)
       VALUES ($1, $2, ST_SetSRID(ST_GeomFromText($3), 4326), $4, $5)`,
      [g.name, g.leisureClass, g.geomWKT, SOURCE, sourceUpdatedAt],
    );
  }
  return greenSpaces.length;
}

export interface OsmImportResult extends ImportResult {
  readonly poisImported: number;
  readonly roadsImported: number;
  readonly greenSpacesImported: number;
  readonly skippedElements: number;
}

export async function runOsmImport(client: PoolClient, args: ImportOsmArgs): Promise<OsmImportResult> {
  // Licence obligation — printed unconditionally, even if parsing or the
  // write below goes on to fail this run.
  console.log(OSM_ATTRIBUTION);

  const raw = await loadOverpassRaw(args);
  const parsed = parseOverpassResponse(raw);

  expectRowCount(parsed.pois.length + parsed.roads.length + parsed.greenSpaces.length, {
    min: MIN_OSM_ELEMENTS,
    label: "OSM elements (pois + roads + green spaces combined)",
  });

  const poisImported = await upsertPois(client, parsed.pois, parsed.sourceUpdatedAt);
  const roadsImported = await replaceRoads(client, parsed.roads, parsed.sourceUpdatedAt);
  const greenSpacesImported = await replaceGreenSpaces(client, parsed.greenSpaces, parsed.sourceUpdatedAt);

  console.log(
    `import:osm — pois=${String(poisImported)} roads=${String(roadsImported)} ` +
      `green_spaces=${String(greenSpacesImported)} skipped=${String(parsed.skippedElements)} (unmapped tag(s) or unusable geometry)`,
  );

  return {
    rowsImported: poisImported + roadsImported + greenSpacesImported,
    sourceUpdatedAt: parsed.sourceUpdatedAt ?? undefined,
    poisImported,
    roadsImported,
    greenSpacesImported,
    skippedElements: parsed.skippedElements,
  };
}

function parseFlagValue(argv: readonly string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

export function parseArgs(argv: readonly string[]): ImportOsmArgs {
  return {
    filePath: parseFlagValue(argv, "--file"),
    download: argv.includes("--download"),
  };
}

async function main(): Promise<void> {
  if (!process.env["DATABASE_URL"]) {
    console.error(
      "DATABASE_URL is not set. Set it to a PostgreSQL connection string, e.g.\n" +
        "  DATABASE_URL=postgresql://tokyo:tokyo@localhost:5432/tokyo pnpm import:osm --file ...",
    );
    process.exit(1);
  }

  const args = parseArgs(process.argv.slice(2));
  const pool = createPool();
  try {
    const result = await runImport({ source: SOURCE, pool }, (client) => runOsmImport(client, args));
    console.log(`import:osm complete. rows_imported=${String(result.rowsImported)}`);
  } finally {
    await pool.end();
  }
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}

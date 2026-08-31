import type { PoolClient } from "pg";

import { OSM_ATTRIBUTION, TOKYO_23_WARDS_BBOX } from "@tokyo/shared";

import type { ImportResult } from "./lib/import-run.js";
import { parseFlagValue, runImportCliIfMain } from "./lib/cli.js";
import { resolveSource } from "./lib/source-file.js";
import { expectRowCount } from "./lib/validate.js";
import { downloadOverpass } from "./import-osm/download.js";
import type { ParsedGreenSpace, ParsedPoi, ParsedRoad } from "./import-osm/parse.js";
import { parseOverpassResponse } from "./import-osm/parse.js";
import { buildOverpassQuery } from "./import-osm/query.js";

const SOURCE = "openstreetmap";

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
      [
        p.category,
        p.name,
        p.nameEn,
        p.osmType,
        p.osmId,
        p.lon,
        p.lat,
        SOURCE,
        sourceUpdatedAt,
        p.cuisine,
        p.openingHours,
      ],
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

export async function runOsmImport(
  client: PoolClient,
  args: ImportOsmArgs,
): Promise<OsmImportResult> {
  console.log(OSM_ATTRIBUTION);

  const raw = await loadOverpassRaw(args);
  const parsed = parseOverpassResponse(raw);

  expectRowCount(parsed.pois.length + parsed.roads.length + parsed.greenSpaces.length, {
    min: MIN_OSM_ELEMENTS,
    label: "OSM elements (pois + roads + green spaces combined)",
  });

  const poisImported = await upsertPois(client, parsed.pois, parsed.sourceUpdatedAt);
  const roadsImported = await replaceRoads(client, parsed.roads, parsed.sourceUpdatedAt);
  const greenSpacesImported = await replaceGreenSpaces(
    client,
    parsed.greenSpaces,
    parsed.sourceUpdatedAt,
  );

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

export function parseArgs(argv: readonly string[]): ImportOsmArgs {
  return {
    filePath: parseFlagValue(argv, "--file"),
    download: argv.includes("--download"),
  };
}

runImportCliIfMain(import.meta.url, {
  commandName: "import:osm",
  commandExample: "pnpm import:osm --file ...",
  parseArgs,
  source: () => SOURCE,
  run: runOsmImport,
});

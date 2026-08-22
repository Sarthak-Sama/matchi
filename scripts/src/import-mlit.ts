/**
 * `pnpm import:mlit` — imports wards, station groups (with merging),
 * rail lines, land-price points, zoning polygons, and flood polygons from
 * MLIT (Ministry of Land, Infrastructure, Transport and Tourism) data.
 *
 * Every dataset is passed in as its own GeoJSON file via a `--<dataset>`
 * flag (shapefile downloads must be converted first, e.g. with
 * `ogr2ogr -f GeoJSON out.geojson in.shp`):
 *
 *   pnpm import:mlit \
 *     --wards data/wards.geojson \
 *     --stations data/stations.geojson \
 *     --rail-lines data/rail-lines.geojson \
 *     --land-prices data/land-prices.geojson \
 *     --zoning data/zoning.geojson \
 *     --flood data/flood.geojson \
 *     [--source-date 2026-01-01]
 *
 * When a dataset's flag is omitted, this script tries to download it —
 * which currently always fails, naming `MLIT_API_KEY` and a manual
 * download URL, because no verified MLIT download endpoint could be
 * confirmed without live network access while building this script (see
 * task-11-report.md's "MLIT format assumptions" section). Passing `--file`
 * equivalents for every dataset is the only supported path today.
 *
 * Every property name this script reads from the source GeoJSON
 * (`N03_007`, `N02_005`, `A29_001`, etc., alongside friendlier aliases) is
 * an ASSUMPTION about MLIT's real export shape — documented per dataset in
 * `scripts/src/import-mlit/*.ts` and summarized in task-11-report.md.
 *
 * All six datasets are parsed and validated up front — before any DB
 * write — then written inside the single transaction `runImport` (from
 * `scripts/src/lib/import-run.ts`) provides. A failure anywhere rolls back
 * every table this script touches; the `import_runs` bookkeeping row still
 * records the failure (see import-run.ts's doc comment for why that
 * survives the rollback).
 *
 * Natural keys: `wards.ward_code`, `station_groups.station_group_id`
 * (synthesized deterministically from the merged group's name + rounded
 * centroid when the source has no id of its own), and
 * `rail_lines.rail_line_id` are upserted, then rows for this run's
 * `source` not seen this run are deleted. `land_prices`, `zoning_areas`,
 * and `flood_zones` have no natural key in the schema (surrogate `id`
 * only) — for those, every `source = 'mlit'` row is deleted and this
 * run's rows are freshly inserted, which is equivalent (delete-stale +
 * upsert reduces to delete-all + insert-all when there is no key to
 * upsert against).
 *
 * IMPORTANT: `wards.ward_code` is the table's only key — the schema (Task
 * 3) has no "source" component in that key, unlike `station_source_refs`
 * (`source`, `source_id`) or `rent_stats` (`ward_code`, `period`,
 * `source`). `scripts/src/seed.ts`'s fixture deliberately uses Tokyo's
 * real 5-digit ward codes (13113 = Shibuya, etc.), so running this script
 * against a database that also has seed data WILL overwrite a seed-owned
 * ward row in place (its `geom` and `source` both change to this run's)
 * whenever a ward code collides — by design, not a bug: it's the same
 * real-world ward, and real MLIT boundaries are meant to supersede the
 * seed fixture's placeholder rectangle. A production environment should
 * not run both `pnpm db:seed` and `pnpm import:mlit` against the same
 * database; a shared test database (e.g. `tokyo_test`) that does both
 * should re-run `pnpm db:seed` afterward to restore a pure-seed baseline
 * before relying on seed-only invariants again.
 *
 * `station_groups.ward_code` and `land_prices.ward_code` are NOT trusted
 * from source properties — they are assigned via a spatial join
 * (`ST_Contains`) against the wards just imported. This matters: a
 * station outside every known ward (or imported before `import:mlit` has
 * ever loaded wards) ends up with `ward_code = NULL`, which `derive`'s
 * rent step warn-and-skips and `/v1/optimize` excludes safely — but is
 * still worth knowing about, so this script prints how many stations
 * ended up without one.
 */

import { fileURLToPath } from "node:url";

import type { PoolClient } from "pg";

import { createPool } from "./lib/db.js";
import type { ImportResult } from "./lib/import-run.js";
import { runImport } from "./lib/import-run.js";
import { resolveSource } from "./lib/source-file.js";
import { expectRowCount } from "./lib/validate.js";
import { parseFeatureCollection, pointWKT } from "./import-mlit/geojson.js";
import type { ParsedFloodZone } from "./import-mlit/flood.js";
import { MIN_FLOOD_ROWS, parseFloodZones } from "./import-mlit/flood.js";
import type { ParsedLandPrice } from "./import-mlit/land-prices.js";
import { MIN_LAND_PRICES_ROWS, parseLandPrices } from "./import-mlit/land-prices.js";
import type { ParsedRailLine } from "./import-mlit/rail-lines.js";
import { MIN_RAIL_LINES_ROWS, parseRailLines } from "./import-mlit/rail-lines.js";
import type { MergedStationGroup } from "./import-mlit/station-merge.js";
import { mergeStations } from "./import-mlit/station-merge.js";
import { MIN_STATIONS_ROWS, parseStations } from "./import-mlit/stations.js";
import type { ParsedWard } from "./import-mlit/wards.js";
import { MIN_WARDS_ROWS, parseWards } from "./import-mlit/wards.js";
import type { ParsedZoningArea } from "./import-mlit/zoning.js";
import { MIN_ZONING_ROWS, parseZoningAreas } from "./import-mlit/zoning.js";

const SOURCE = "mlit";

const MANUAL_DOWNLOAD_URL =
  "https://nlftp.mlit.go.jp/ksj/ (MLIT National Land Numerical Information download service — " +
  "wards: dataset N03, stations/rail lines: dataset N02, land prices: dataset L01, zoning: " +
  "dataset A29, flood: dataset A31)";

export interface ImportMlitArgs {
  readonly wardsPath?: string;
  readonly stationsPath?: string;
  readonly railLinesPath?: string;
  readonly landPricesPath?: string;
  readonly zoningPath?: string;
  readonly floodPath?: string;
  readonly sourceDate?: Date;
}

async function loadDataset(label: string, localPath: string | undefined): Promise<string> {
  return resolveSource({
    label,
    localPath,
    requiredEnvVar: "MLIT_API_KEY",
    manualDownloadUrl: MANUAL_DOWNLOAD_URL,
  });
}

async function upsertWards(
  client: PoolClient,
  wards: readonly ParsedWard[],
  sourceUpdatedAt: Date | null,
): Promise<number> {
  for (const w of wards) {
    await client.query(
      `INSERT INTO wards (ward_code, name_ja, name_en, geom, source, source_updated_at)
       VALUES ($1, $2, $3, ST_SetSRID(ST_GeomFromText($4), 4326), $5, $6)
       ON CONFLICT (ward_code) DO UPDATE SET
         name_ja = EXCLUDED.name_ja,
         name_en = EXCLUDED.name_en,
         geom = EXCLUDED.geom,
         source = EXCLUDED.source,
         source_updated_at = EXCLUDED.source_updated_at,
         imported_at = now()`,
      [w.wardCode, w.nameJa, w.nameEn, w.geomWKT, SOURCE, sourceUpdatedAt],
    );
  }

  const seenCodes = wards.map((w) => w.wardCode);

  // A ward about to be deleted (not seen this run) might still be
  // referenced by a station_groups/land_prices row's ward_code. Null those
  // out first so the DELETE below doesn't fail with a foreign-key
  // violation — the spatial join later in this script recomputes correct
  // ward_code values for every mlit-sourced row anyway.
  await client.query(
    `UPDATE station_groups SET ward_code = NULL
     WHERE source = $2 AND ward_code IS NOT NULL AND ward_code <> ALL($1::text[])`,
    [seenCodes, SOURCE],
  );
  await client.query(
    `UPDATE land_prices SET ward_code = NULL
     WHERE source = $2 AND ward_code IS NOT NULL AND ward_code <> ALL($1::text[])`,
    [seenCodes, SOURCE],
  );
  await client.query(`DELETE FROM wards WHERE source = $2 AND ward_code <> ALL($1::text[])`, [
    seenCodes,
    SOURCE,
  ]);

  return wards.length;
}

async function upsertStations(
  client: PoolClient,
  groups: readonly MergedStationGroup[],
  sourceUpdatedAt: Date | null,
): Promise<number> {
  for (const g of groups) {
    await client.query(
      `INSERT INTO station_groups (station_group_id, name_ja, name_en, aliases, point, source, source_updated_at)
       VALUES ($1, $2, $3, '{}', ST_SetSRID(ST_GeomFromText($4), 4326), $5, $6)
       ON CONFLICT (station_group_id) DO UPDATE SET
         name_ja = EXCLUDED.name_ja,
         name_en = EXCLUDED.name_en,
         point = EXCLUDED.point,
         source = EXCLUDED.source,
         source_updated_at = EXCLUDED.source_updated_at,
         imported_at = now()`,
      [g.stationGroupId, g.nameJa, g.nameEn, pointWKT([g.lon, g.lat]), SOURCE, sourceUpdatedAt],
    );
  }

  const seenSourceIds = groups.flatMap((g) => g.members.map((m) => m.sourceId));

  // Delete refs for source_ids no longer seen (a platform/operator entry
  // that disappeared from the source), regardless of which group they used
  // to belong to.
  await client.query(
    `DELETE FROM station_source_refs WHERE source = $2 AND source_id <> ALL($1::text[])`,
    [seenSourceIds, SOURCE],
  );

  for (const g of groups) {
    for (const m of g.members) {
      await client.query(
        `INSERT INTO station_source_refs (station_group_id, source, source_id, source_name)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (source, source_id) DO UPDATE SET
           station_group_id = EXCLUDED.station_group_id,
           source_name = EXCLUDED.source_name`,
        [g.stationGroupId, SOURCE, m.sourceId, m.nameJa],
      );
    }
  }

  const seenGroupIds = groups.map((g) => g.stationGroupId);
  // NOTE: a stale station_group referenced by a rail_edges row (no CASCADE
  // on that FK) would make this DELETE fail. That can only happen once
  // Task 14's transit import has written edges against mlit-sourced
  // station_group_ids — out of scope here, flagged for that task.
  await client.query(
    `DELETE FROM station_groups WHERE source = $2 AND station_group_id <> ALL($1::text[])`,
    [seenGroupIds, SOURCE],
  );

  return groups.length;
}

async function upsertRailLines(
  client: PoolClient,
  lines: readonly ParsedRailLine[],
  sourceUpdatedAt: Date | null,
): Promise<number> {
  for (const l of lines) {
    await client.query(
      `INSERT INTO rail_lines (rail_line_id, operator, name_ja, name_en, mode, geom, source, source_updated_at)
       VALUES ($1, $2, $3, $4, $5, ST_SetSRID(ST_GeomFromText($6), 4326), $7, $8)
       ON CONFLICT (rail_line_id) DO UPDATE SET
         operator = EXCLUDED.operator,
         name_ja = EXCLUDED.name_ja,
         name_en = EXCLUDED.name_en,
         mode = EXCLUDED.mode,
         geom = EXCLUDED.geom,
         source = EXCLUDED.source,
         source_updated_at = EXCLUDED.source_updated_at,
         imported_at = now()`,
      [l.railLineId, l.operator, l.nameJa, l.nameEn ?? null, l.mode, l.geomWKT, SOURCE, sourceUpdatedAt],
    );
  }

  const seenIds = lines.map((l) => l.railLineId);
  await client.query(`DELETE FROM rail_lines WHERE source = $2 AND rail_line_id <> ALL($1::text[])`, [
    seenIds,
    SOURCE,
  ]);

  return lines.length;
}

async function replaceLandPrices(
  client: PoolClient,
  rows: readonly ParsedLandPrice[],
  sourceUpdatedAt: Date | null,
): Promise<number> {
  await client.query(`DELETE FROM land_prices WHERE source = $1`, [SOURCE]);
  for (const r of rows) {
    await client.query(
      `INSERT INTO land_prices (point, price_yen_per_sqm, year, use_category, source, source_updated_at)
       VALUES (ST_SetSRID(ST_GeomFromText($1), 4326), $2, $3, $4, $5, $6)`,
      [pointWKT([r.lon, r.lat]), r.priceYenPerSqm, r.year, r.useCategory ?? null, SOURCE, sourceUpdatedAt],
    );
  }
  return rows.length;
}

async function replaceZoning(
  client: PoolClient,
  rows: readonly ParsedZoningArea[],
  sourceUpdatedAt: Date | null,
): Promise<number> {
  await client.query(`DELETE FROM zoning_areas WHERE source = $1`, [SOURCE]);
  for (const r of rows) {
    await client.query(
      `INSERT INTO zoning_areas (category, is_residential, geom, source, source_updated_at)
       VALUES ($1, $2, ST_SetSRID(ST_GeomFromText($3), 4326), $4, $5)`,
      [r.category, r.isResidential, r.geomWKT, SOURCE, sourceUpdatedAt],
    );
  }
  return rows.length;
}

async function replaceFlood(
  client: PoolClient,
  rows: readonly ParsedFloodZone[],
  sourceUpdatedAt: Date | null,
): Promise<number> {
  await client.query(`DELETE FROM flood_zones WHERE source = $1`, [SOURCE]);
  for (const r of rows) {
    await client.query(
      `INSERT INTO flood_zones (depth_category, depth_rank, geom, source, source_updated_at)
       VALUES ($1, $2, ST_SetSRID(ST_GeomFromText($3), 4326), $4, $5)`,
      [r.depthCategory, r.depthRank, r.geomWKT, SOURCE, sourceUpdatedAt],
    );
  }
  return rows.length;
}

/**
 * Recomputes `ward_code` on every `source = 'mlit'` row of `table` via a
 * point-in-polygon spatial join against the current `wards` table (which,
 * by this point in the transaction, reflects this run's upserts/deletes).
 * Resets to NULL first so a row that used to match a ward that moved/shrunk
 * doesn't keep a stale value.
 */
async function assignWardCodes(
  client: PoolClient,
  table: "station_groups" | "land_prices",
): Promise<{ readonly withoutWard: number }> {
  await client.query(`UPDATE ${table} SET ward_code = NULL WHERE source = $1`, [SOURCE]);
  await client.query(
    `UPDATE ${table} t SET ward_code = w.ward_code
     FROM wards w
     WHERE t.source = $1 AND ST_Contains(w.geom, t.point)`,
    [SOURCE],
  );
  const { rows } = await client.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM ${table} WHERE source = $1 AND ward_code IS NULL`,
    [SOURCE],
  );
  return { withoutWard: Number(rows[0]?.count ?? "0") };
}

export async function runMlitImport(client: PoolClient, args: ImportMlitArgs): Promise<ImportResult> {
  const sourceUpdatedAt = args.sourceDate ?? null;

  const wardsRaw = await loadDataset("wards", args.wardsPath);
  const wardFeatures = parseFeatureCollection(wardsRaw, "wards");
  expectRowCount(wardFeatures.length, { min: MIN_WARDS_ROWS, label: "wards" });
  const wards = parseWards(wardFeatures);

  const stationsRaw = await loadDataset("stations", args.stationsPath);
  const stationFeatures = parseFeatureCollection(stationsRaw, "stations");
  expectRowCount(stationFeatures.length, { min: MIN_STATIONS_ROWS, label: "stations" });
  const rawStations = parseStations(stationFeatures);
  const stationGroups = mergeStations(rawStations);

  const railRaw = await loadDataset("rail-lines", args.railLinesPath);
  const railFeatures = parseFeatureCollection(railRaw, "rail-lines");
  expectRowCount(railFeatures.length, { min: MIN_RAIL_LINES_ROWS, label: "rail-lines" });
  const railLines = parseRailLines(railFeatures);

  const landRaw = await loadDataset("land-prices", args.landPricesPath);
  const landFeatures = parseFeatureCollection(landRaw, "land-prices");
  expectRowCount(landFeatures.length, { min: MIN_LAND_PRICES_ROWS, label: "land-prices" });
  const landPrices = parseLandPrices(landFeatures);

  const zoningRaw = await loadDataset("zoning", args.zoningPath);
  const zoningFeatures = parseFeatureCollection(zoningRaw, "zoning");
  expectRowCount(zoningFeatures.length, { min: MIN_ZONING_ROWS, label: "zoning" });
  const zoning = parseZoningAreas(zoningFeatures);

  const floodRaw = await loadDataset("flood", args.floodPath);
  const floodFeatures = parseFeatureCollection(floodRaw, "flood");
  expectRowCount(floodFeatures.length, { min: MIN_FLOOD_ROWS, label: "flood" });
  const flood = parseFloodZones(floodFeatures);

  // Every dataset is now parsed and validated — nothing has touched the
  // database yet. From here on, writes happen inside runImport's
  // transaction; any error still rolls everything below back.
  let rowsImported = 0;
  rowsImported += await upsertWards(client, wards, sourceUpdatedAt);
  rowsImported += await upsertStations(client, stationGroups, sourceUpdatedAt);
  rowsImported += await upsertRailLines(client, railLines, sourceUpdatedAt);
  rowsImported += await replaceLandPrices(client, landPrices, sourceUpdatedAt);
  rowsImported += await replaceZoning(client, zoning, sourceUpdatedAt);
  rowsImported += await replaceFlood(client, flood, sourceUpdatedAt);

  const stationWard = await assignWardCodes(client, "station_groups");
  await assignWardCodes(client, "land_prices");

  console.log(
    `import:mlit — wards=${wards.length} stations=${stationGroups.length} ` +
      `(from ${rawStations.length} raw feature(s)) rail_lines=${railLines.length} ` +
      `land_prices=${landPrices.length} zoning=${zoning.length} flood=${flood.length}`,
  );
  console.log(
    `import:mlit — ${stationWard.withoutWard} of ${stationGroups.length} imported station(s) have ` +
      `no ward_code (fell outside every imported ward's polygon).`,
  );

  return { rowsImported, sourceUpdatedAt: sourceUpdatedAt ?? undefined };
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

export function parseArgs(argv: readonly string[]): ImportMlitArgs {
  const sourceDateRaw = parseFlagValue(argv, "--source-date");
  let sourceDate: Date | undefined;
  if (sourceDateRaw !== undefined) {
    const parsed = new Date(sourceDateRaw);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error(`--source-date "${sourceDateRaw}" is not a valid date`);
    }
    sourceDate = parsed;
  }

  return {
    wardsPath: parseFlagValue(argv, "--wards"),
    stationsPath: parseFlagValue(argv, "--stations"),
    railLinesPath: parseFlagValue(argv, "--rail-lines"),
    landPricesPath: parseFlagValue(argv, "--land-prices"),
    zoningPath: parseFlagValue(argv, "--zoning"),
    floodPath: parseFlagValue(argv, "--flood"),
    sourceDate,
  };
}

async function main(): Promise<void> {
  if (!process.env["DATABASE_URL"]) {
    console.error(
      "DATABASE_URL is not set. Set it to a PostgreSQL connection string, e.g.\n" +
        "  DATABASE_URL=postgresql://tokyo:tokyo@localhost:5432/tokyo pnpm import:mlit --wards ... ",
    );
    process.exit(1);
  }

  const args = parseArgs(process.argv.slice(2));
  const pool = createPool();
  try {
    const result = await runImport({ source: SOURCE, pool }, (client) => runMlitImport(client, args));
    console.log(`import:mlit complete. rows_imported=${result.rowsImported}`);
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


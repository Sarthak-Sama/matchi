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
 * seed fixture's placeholder rectangle. This is NOT silent: `upsertWards`
 * warns (and the run summary reports) exactly which ward codes were
 * overwritten and how many. A production environment should not run both
 * `pnpm db:seed` and `pnpm import:mlit` against the same database; a
 * shared test database (e.g. `tokyo_test`) that does both should re-run
 * `pnpm db:seed` afterward to restore a pure-seed baseline before relying
 * on seed-only invariants again.
 *
 * Deleting a ward no longer present in this run's wards file is guarded
 * the same way a real foreign-key-aware system should be: every FK column
 * referencing `wards(ward_code)` is discovered dynamically from Postgres's
 * catalog (`findWardForeignKeyRefs`), nullable ones are cleared first
 * (`station_groups.ward_code`, `land_prices.ward_code`,
 * `neighborhood_metrics.ward_code` today), and any `NOT NULL` one that
 * still has a row pointing at the ward being removed (`rent_stats.ward_code`
 * today, once `import:rent` has run) aborts with a clear error naming the
 * ward code, the row count, and the blocking table — instead of a raw,
 * unlabeled Postgres foreign-key-violation error. Because the discovery is
 * dynamic, a future migration adding another FK to `wards` is covered
 * automatically, with no change needed here.
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

/** A foreign key column somewhere in the schema that references `wards(ward_code)`. */
interface WardForeignKeyRef {
  readonly table: string;
  readonly column: string;
  readonly nullable: boolean;
}

/**
 * Discovers every FK column referencing `wards(ward_code)` directly from
 * Postgres's own catalog, rather than a hand-maintained list — so a future
 * migration that adds a new FK to `wards` (nullable or not) is picked up
 * automatically by both `nullWardReferences` and
 * `assertNoBlockingWardReferences` below, with no code change here.
 */
async function findWardForeignKeyRefs(client: PoolClient): Promise<WardForeignKeyRef[]> {
  const { rows } = await client.query<{
    table_name: string;
    column_name: string;
    nullable: boolean;
  }>(`
    SELECT
      c.conrelid::regclass::text AS table_name,
      a.attname AS column_name,
      NOT a.attnotnull AS nullable
    FROM pg_constraint c
    JOIN LATERAL unnest(c.conkey) AS ck(attnum) ON true
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ck.attnum
    WHERE c.contype = 'f' AND c.confrelid = 'wards'::regclass
  `);
  return rows.map((r) => ({ table: r.table_name, column: r.column_name, nullable: r.nullable }));
}

/**
 * A ward about to be deleted (not seen this run) might still be referenced
 * by a nullable FK column elsewhere (e.g. `station_groups.ward_code`,
 * `land_prices.ward_code`, `neighborhood_metrics.ward_code`). Null those
 * out first, regardless of the referencing row's own `source` — a ward
 * code that no longer exists is a stale reference no matter who wrote the
 * referencing row. The spatial join later in this script recomputes
 * correct `ward_code` values for every mlit-sourced row anyway.
 */
async function nullWardReferences(client: PoolClient, staleWardCodes: readonly string[]): Promise<void> {
  const refs = await findWardForeignKeyRefs(client);
  for (const ref of refs.filter((r) => r.nullable)) {
    await client.query(
      `UPDATE ${ref.table} SET ${ref.column} = NULL WHERE ${ref.column} = ANY($1::text[])`,
      [staleWardCodes],
    );
  }
}

/**
 * A `NOT NULL` FK column (e.g. `rent_stats.ward_code`) can't be nulled out
 * of the way like the nullable ones above — if any such row still
 * references a ward about to be deleted, the DELETE would otherwise fail
 * with a raw, unlabeled Postgres foreign-key-violation error. Detect that
 * up front and raise a clear, actionable error instead, naming the ward
 * codes and the blocking table(s).
 */
async function assertNoBlockingWardReferences(
  client: PoolClient,
  staleWardCodes: readonly string[],
): Promise<void> {
  const refs = await findWardForeignKeyRefs(client);
  const blockers: string[] = [];

  for (const ref of refs.filter((r) => !r.nullable)) {
    const { rows } = await client.query<{ ward_code: string; count: string }>(
      `SELECT ${ref.column} AS ward_code, count(*)::text AS count
       FROM ${ref.table}
       WHERE ${ref.column} = ANY($1::text[])
       GROUP BY ${ref.column}
       ORDER BY ${ref.column}`,
      [staleWardCodes],
    );
    for (const row of rows) {
      blockers.push(`ward ${row.ward_code} still has ${row.count} ${ref.table} row(s)`);
    }
  }

  if (blockers.length > 0) {
    throw new Error(
      `import:mlit — cannot remove ward(s) no longer present in this run's wards file: ` +
        `${blockers.join("; ")}. Re-run the relevant import (e.g. \`pnpm import:rent\`) after ` +
        `this one so those rows move off the ward being removed, or restore the ward(s) to your ` +
        `wards source file.`,
    );
  }
}

interface UpsertWardsResult {
  readonly rowsWritten: number;
  /** Ward codes that existed with a different `source` and just got overwritten. */
  readonly overwrittenDifferentSource: readonly string[];
}

async function upsertWards(
  client: PoolClient,
  wards: readonly ParsedWard[],
  sourceUpdatedAt: Date | null,
): Promise<UpsertWardsResult> {
  const seenCodes = wards.map((w) => w.wardCode);

  // Before mutating anything: warn about any incoming ward code that
  // already exists under a DIFFERENT source (e.g. a seed-owned ward whose
  // code happens to be a real Tokyo ward code — see this file's module
  // doc comment). This is silent otherwise: the upsert below succeeds
  // without a trace of what it just overwrote.
  const { rows: differentSourceRows } = await client.query<{ ward_code: string }>(
    `SELECT ward_code FROM wards WHERE ward_code = ANY($1::text[]) AND source IS DISTINCT FROM $2
     ORDER BY ward_code`,
    [seenCodes, SOURCE],
  );
  const overwrittenDifferentSource = differentSourceRows.map((r) => r.ward_code);
  if (overwrittenDifferentSource.length > 0) {
    console.warn(
      `import:mlit — ${overwrittenDifferentSource.length} existing ward(s) with a different ` +
        `source will be overwritten: ${overwrittenDifferentSource.join(", ")}`,
    );
  }

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

  const { rows: staleRows } = await client.query<{ ward_code: string }>(
    `SELECT ward_code FROM wards WHERE source = $2 AND ward_code <> ALL($1::text[])`,
    [seenCodes, SOURCE],
  );
  const staleCodes = staleRows.map((r) => r.ward_code);

  if (staleCodes.length > 0) {
    await assertNoBlockingWardReferences(client, staleCodes);
    await nullWardReferences(client, staleCodes);
    await client.query(`DELETE FROM wards WHERE source = $2 AND ward_code = ANY($1::text[])`, [
      staleCodes,
      SOURCE,
    ]);
  }

  return { rowsWritten: wards.length, overwrittenDifferentSource };
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

/**
 * `runMlitImport`'s result, widened beyond the shared `ImportResult`
 * contract with a couple of run-summary facts that are otherwise only
 * visible in this function's own `console.log`/`console.warn` output —
 * kept here so tests can assert on them directly instead of capturing
 * console output (which environment-dependent console interception makes
 * unreliable to spy on in tests). Still assignable wherever `ImportResult`
 * is expected (e.g. as `runImport`'s `fn` return value).
 */
export interface MlitImportResult extends ImportResult {
  readonly overwrittenDifferentSourceWardCodes: readonly string[];
  readonly stationsWithoutWardCode: number;
  /**
   * Of `landPrices.length` rows, how many `classifyLandUseCategory`d to
   * exactly `'residential'` — the only category `derive`'s rent step reads
   * (see `scripts/src/derive/rent.ts`). A count of zero here (with a
   * non-empty `landPrices`) means every station will hit the land-price
   * fallback and the station land-price term will vanish silently — see
   * this field's `console.warn` below.
   */
  readonly residentialLandPriceCount: number;
}

export async function runMlitImport(
  client: PoolClient,
  args: ImportMlitArgs,
): Promise<MlitImportResult> {
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
  const wardsResult = await upsertWards(client, wards, sourceUpdatedAt);
  rowsImported += wardsResult.rowsWritten;
  rowsImported += await upsertStations(client, stationGroups, sourceUpdatedAt);
  rowsImported += await upsertRailLines(client, railLines, sourceUpdatedAt);
  const residentialLandPriceCount = landPrices.filter((r) => r.useCategory === "residential").length;
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
  console.log(
    wardsResult.overwrittenDifferentSource.length > 0
      ? `import:mlit — ${wardsResult.overwrittenDifferentSource.length} existing ward(s) with a ` +
          `different source were overwritten: ${wardsResult.overwrittenDifferentSource.join(", ")}`
      : `import:mlit — no existing ward(s) with a different source were overwritten`,
  );
  console.log(
    `import:mlit — ${residentialLandPriceCount} of ${landPrices.length} imported land_prices row(s) ` +
      `classified as 'residential' (the only category derive's rent step reads).`,
  );
  if (landPrices.length > 0 && residentialLandPriceCount === 0) {
    console.warn(
      `import:mlit — WARNING: 0 of ${landPrices.length} land_prices row(s) classified as 'residential'. ` +
        `Every station's land-price multiplier will fall back to 1.0 and the station land-price term will ` +
        `vanish for this ward's rent estimates. This usually means the real L01 export uses a use_category ` +
        `field code or spelling this script doesn't recognize (see import-mlit/land-prices.ts's ` +
        `RESIDENTIAL_USE_TOKENS) — check the source file's actual field name/values for use_category.`,
    );
  }

  return {
    rowsImported,
    sourceUpdatedAt: sourceUpdatedAt ?? undefined,
    overwrittenDifferentSourceWardCodes: wardsResult.overwrittenDifferentSource,
    stationsWithoutWardCode: stationWard.withoutWard,
    residentialLandPriceCount,
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


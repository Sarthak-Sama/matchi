import type { PoolClient } from "pg";

import type { ImportResult } from "./lib/import-run.js";
import { parseFlagValue, runImportCliIfMain } from "./lib/cli.js";
import { inChunks } from "./lib/chunks.js";
import { expectRowCount } from "./lib/validate.js";
import { parseFeatureCollection, pointWKT } from "./import-mlit/geojson.js";
import type { ParsedLandPrice } from "./import-mlit/land-prices.js";
import { MIN_LAND_PRICES_ROWS, parseLandPrices } from "./import-mlit/land-prices.js";
import type { ParsedRailLine } from "./import-mlit/rail-lines.js";
import { MIN_RAIL_LINES_ROWS, parseRailLines } from "./import-mlit/rail-lines.js";
import type { MergedStationGroup } from "./import-mlit/station-merge.js";
import { mergeStations } from "./import-mlit/station-merge.js";
import { MIN_STATIONS_ROWS, parseStations } from "./import-mlit/stations.js";
import type { ParsedWard } from "./import-mlit/wards.js";
import { assertTokyoWards, MIN_WARDS_ROWS, parseWards } from "./import-mlit/wards.js";
import type { ParsedZoningArea } from "./import-mlit/zoning.js";
import { MIN_ZONING_ROWS, parseZoningAreas } from "./import-mlit/zoning.js";

const SOURCE = "mlit";

export interface ImportMlitArgs {
  readonly wardsPath?: string;
  readonly stationsPath?: string;
  readonly railLinesPath?: string;
  readonly landPricesPath?: string;
  readonly zoningPath?: string;

  readonly sourceDate?: Date;
  readonly n03SourceDate?: Date;
  readonly n02SourceDate?: Date;
  readonly l01SourceDate?: Date;
  readonly a55SourceDate?: Date;
}

async function loadDataset(label: string, localPath: string | undefined): Promise<string> {
  const { readFile } = await import("node:fs/promises");
  const defaults: Record<string, string> = {
    wards: "data/wards.geojson",
    stations: "data/stations.geojson",
    "rail-lines": "data/rail-lines.geojson",
    "land-prices": "data/land-prices.geojson",
    zoning: "data/zoning.geojson",
  };
  const source = localPath ?? defaults[label];
  if (!source) throw new Error(`import:mlit — no canonical path registered for ${label}`);
  try {
    return await readFile(source, "utf8");
  } catch (error) {
    throw new Error(
      `import:mlit — ${label} file is missing at ${source}. Run pnpm data:prepare first.`,
      { cause: error },
    );
  }
}

interface WardForeignKeyRef {
  readonly table: string;
  readonly column: string;
  readonly nullable: boolean;
}

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

async function nullWardReferences(
  client: PoolClient,
  staleWardCodes: readonly string[],
): Promise<void> {
  const refs = await findWardForeignKeyRefs(client);
  for (const ref of refs.filter((r) => r.nullable)) {
    await client.query(
      `UPDATE ${ref.table} SET ${ref.column} = NULL WHERE ${ref.column} = ANY($1::text[])`,
      [staleWardCodes],
    );
  }
}

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

  readonly overwrittenDifferentSource: readonly string[];
}

async function upsertWards(
  client: PoolClient,
  wards: readonly ParsedWard[],
  sourceUpdatedAt: Date | null,
): Promise<UpsertWardsResult> {
  const seenCodes = wards.map((w) => w.wardCode);

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
      [
        l.railLineId,
        l.operator,
        l.nameJa,
        l.nameEn ?? null,
        l.mode,
        l.geomWKT,
        SOURCE,
        sourceUpdatedAt,
      ],
    );
  }

  const seenIds = lines.map((l) => l.railLineId);
  await client.query(
    `DELETE FROM rail_lines WHERE source = $2 AND rail_line_id <> ALL($1::text[])`,
    [seenIds, SOURCE],
  );

  return lines.length;
}

async function replaceLandPrices(
  client: PoolClient,
  rows: readonly ParsedLandPrice[],
  sourceUpdatedAt: Date | null,
): Promise<number> {
  await client.query(`DELETE FROM land_prices WHERE source = $1`, [SOURCE]);
  await inChunks(rows, 500, async (chunk) => {
    await client.query(
      `INSERT INTO land_prices (point, price_yen_per_sqm, year, use_category, source, source_updated_at)
       SELECT ST_SetSRID(ST_GeomFromText(wkt), 4326), price, year, use_category, $5, $6
       FROM unnest($1::text[], $2::float8[], $3::int[], $4::text[]) AS x(wkt, price, year, use_category)`,
      [
        chunk.map((r) => pointWKT([r.lon, r.lat])),
        chunk.map((r) => r.priceYenPerSqm),
        chunk.map((r) => r.year),
        chunk.map((r) => r.useCategory ?? null),
        SOURCE,
        sourceUpdatedAt,
      ],
    );
  });
  return rows.length;
}

async function replaceZoning(
  client: PoolClient,
  rows: readonly ParsedZoningArea[],
  sourceUpdatedAt: Date | null,
): Promise<number> {
  await client.query(`DELETE FROM zoning_areas WHERE source = $1`, [SOURCE]);
  await inChunks(rows, 250, async (chunk) => {
    await client.query(
      `INSERT INTO zoning_areas (category, is_residential, geom, source, source_updated_at)
       SELECT category, is_residential, ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_SetSRID(ST_GeomFromText(wkt), 4326)), 3)), $4, $5
       FROM unnest($1::text[], $2::bool[], $3::text[]) AS x(category, is_residential, wkt)`,
      [
        chunk.map((r) => r.category),
        chunk.map((r) => r.isResidential),
        chunk.map((r) => r.geomWKT),
        SOURCE,
        sourceUpdatedAt,
      ],
    );
  });
  return rows.length;
}

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

export interface MlitImportResult extends ImportResult {
  readonly overwrittenDifferentSourceWardCodes: readonly string[];
  readonly stationsWithoutWardCode: number;

  readonly residentialLandPriceCount: number;
}

export async function runMlitImport(
  client: PoolClient,
  args: ImportMlitArgs,
): Promise<MlitImportResult> {
  const allDate = args.sourceDate;
  const n03Date = args.n03SourceDate ?? allDate ?? null;
  const n02Date = args.n02SourceDate ?? allDate ?? null;
  const l01Date = args.l01SourceDate ?? allDate ?? null;
  const a55Date = args.a55SourceDate ?? allDate ?? null;
  const sourceUpdatedAt =
    [n03Date, n02Date, l01Date, a55Date]
      .filter((date): date is Date => date !== null)
      .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;

  const wardsRaw = await loadDataset("wards", args.wardsPath);
  const wardFeatures = parseFeatureCollection(wardsRaw, "wards");
  expectRowCount(wardFeatures.length, { min: MIN_WARDS_ROWS, label: "wards" });
  const wards = parseWards(wardFeatures);
  assertTokyoWards(wards);

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

  let rowsImported = 0;
  const wardsResult = await upsertWards(client, wards, n03Date);
  rowsImported += wardsResult.rowsWritten;
  rowsImported += await upsertStations(client, stationGroups, n02Date);
  rowsImported += await upsertRailLines(client, railLines, n02Date);
  const residentialLandPriceCount = landPrices.filter(
    (r) => r.useCategory === "residential",
  ).length;
  rowsImported += await replaceLandPrices(client, landPrices, l01Date);
  rowsImported += await replaceZoning(client, zoning, a55Date);

  const stationWard = await assignWardCodes(client, "station_groups");
  await assignWardCodes(client, "land_prices");
  if (stationWard.withoutWard > 0) {
    throw new Error(
      `import:mlit — ${String(stationWard.withoutWard)} retained N02 station(s) have no ward assignment`,
    );
  }

  console.log(
    `import:mlit — wards=${wards.length} stations=${stationGroups.length} ` +
      `(from ${rawStations.length} raw feature(s)) rail_lines=${railLines.length} ` +
      `land_prices=${landPrices.length} zoning=${zoning.length}`,
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

export function parseArgs(argv: readonly string[]): ImportMlitArgs {
  const date = (flag: string): Date | undefined => {
    const raw = parseFlagValue(argv, flag);
    if (raw === undefined) return undefined;
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error(`${flag} "${raw}" is not a valid date`);
    }
    return parsed;
  };

  return {
    wardsPath: parseFlagValue(argv, "--wards"),
    stationsPath: parseFlagValue(argv, "--stations"),
    railLinesPath: parseFlagValue(argv, "--rail-lines"),
    landPricesPath: parseFlagValue(argv, "--land-prices"),
    zoningPath: parseFlagValue(argv, "--zoning"),
    sourceDate: date("--source-date"),
    n03SourceDate: date("--n03-source-date"),
    n02SourceDate: date("--n02-source-date"),
    l01SourceDate: date("--l01-source-date"),
    a55SourceDate: date("--a55-source-date"),
  };
}

runImportCliIfMain(import.meta.url, {
  commandName: "import:mlit",
  commandExample: "pnpm import:mlit --wards ... ",
  parseArgs,
  source: () => SOURCE,
  run: runMlitImport,
});

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Pool } from "pg";

import {
  buildRomanizationIndex,
  parseJapanPostCsv,
  resolveLocalityNames,
} from "./import-localities/romanization.js";
import { createPool } from "./lib/db.js";
import { runImport } from "./lib/import-run.js";

const SOURCE = "estat-boundaries";
const SOURCE_UPDATED_AT = new Date("2022-06-24T00:00:00Z");

export type GeoJsonFeature = {
  readonly properties?: Record<string, unknown>;
  readonly geometry?: { readonly type: string; readonly coordinates: unknown } | null;
};

function value(
  properties: Record<string, unknown> | undefined,
  keys: readonly string[],
): string | null {
  for (const key of keys) {
    const raw = properties?.[key];
    if (typeof raw === "string" || typeof raw === "number") return String(raw).trim() || null;
  }
  return null;
}

export function normalizeLocalityName(name: string): string {
  return name
    .normalize("NFKC")
    .replace(/[一二三四五六七八九十]+丁目$/u, "")
    .replace(/[0-9]+丁目$/u, "")
    .replace(/丁目$/u, "")
    .trim();
}

export function localityId(wardCode: string, nameJa: string): string {
  return `${wardCode}:${createHash("sha256").update(nameJa).digest("hex").slice(0, 16)}`;
}

export interface LocalityGroup {
  readonly wardCode: string;
  readonly nameJa: string;
  readonly geometries: string[];
  population: number;
  households: number;
  areaSqm: number;
}

function count(properties: Record<string, unknown> | undefined, key: string): number {
  const raw = Number(properties?.[key] ?? 0);
  return Number.isFinite(raw) ? raw : 0;
}

// Groups census town/chome polygons into localities. JINKO, SETAI and AREA
// are summed: when one town code has several polygons the census puts the
// counts on the first and zeros on the rest, so a plain sum is right.
export function groupLocalityFeatures(
  features: readonly GeoJsonFeature[],
): Map<string, LocalityGroup> {
  const grouped = new Map<string, LocalityGroup>();
  for (const feature of features) {
    if (!feature.geometry || !["Polygon", "MultiPolygon"].includes(feature.geometry.type)) continue;
    const rawWardCode = value(feature.properties, ["ward_code", "N03_007", "KEY_CODE", "CITYCODE"]);

    const wardCode = rawWardCode?.slice(0, 5) ?? null;
    const rawName = value(feature.properties, ["name_ja", "S_NAME", "MOJI", "町丁名", "NAME"]);
    if (!wardCode || !/^131(?:0[1-9]|1[0-9]|2[0-3])$/.test(wardCode) || !rawName) continue;
    const nameJa = normalizeLocalityName(rawName);
    if (!nameJa) continue;
    const key = `${wardCode}\u0000${nameJa}`;
    const entry = grouped.get(key) ?? {
      wardCode,
      nameJa,
      geometries: [],
      population: 0,
      households: 0,
      areaSqm: 0,
    };
    entry.geometries.push(JSON.stringify(feature.geometry));
    entry.population += count(feature.properties, "JINKO");
    entry.households += count(feature.properties, "SETAI");
    entry.areaSqm += count(feature.properties, "AREA");
    grouped.set(key, entry);
  }
  return grouped;
}

export async function readLocalityFeatures(path: string): Promise<GeoJsonFeature[]> {
  const parsed = JSON.parse(await readFile(path, "utf8")) as { features?: GeoJsonFeature[] };
  if (!Array.isArray(parsed.features))
    throw new Error(`${path}: expected GeoJSON FeatureCollection`);
  return parsed.features;
}

export async function importLocalities(
  pool: Pool,
  path = "data/localities.geojson",
  romanizationPath = "data/locality-romanization.csv",
): Promise<number> {
  const grouped = groupLocalityFeatures(await readLocalityFeatures(path));
  if (grouped.size === 0)
    throw new Error(`${path}: no Tokyo 23-ward town/chome features recognized`);

  // The wards table must already be populated (import:mlit runs first in the refresh
  // order) — ward-scoped romanization lookups and the clip CTE both depend on it.
  const { rows: wardRows } = await pool.query<{ ward_code: string; name_ja: string }>(
    "SELECT ward_code, name_ja FROM wards",
  );
  const wardNameJaByCode = new Map(wardRows.map((row) => [row.ward_code, row.name_ja]));
  const missingWardCodes = [...new Set(Array.from(grouped.values(), (entry) => entry.wardCode))]
    .filter((wardCode) => !wardNameJaByCode.has(wardCode))
    .sort();
  if (missingWardCodes.length > 0) {
    throw new Error(
      `${path}: wards table has no row for ward_code(s) ${missingWardCodes.join(", ")} — run import:mlit before import:localities`,
    );
  }

  const romanizationBytes = await readFile(romanizationPath);
  const romanizationIndex = buildRomanizationIndex(parseJapanPostCsv(romanizationBytes));
  const { nameEnByKey } = resolveLocalityNames({
    localities: Array.from(grouped.values(), (entry) => ({
      wardCode: entry.wardCode,
      // Guaranteed present by the missingWardCodes check above; the fallback only
      // keeps this expression typed under noUncheckedIndexedAccess.
      wardNameJa: wardNameJaByCode.get(entry.wardCode) ?? "",
      nameJa: entry.nameJa,
    })),
    index: romanizationIndex,
  });

  const result = await runImport({ pool, source: SOURCE }, async (client) => {
    await client.query("DELETE FROM localities WHERE source IN ('estat-2020', $1)", [SOURCE]);
    let written = 0;
    for (const entry of grouped.values()) {
      const id = localityId(entry.wardCode, entry.nameJa);
      const key = `${entry.wardCode}\u0000${entry.nameJa}`;
      const nameEn = nameEnByKey.get(key);
      if (nameEn === undefined) {
        throw new Error(
          `${path}: resolveLocalityNames did not resolve ${entry.wardCode} ${entry.nameJa}`,
        );
      }
      const { rowCount } = await client.query(
        `WITH dissolved AS (
           SELECT ST_Multi(ST_CollectionExtract(ST_MakeValid(
             ST_UnaryUnion(ST_Collect(ST_SetSRID(ST_GeomFromGeoJSON(geojson), 4326)))
           ), 3)) AS geom
           FROM unnest($4::text[]) AS input(geojson)
         ), clipped AS (
           SELECT ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_Intersection(d.geom, w.geom)), 3)) AS geom
           FROM dissolved d JOIN wards w ON w.ward_code=$2
         )
         INSERT INTO localities (locality_id, ward_code, name_ja, name_en, geom, centroid, source,
           source_updated_at, population, households, area_sqm)
         SELECT $1, $2, $3, $7, geom, ST_PointOnSurface(geom), $5, $6, $8, $9, $10
         FROM clipped WHERE NOT ST_IsEmpty(geom)`,
        [
          id,
          entry.wardCode,
          entry.nameJa,
          entry.geometries,
          SOURCE,
          SOURCE_UPDATED_AT,
          nameEn,
          entry.population,
          entry.households,
          entry.areaSqm,
        ],
      );
      written += rowCount ?? 0;
    }
    return { rowsImported: written, sourceUpdatedAt: SOURCE_UPDATED_AT };
  });
  return result.rowsImported;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!process.env["DATABASE_URL"])
    throw new Error("DATABASE_URL is required for import:localities");
  const source = process.argv[2] ?? "data/localities.geojson";
  const pool = createPool();
  importLocalities(pool, source)
    .then((rows) => console.log(`import:localities — ${rows} localities`))
    .finally(() => pool.end());
}

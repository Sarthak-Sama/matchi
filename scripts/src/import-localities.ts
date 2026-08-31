/** Imports official e-Stat 2020 town/chome boundaries and dissolves chome names per ward. */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Pool } from "pg";

import { createPool } from "./lib/db.js";
import { runImport } from "./lib/import-run.js";

const SOURCE = "estat-boundaries";
const SOURCE_UPDATED_AT = new Date("2022-06-24T00:00:00Z");

type GeoJsonFeature = {
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

/** `初台１丁目`, `初台1丁目`, and `初台一丁目` all become the authoritative `初台`. */
export function normalizeLocalityName(name: string): string {
  return name
    .normalize("NFKC")
    .replace(/[一二三四五六七八九十]+丁目$/u, "")
    .replace(/[0-9]+丁目$/u, "")
    .replace(/丁目$/u, "")
    .trim();
}

function localityId(wardCode: string, nameJa: string): string {
  return `${wardCode}:${createHash("sha256").update(nameJa).digest("hex").slice(0, 16)}`;
}

export async function importLocalities(
  pool: Pool,
  path = "data/localities.geojson",
): Promise<number> {
  const parsed = JSON.parse(await readFile(path, "utf8")) as { features?: GeoJsonFeature[] };
  if (!Array.isArray(parsed.features))
    throw new Error(`${path}: expected GeoJSON FeatureCollection`);
  const grouped = new Map<string, { wardCode: string; nameJa: string; geometries: string[] }>();
  for (const feature of parsed.features) {
    if (!feature.geometry || !["Polygon", "MultiPolygon"].includes(feature.geometry.type)) continue;
    const rawWardCode = value(feature.properties, ["ward_code", "N03_007", "KEY_CODE", "CITYCODE"]);
    // e-Stat's KEY_CODE identifies a town/chome and begins with the five
    // digit municipality code; MLIT ward files already provide five digits.
    const wardCode = rawWardCode?.slice(0, 5) ?? null;
    const rawName = value(feature.properties, ["name_ja", "S_NAME", "MOJI", "町丁名", "NAME"]);
    if (!wardCode || !/^131(?:0[1-9]|1[0-9]|2[0-3])$/.test(wardCode) || !rawName) continue;
    const nameJa = normalizeLocalityName(rawName);
    if (!nameJa) continue;
    const key = `${wardCode}\u0000${nameJa}`;
    const entry = grouped.get(key) ?? { wardCode, nameJa, geometries: [] };
    entry.geometries.push(JSON.stringify(feature.geometry));
    grouped.set(key, entry);
  }
  if (grouped.size === 0)
    throw new Error(`${path}: no Tokyo 23-ward town/chome features recognized`);
  const result = await runImport({ pool, source: SOURCE }, async (client) => {
    await client.query("DELETE FROM localities WHERE source IN ('estat-2020', $1)", [SOURCE]);
    let written = 0;
    for (const entry of grouped.values()) {
      const id = localityId(entry.wardCode, entry.nameJa);
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
         INSERT INTO localities (locality_id, ward_code, name_ja, geom, centroid, source, source_updated_at)
         SELECT $1, $2, $3, geom, ST_PointOnSurface(geom), $5, $6
         FROM clipped WHERE NOT ST_IsEmpty(geom)`,
        [id, entry.wardCode, entry.nameJa, entry.geometries, SOURCE, SOURCE_UPDATED_AT],
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

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import iconv from "iconv-lite";
import type { PoolClient } from "pg";

import { DATA_DIR, loadDataCatalog, type CatalogEntry } from "./data-catalog.js";
import { normalizeLocalityName } from "./import-localities.js";
import { inChunks } from "./lib/chunks.js";
import { runImportCliIfMain } from "./lib/cli.js";
import { parseCsvRecords } from "./lib/csv.js";
import type { ImportResult } from "./lib/import-run.js";

const RAW_SAFETY_DIR = path.join(DATA_DIR, "raw", "safety");
const WRITE_CHUNK = 500;
const UNMATCHED_EXAMPLES = 10;
// A31a depth rank 1 is under 0.5 m; rank 2 and above is 0.5 m or deeper.
const MIN_FLOOD_DEPTH_RANK = 2;

type SourceName = "quake" | "flood" | "crime";

interface LocalityIndex {
  readonly idByKey: ReadonlyMap<string, string>;
  readonly populationById: ReadonlyMap<string, number>;
  readonly wards: readonly { readonly wardCode: string; readonly nameJa: string }[];
}

interface SafetyRow {
  readonly localityId: string;
  readonly values: readonly (number | null)[];
  readonly detail: Record<string, unknown>;
}

interface SafetyPart {
  readonly source: SourceName;
  readonly columns: readonly string[];
  readonly rows: readonly SafetyRow[];
}

interface SourceDefinition {
  readonly name: SourceName;
  readonly entryIds: readonly string[];
  readonly read: (
    client: PoolClient,
    index: LocalityIndex,
    entries: readonly CatalogEntry[],
  ) => Promise<SafetyPart>;
}

function rawPath(entry: CatalogEntry): string {
  return path.join(RAW_SAFETY_DIR, entry.archive);
}

function localityKey(wardCode: string, rawName: string): string {
  return `${wardCode}\u0000${normalizeLocalityName(rawName)}`;
}

async function loadLocalityIndex(client: PoolClient): Promise<LocalityIndex> {
  const localities = await client.query<{
    locality_id: string;
    ward_code: string;
    name_ja: string;
    population: number | null;
  }>("SELECT locality_id, ward_code, name_ja, population FROM localities");
  const wards = await client.query<{ ward_code: string; name_ja: string }>(
    "SELECT ward_code, name_ja FROM wards",
  );
  return {
    idByKey: new Map(
      localities.rows.map((r) => [localityKey(r.ward_code, r.name_ja), r.locality_id]),
    ),
    populationById: new Map(localities.rows.map((r) => [r.locality_id, r.population ?? 0])),
    wards: wards.rows.map((r) => ({ wardCode: r.ward_code, nameJa: r.name_ja })),
  };
}

function reportUnmatched(label: string, unmatched: readonly string[]): void {
  if (unmatched.length === 0) return;
  const examples = unmatched.slice(0, UNMATCHED_EXAMPLES).join(", ");
  console.warn(`import:safety — ${label}: ${unmatched.length} unmatched rows (e.g. ${examples})`);
}

async function readShiftJisCsv(file: string): Promise<Record<string, string>[]> {
  return parseCsvRecords(iconv.decode(await readFile(file), "Shift_JIS"));
}

function roundedMean(values: readonly number[]): number {
  return Math.round(values.reduce((sum, v) => sum + v, 0) / values.length);
}

// Tokyo Metropolitan Government earthquake risk survey: one row per chome, so
// a locality (all its chome merged) takes the rounded mean rank.
async function readQuake(
  _client: PoolClient,
  index: LocalityIndex,
  entries: readonly CatalogEntry[],
): Promise<SafetyPart> {
  const [entry] = entries;
  if (!entry) throw new Error("quake catalog entry missing");
  const wardCodeByName = new Map(index.wards.map((w) => [w.nameJa, w.wardCode]));
  const ranksById = new Map<string, { collapse: number[]; fire: number[]; combined: number[] }>();
  const unmatched: string[] = [];
  for (const record of await readShiftJisCsv(rawPath(entry))) {
    const wardCode = wardCodeByName.get(record["区市町名"] ?? "");
    if (!wardCode) continue; // cities outside the 23 wards
    const name = record["町丁目名"] ?? "";
    const localityId = index.idByKey.get(localityKey(wardCode, name));
    const ranks = [
      Number(record["建物倒壊危険度ランク"]),
      Number(record["火災危険度ランク"]),
      Number(record["総合危険度ランク"]),
    ];
    if (!localityId || ranks.some((r) => !Number.isInteger(r))) {
      unmatched.push(`${record["区市町名"]}${name}`);
      continue;
    }
    const entryRanks = ranksById.get(localityId) ?? { collapse: [], fire: [], combined: [] };
    entryRanks.collapse.push(ranks[0] ?? 0);
    entryRanks.fire.push(ranks[1] ?? 0);
    entryRanks.combined.push(ranks[2] ?? 0);
    ranksById.set(localityId, entryRanks);
  }
  reportUnmatched("quake", unmatched);
  const rows = [...ranksById].map(([localityId, ranks]) => ({
    localityId,
    values: [roundedMean(ranks.combined), roundedMean(ranks.fire)],
    detail: { release: entry.release, collapse_rank: roundedMean(ranks.collapse) },
  }));
  return { source: "quake", columns: ["quake_rank", "fire_rank"], rows };
}

function zipMembers(zip: string, matcher: RegExp): string[] {
  return execFileSync("unzip", ["-Z1", zip], { encoding: "utf8" })
    .split("\n")
    .filter((member) => matcher.test(member));
}

// The A31a archives store Windows-style paths with Shift-JIS folder names, so
// a member is addressed by its ASCII file name alone.
function readZipMember(zip: string, member: string): string {
  const fileName = member.split(/[\\/]/).pop() ?? member;
  return execFileSync("unzip", ["-p", zip, `*${fileName}`], {
    encoding: "utf8",
    maxBuffer: 512 * 1024 * 1024,
  });
}

// Maximum-scale scenario (folder 20) of one river class, depth 0.5 m or more.
function readFloodGeometries(zip: string): string[] {
  const geometries: string[] = [];
  for (const member of zipMembers(zip, /A31a-20-\d+_13_[^\\/]*\.geojson$/)) {
    const parsed = JSON.parse(readZipMember(zip, member)) as {
      features?: { properties?: { A31a_205?: unknown }; geometry?: unknown }[];
    };
    for (const feature of parsed.features ?? []) {
      if (feature.geometry && Number(feature.properties?.A31a_205) >= MIN_FLOOD_DEPTH_RANK) {
        geometries.push(JSON.stringify(feature.geometry));
      }
    }
  }
  return geometries;
}

// Zones from different rivers overlap, so each locality's zones are unioned
// before measuring. Areas are planar degrees: the ratio is what matters and
// the distortion inside one locality is negligible. The data is JGD2011 and
// is treated as WGS84, which differs by centimetres.
async function readFlood(
  client: PoolClient,
  _index: LocalityIndex,
  entries: readonly CatalogEntry[],
): Promise<SafetyPart> {
  await client.query("CREATE TEMP TABLE flood_zone (geom geometry(Geometry, 4326)) ON COMMIT DROP");
  for (const entry of entries) {
    await inChunks(readFloodGeometries(rawPath(entry)), 200, async (chunk) => {
      await client.query(
        `INSERT INTO flood_zone
         SELECT ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(g), 4326)) FROM unnest($1::text[]) AS g`,
        [chunk],
      );
    });
  }
  await client.query("CREATE INDEX ON flood_zone USING gist (geom)");
  await client.query("ANALYZE flood_zone");
  const { rows } = await client.query<{ locality_id: string; share: number }>(
    `SELECT l.locality_id,
            LEAST(1, COALESCE(f.flooded_area / ST_Area(l.geom), 0)) AS share
     FROM localities l
     LEFT JOIN LATERAL (
       SELECT ST_Area(ST_Intersection(l.geom, ST_UnaryUnion(ST_Collect(z.geom)))) AS flooded_area
       FROM flood_zone z WHERE ST_Intersects(l.geom, z.geom)
     ) f ON true`,
  );
  return {
    source: "flood",
    columns: ["flood_share"],
    rows: rows.map((row) => ({
      localityId: row.locality_id,
      values: [row.share],
      detail: { release: entries[0]?.release },
    })),
  };
}

// The police file names rows "<ward><town><n>丁目" in one cell, so the ward is
// split off by its name.
async function readCrime(
  _client: PoolClient,
  index: LocalityIndex,
  entries: readonly CatalogEntry[],
): Promise<SafetyPart> {
  const [entry] = entries;
  if (!entry) throw new Error("crime catalog entry missing");
  const offencesById = new Map<string, number>();
  const unmatched: string[] = [];
  for (const record of await readShiftJisCsv(rawPath(entry))) {
    const label = record["市区町丁"] ?? "";
    const ward = index.wards.find((w) => label.startsWith(w.nameJa));
    const town = ward ? label.slice(ward.nameJa.length) : "";
    if (!ward || town === "計") continue; // other cities, ward subtotals
    const localityId = index.idByKey.get(localityKey(ward.wardCode, town));
    const offences = Number(record["総合計"]);
    if (!localityId || !Number.isFinite(offences)) {
      unmatched.push(label);
      continue;
    }
    offencesById.set(localityId, (offencesById.get(localityId) ?? 0) + offences);
  }
  reportUnmatched("crime", unmatched);
  const rows = [...offencesById].map(([localityId, offences]) => {
    const population = index.populationById.get(localityId) ?? 0;
    return {
      localityId,
      values: [population > 0 ? (offences * 1000) / population : null],
      detail: { release: entry.release, offences, population },
    };
  });
  return { source: "crime", columns: ["crime_per_1k"], rows };
}

const SOURCES: readonly SourceDefinition[] = [
  { name: "quake", entryIds: ["tmg-quake-risk-9"], read: readQuake },
  { name: "flood", entryIds: ["ksj-a31a-13-national", "ksj-a31a-13-prefecture"], read: readFlood },
  { name: "crime", entryIds: ["mpd-crime-r7"], read: readCrime },
];

// Clears this source's columns first so a locality that dropped out of the
// source does not keep an old value; other sources' columns are untouched.
async function storePart(client: PoolClient, part: SafetyPart): Promise<void> {
  const clear = part.columns.map((column) => `${column} = NULL`).join(", ");
  await client.query(`UPDATE locality_safety SET ${clear}, sources = sources - $1`, [part.source]);

  const assign = part.columns.map((column) => `${column} = EXCLUDED.${column}`).join(", ");
  const valueArrays = part.columns.map((_, i) => `$${i + 2}::numeric[]`).join(", ");
  const sourcesParam = `$${part.columns.length + 2}::jsonb[]`;
  await inChunks(part.rows, WRITE_CHUNK, async (chunk) => {
    await client.query(
      `INSERT INTO locality_safety (locality_id, ${part.columns.join(", ")}, sources)
       SELECT * FROM unnest($1::text[], ${valueArrays}, ${sourcesParam})
       ON CONFLICT (locality_id) DO UPDATE
       SET ${assign}, sources = locality_safety.sources || EXCLUDED.sources`,
      [
        chunk.map((row) => row.localityId),
        ...part.columns.map((_, i) => chunk.map((row) => row.values[i] ?? null)),
        chunk.map((row) => JSON.stringify({ [part.source]: row.detail })),
      ],
    );
  });
}

function entriesFor(catalog: readonly CatalogEntry[], ids: readonly string[]): CatalogEntry[] {
  return ids.map((id) => {
    const entry = catalog.find((candidate) => candidate.id === id);
    if (!entry) throw new Error(`data/catalog.json has no entry ${id}`);
    return entry;
  });
}

async function runSafetyImport(client: PoolClient): Promise<ImportResult> {
  const catalog = await loadDataCatalog();
  const index = await loadLocalityIndex(client);
  let sourceUpdatedAt: Date | undefined;
  for (const source of SOURCES) {
    const entries = entriesFor(catalog, source.entryIds);
    const missing = entries.filter((entry) => !existsSync(rawPath(entry)));
    if (missing.length > 0) {
      const wanted = missing.map((entry) => `${entry.url} -> ${rawPath(entry)}`).join("; ");
      console.warn(`import:safety — skipping ${source.name}, file not found. Download ${wanted}`);
      continue;
    }
    const part = await source.read(client, index, entries);
    await storePart(client, part);
    console.log(
      `import:safety — ${source.name}: ${part.rows.length}/${index.populationById.size} localities`,
    );
    for (const entry of entries) {
      const date = new Date(entry.sourceDate);
      if (!sourceUpdatedAt || date > sourceUpdatedAt) sourceUpdatedAt = date;
    }
  }
  const { rows } = await client.query<{ count: string }>("SELECT count(*) FROM locality_safety");
  return { rowsImported: Number(rows[0]?.count ?? 0), sourceUpdatedAt };
}

runImportCliIfMain(import.meta.url, {
  commandName: "import:safety",
  commandExample: "pnpm import:safety",
  parseArgs: () => ({}),
  source: () => "safety",
  run: runSafetyImport,
});

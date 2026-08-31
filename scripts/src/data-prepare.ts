import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  DATA_DIR,
  loadDataCatalog,
  prepareArchives,
  RAW_ESTAT_BOUNDARY_DIR,
  RAW_MLIT_DIR,
} from "./data-catalog.js";
import { runStageMlit } from "./stage-mlit.js";

function archivePath(id: string, entries: readonly { id: string; archive: string }[]): string {
  const archive = entries.find((entry) => entry.id === id)?.archive;
  if (!archive) throw new Error(`catalog is missing ${id}`);
  return path.join(RAW_MLIT_DIR, archive);
}

function zipEntries(zip: string): string[] {
  return execFileSync("unzip", ["-Z1", zip], { encoding: "utf8" }).split("\n").filter(Boolean);
}

function sourceInZip(zip: string, matcher: RegExp): string {
  const entry = zipEntries(zip).find((name) => matcher.test(name));
  if (!entry) throw new Error(`${zip}: no source matching ${String(matcher)}`);
  return `/vsizip/${zip}/${entry}`;
}

function ogrToGeoJson(zip: string, matcher: RegExp, out: string): void {
  execFileSync(
    "ogr2ogr",
    ["-f", "GeoJSON", "-t_srs", "EPSG:4326", out, sourceInZip(zip, matcher)],
    { stdio: "inherit" },
  );
}

function mergeFeatureCollections(files: readonly string[], out: string): void {
  const features = files.flatMap((file) => {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as { features?: unknown[] };
    if (!Array.isArray(parsed.features)) throw new Error(`${file}: expected GeoJSON features`);
    return parsed.features;
  });
  writeFileSync(out, JSON.stringify({ type: "FeatureCollection", features }));
}

function retainTokyoSpecialWards(file: string): void {
  const collection = JSON.parse(readFileSync(file, "utf8")) as {
    type?: string;
    features?: Array<{ properties?: Record<string, unknown> }>;
  };
  if (!Array.isArray(collection.features)) throw new Error(`${file}: expected GeoJSON features`);
  collection.features = collection.features.filter((feature) => {
    const code = String(feature.properties?.N03_007 ?? feature.properties?.ward_code ?? "");
    return /^131(?:0[1-9]|1[0-9]|2[0-3])$/.test(code);
  });
  const codes = new Set(
    collection.features.map((feature) =>
      String(feature.properties?.N03_007 ?? feature.properties?.ward_code ?? ""),
    ),
  );
  if (codes.size !== 23) {
    throw new Error(`${file}: expected exactly 23 Tokyo special-ward codes, found ${codes.size}`);
  }
  writeFileSync(file, JSON.stringify(collection));
}

export async function runDataPrepare(): Promise<void> {
  const entries = await loadDataCatalog();
  await prepareArchives(entries);
  mkdirSync(path.join(DATA_DIR, "staged"), { recursive: true });
  const n03 = archivePath("n03", entries);
  const n02 = archivePath("n02", entries);
  const l01 = archivePath("l01", entries);
  const localityEntry = entries.find((entry) => entry.id === "estat-localities-2020");
  if (!localityEntry) throw new Error("catalog is missing estat-localities-2020");
  ogrToGeoJson(
    path.join(RAW_ESTAT_BOUNDARY_DIR, localityEntry.archive),
    /\.shp$/i,
    path.join(DATA_DIR, "localities.geojson"),
  );
  const stationsRaw = path.join(DATA_DIR, "staged", "n02-stations.geojson");
  const railsRaw = path.join(DATA_DIR, "staged", "n02-rails.geojson");
  const wardsOut = path.join(DATA_DIR, "wards.geojson");
  ogrToGeoJson(n03, /\.shp$/i, wardsOut);
  retainTokyoSpecialWards(wardsOut);
  ogrToGeoJson(n02, /_Station\.geojson$/i, stationsRaw);
  ogrToGeoJson(n02, /_RailroadSection\.geojson$/i, railsRaw);
  ogrToGeoJson(l01, /\.shp$/i, path.join(DATA_DIR, "land-prices.geojson"));
  const zoningParts = entries
    .filter((entry) => entry.dataset === "A55")
    .map((entry) => {
      const out = path.join(DATA_DIR, "staged", `${entry.id}.geojson`);
      ogrToGeoJson(path.join(RAW_MLIT_DIR, entry.archive), /_youto\.geojson$/i, out);
      return out;
    });
  mergeFeatureCollections(zoningParts, path.join(DATA_DIR, "zoning.geojson"));
  runStageMlit({
    stationsIn: stationsRaw,
    railIn: railsRaw,
    wardsIn: wardsOut,
    stationsOut: path.join(DATA_DIR, "stations.geojson"),
    railOut: path.join(DATA_DIR, "rail-lines.geojson"),
  });
  console.log(
    `data:prepare — verified ${entries.length} archive(s) and generated canonical GeoJSON under data/.`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runDataPrepare().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}

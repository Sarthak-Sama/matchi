/**
 * `pnpm stage:flood` — turns MLIT's Kanto-wide A31 flood-hazard release
 * into the single Tokyo-only file `pnpm import:mlit --flood` expects.
 *
 *   pnpm stage:flood --zip data/raw/mlit/A31-19_83_GEOJSON.zip \
 *     --wards data/wards.geojson --out data/flood.geojson
 *
 * The release is one 445 MB archive holding 112 GeoJSON files, 9.8 GB
 * uncompressed, organised into four hazard layers:
 *
 *   01_計画規模                 planning-scale inundation
 *   02_想定最大規模             MAXIMUM ASSUMED scale  <- what we import
 *   03_浸水継続時間             inundation duration
 *   04_家屋倒壊等氾濫想定区域   building-collapse zones
 *
 * Only `02_想定最大規模` is imported: that is the layer Japanese hazard
 * maps present as the worst-case flood extent, and it is what a resident
 * comparing neighbourhoods is actually being warned about. The other three
 * answer different questions and would double-count the same ground.
 *
 * Every river file in that layer is offered to GDAL with a `-spat` filter
 * set to `TOKYO_23_WARDS_BBOX` and a `-clipsrc` against the dissolved ward
 * polygons, so surviving geometry is trimmed to the 23 wards rather than
 * merely overlapping their bounding box — the box also covers Hachioji and
 * parts of Saitama and Chiba. Rivers contributing nothing are reported and
 * skipped. Filtering rather than hand-picking rivers is
 * deliberate: 荒川/江戸川/多摩川 are the obvious ones, but whether, say,
 * 利根川's maximum-assumed extent reaches the 23 wards is a question about
 * the data, not one to answer from memory.
 *
 * Depth codes are resolved by `stage-flood/depth-rank.ts`, which explains
 * why this layer needs `A31_201` where `import-mlit/flood.ts` expects
 * `A31_101`.
 *
 * Requires `ogr2ogr` on PATH. Writes files; touches no database.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { TOKYO_23_WARDS_BBOX } from "@tokyo/shared";

import { toArealGeometry } from "./stage-flood/areal-geometry.js";
import { floodDepthFromA31201 } from "./stage-flood/depth-rank.js";

/** The archive directory holding the maximum-assumed-scale layer. */
const MAX_SCALE_DIR = "02_想定最大規模";

interface Feature {
  readonly type: string;
  readonly properties: Record<string, unknown> | null;
  readonly geometry: unknown;
}

export interface StageFloodArgs {
  readonly zip: string;
  readonly out: string;
  /** Dissolved 23-ward polygons; flood geometry is clipped to these. */
  readonly wards: string;
}

function flagValue(argv: readonly string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

export function parseArgs(argv: readonly string[]): StageFloodArgs {
  const zip = flagValue(argv, "--zip");
  const out = flagValue(argv, "--out");
  const wards = flagValue(argv, "--wards");
  if (!zip || !out || !wards) {
    throw new Error("stage:flood requires --zip, --wards and --out");
  }
  return { zip, out, wards };
}

/**
 * Lists every entry in the archive's central directory, as both the raw
 * bytes and the decoded name.
 *
 * The archive stores Shift-JIS filenames, which Node surfaces as mojibake.
 * Entries are matched on the decoded name, but GDAL's `/vsizip/` needs the
 * bytes exactly as stored — hence carrying both.
 */
export function listZipEntries(zipPath: string): { raw: string; decoded: string }[] {
  const buffer = readFileSync(zipPath);
  const entries: { raw: string; decoded: string }[] = [];
  // Walk central-directory headers (PK\x01\x02) rather than pulling in a
  // zip dependency — we only need names, never contents.
  for (let i = 0; i + 46 <= buffer.length; i += 1) {
    if (buffer.readUInt32LE(i) !== 0x02014b50) continue;
    const nameLength = buffer.readUInt16LE(i + 28);
    const extraLength = buffer.readUInt16LE(i + 30);
    const commentLength = buffer.readUInt16LE(i + 32);
    const nameBytes = buffer.subarray(i + 46, i + 46 + nameLength);
    entries.push({
      raw: nameBytes.toString("binary"),
      decoded: decodeShiftJis(nameBytes),
    });
    i += 46 + nameLength + extraLength + commentLength - 1;
  }
  return entries;
}

function decodeShiftJis(bytes: Buffer): string {
  return new TextDecoder("shift_jis").decode(bytes);
}

/**
 * `CPL_ZIP_ENCODING` tells GDAL the archive's filenames are Shift-JIS, so
 * `/vsizip/` resolves entries addressed by their DECODED name. Without it
 * the entry has to be addressed by its raw stored bytes, which cannot
 * survive a trip through `execFileSync` — Node encodes argv as UTF-8 and
 * mangles every byte above 0x7F.
 */
const ZIP_ENCODING_ENV = { ...process.env, CPL_ZIP_ENCODING: "CP932" };

function runOgr2ogr(source: string, destination: string, wards: string): void {
  execFileSync(
    "ogr2ogr",
    [
      "-f",
      "GeoJSON",
      "-t_srs",
      "EPSG:4326",
      // -spat is the cheap pass: it rejects whole rivers on their bounding
      // box before any geometry work. -clipsrc then trims what survives to
      // the actual ward boundaries, so no polygon extends outside the 23
      // wards the app scores.
      "-spat",
      String(TOKYO_23_WARDS_BBOX.west),
      String(TOKYO_23_WARDS_BBOX.south),
      String(TOKYO_23_WARDS_BBOX.east),
      String(TOKYO_23_WARDS_BBOX.north),
      "-clipsrc",
      wards,
      destination,
      source,
    ],
    { stdio: ["ignore", "ignore", "pipe"], env: ZIP_ENCODING_ENV },
  );
}

export interface StageFloodResult {
  readonly featuresWritten: number;
  readonly riversContributing: readonly string[];
  readonly riversWithoutTokyoExtent: readonly string[];
  readonly unmappedDepthCodes: readonly string[];
  /** Clips that grazed a ward edge and left no area behind. */
  readonly nonArealClips: number;
}

export function runStageFlood(args: StageFloodArgs): StageFloodResult {
  const entries = listZipEntries(args.zip).filter(
    (e) => e.decoded.includes(MAX_SCALE_DIR) && e.decoded.endsWith(".geojson"),
  );
  if (entries.length === 0) {
    throw new Error(`stage:flood — no "${MAX_SCALE_DIR}" GeoJSON entries found in ${args.zip}`);
  }

  const workDir = mkdtempSync(path.join(tmpdir(), "stage-flood-"));
  const merged: Feature[] = [];
  const contributing: string[] = [];
  const empty: string[] = [];
  const unmapped = new Set<string>();
  let nonArealClips = 0;

  try {
    for (const [index, entry] of entries.entries()) {
      const river = path.basename(entry.decoded, ".geojson");
      const clipped = path.join(workDir, `${String(index)}.geojson`);
      runOgr2ogr(`/vsizip/${args.zip}/${entry.decoded}`, clipped, args.wards);

      const parsed: unknown = JSON.parse(readFileSync(clipped, "utf8"));
      const features = (parsed as { features?: readonly Feature[] }).features ?? [];
      rmSync(clipped, { force: true });

      if (features.length === 0) {
        empty.push(river);
        continue;
      }
      contributing.push(`${river} (${String(features.length)})`);

      for (const feature of features) {
        const depth = floodDepthFromA31201(feature.properties?.["A31_201"]);
        if (depth === null) {
          unmapped.add(`${river}: A31_201=${String(feature.properties?.["A31_201"])}`);
          continue;
        }
        // -clipsrc can return a GeometryCollection where a polygon merely
        // grazes a ward boundary; keep only the areal part.
        const geometry = toArealGeometry(feature.geometry);
        if (geometry === null) {
          nonArealClips += 1;
          continue;
        }
        merged.push({
          type: "Feature",
          properties: { depth_rank: depth.depthRank, depth_category: depth.depthCategory },
          geometry,
        });
      }
    }
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }

  writeFileSync(args.out, JSON.stringify({ type: "FeatureCollection", features: merged }));

  return {
    featuresWritten: merged.length,
    riversContributing: contributing,
    riversWithoutTokyoExtent: empty,
    unmappedDepthCodes: [...unmapped].sort(),
    nonArealClips,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const result = runStageFlood(args);

  console.log(
    `stage:flood — features=${String(result.featuresWritten)} -> ${args.out}\n` +
      `stage:flood — rivers reaching the 23 wards (${String(result.riversContributing.length)}): ` +
      result.riversContributing.join(", "),
  );
  console.log(
    `stage:flood — rivers with no extent inside the 23 wards ` +
      `(${String(result.riversWithoutTokyoExtent.length)}), skipped; ` +
      `zero-area boundary clips dropped: ${String(result.nonArealClips)}`,
  );
  if (result.unmappedDepthCodes.length > 0) {
    console.warn(
      `stage:flood — ${String(result.unmappedDepthCodes.length)} unmapped depth code(s), ` +
        `EXCLUDED:\n  ${result.unmappedDepthCodes.join("\n  ")}`,
    );
  }
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  });
}

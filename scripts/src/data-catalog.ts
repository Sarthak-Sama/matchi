import { createHash } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface CatalogEntry {
  readonly id: string;
  readonly dataset: "N03" | "N02" | "L01" | "A55" | "ESTAT_BOUNDARY";
  readonly release: string;
  readonly url: string;
  readonly archive: string;
  readonly sourceDate: string;
  readonly sha256: string;
}

interface Catalog {
  readonly version: number;
  readonly datasets: readonly CatalogEntry[];
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const DATA_DIR = path.join(root, "data");
export const RAW_MLIT_DIR = path.join(DATA_DIR, "raw", "mlit");
export const RAW_ESTAT_BOUNDARY_DIR = path.join(DATA_DIR, "raw", "estat-boundaries");

export async function loadDataCatalog(): Promise<readonly CatalogEntry[]> {
  const raw = await readFile(path.join(DATA_DIR, "catalog.json"), "utf8");
  const catalog = JSON.parse(raw) as Catalog;
  if (catalog.version !== 1 || !Array.isArray(catalog.datasets)) {
    throw new Error("data/catalog.json: unsupported catalog format");
  }
  const seen = new Set<string>();
  for (const entry of catalog.datasets) {
    if (
      !entry.id ||
      !entry.url.startsWith("https://") ||
      !entry.archive ||
      !entry.sourceDate ||
      !entry.sha256
    ) {
      throw new Error(`data/catalog.json: invalid entry ${entry.id || "(missing id)"}`);
    }
    if (seen.has(entry.id)) throw new Error(`data/catalog.json: duplicate id ${entry.id}`);
    seen.add(entry.id);
  }
  return catalog.datasets;
}

export function isVerifiedChecksum(value: string): boolean {
  return /^[a-f0-9]{64}$/i.test(value);
}

export async function sha256File(file: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(file))
    .digest("hex");
}

async function verifyZip(file: string): Promise<void> {
  const bytes = await readFile(file);
  if (bytes.length < 4 || bytes.readUInt32LE(0) !== 0x04034b50) {
    throw new Error(`${file}: downloaded file is not a ZIP archive`);
  }
}

export async function prepareArchives(entries: readonly CatalogEntry[]): Promise<void> {
  await mkdir(RAW_MLIT_DIR, { recursive: true });
  await mkdir(RAW_ESTAT_BOUNDARY_DIR, { recursive: true });
  for (const entry of entries) {
    if (!isVerifiedChecksum(entry.sha256)) {
      throw new Error(
        `catalog entry ${entry.id} has no verified SHA-256; update data/catalog.json before downloading`,
      );
    }
    const target = path.join(
      entry.dataset === "ESTAT_BOUNDARY" ? RAW_ESTAT_BOUNDARY_DIR : RAW_MLIT_DIR,
      entry.archive,
    );
    try {
      await stat(target);
    } catch {
      const response = await fetch(entry.url);
      if (!response.ok)
        throw new Error(`${entry.id}: download failed (${response.status} ${response.statusText})`);
      const temp = `${target}.partial`;
      await writeFile(temp, Buffer.from(await response.arrayBuffer()));
      await rename(temp, target);
    }
    await verifyZip(target);
    const actual = await sha256File(target);
    if (actual !== entry.sha256.toLowerCase()) {
      throw new Error(
        `${entry.id}: SHA-256 mismatch for ${target}; expected ${entry.sha256}, got ${actual}`,
      );
    }
  }
}

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DATA_DIR } from "./data-catalog.js";

export const RAW_GTFS_DIR = path.join(DATA_DIR, "raw", "gtfs");

const GTFS_FEED_IDS = ["odpt-gtfs-tokyometro", "odpt-gtfs-toei"] as const;

const TOKEN_ENV = "ODPT_ACCESS_TOKEN";

// Feeds are a rolling download with no fixed checksum, so they sit under
// `feeds` in catalog.json, apart from the pinned `datasets` that data:prepare
// verifies.
interface GtfsFeed {
  readonly id: string;
  readonly url: string;
  readonly archive: string;
}

async function loadGtfsFeeds(): Promise<readonly GtfsFeed[]> {
  const raw = await readFile(path.join(DATA_DIR, "catalog.json"), "utf8");
  const catalog = JSON.parse(raw) as { feeds?: readonly GtfsFeed[] };
  return GTFS_FEED_IDS.map((id) => {
    const feed = catalog.feeds?.find((entry) => entry.id === id);
    if (!feed) throw new Error(`data/catalog.json has no "${id}" entry under "feeds".`);
    return feed;
  });
}

function requireToken(): string {
  const token = process.env[TOKEN_ENV];
  if (!token) {
    throw new Error(
      `${TOKEN_ENV} is not set. Register for a free key at https://developer.odpt.org/ and put ` +
        `it in .env as ${TOKEN_ENV}=<key>.`,
    );
  }
  return token;
}

function withConsumerKey(url: string, token: string): string {
  const keyed = new URL(url);
  keyed.searchParams.set("acl:consumerKey", token);
  return keyed.toString();
}

async function downloadFeed(feed: GtfsFeed, token: string): Promise<string> {
  // The keyed URL is never printed or put in an error: it carries the token.
  const response = await fetch(withConsumerKey(feed.url, token));
  if (!response.ok) {
    throw new Error(
      `${feed.id}: download from ${feed.url} failed (${String(response.status)} ${response.statusText}). ` +
        `A 403 usually means ${TOKEN_ENV} is wrong or not yet activated.`,
    );
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 4 || bytes.readUInt32LE(0) !== 0x04034b50) {
    throw new Error(`${feed.id}: ${feed.url} did not return a ZIP archive`);
  }

  const target = path.join(RAW_GTFS_DIR, feed.archive);
  const partial = `${target}.partial`;
  await writeFile(partial, bytes);
  await rename(partial, target);
  return target;
}

export async function fetchGtfs(): Promise<void> {
  const token = requireToken();
  const feeds = await loadGtfsFeeds();
  await mkdir(RAW_GTFS_DIR, { recursive: true });
  for (const feed of feeds) {
    const target = await downloadFeed(feed, token);
    console.log(`fetch:gtfs — ${feed.id} saved to ${path.relative(process.cwd(), target)}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  fetchGtfs().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}

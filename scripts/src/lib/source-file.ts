/**
 * Shared "where does this import's input come from" resolver, used by
 * every import script (`import:mlit` in this task; `import:rent`,
 * `import:osm`, `import:transit` in Tasks 12-14).
 *
 * Precedence:
 *   1. `localPath` (typically a `--file`-style CLI flag) — read directly.
 *   2. A download, when `url` is set AND every required credential
 *      (`requiredEnvVar`, when given) is present in `env` — fetched and
 *      cached under `data/` (gitignored) before being read back.
 *   3. Otherwise: throw, naming both the missing credential and
 *      `manualDownloadUrl` so a human can fetch it by hand and pass the
 *      result back in via `localPath` next time.
 *
 * Tests must never exercise branch 2 — inject `localPath` (or a fixture
 * file) instead of `url`/credentials so no test ever reaches for the
 * network.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export interface ResolveSourceOptions {
  /** Human-readable dataset name, used only in messages (e.g. "wards"). */
  readonly label: string;
  /** A `--file`-style local path. Wins over everything else when set. */
  readonly localPath?: string;
  /** The upstream URL to download from, when no local file is given. */
  readonly url?: string;
  /** Name of an environment variable that must be set to download (e.g. "MLIT_API_KEY"). */
  readonly requiredEnvVar?: string;
  /** Shown in the error when neither a local file nor a download is possible. */
  readonly manualDownloadUrl: string;
  /** Defaults to `process.env`; overridable for tests. */
  readonly env?: NodeJS.ProcessEnv;
  /** Directory downloads are cached under. Defaults to `"data"`. */
  readonly downloadDir?: string;
  /** Filename used inside `downloadDir`. Defaults to `${label}.download`. */
  readonly downloadFilename?: string;
}

/** Resolves an import script's input source and returns its raw text contents. */
export async function resolveSource(options: ResolveSourceOptions): Promise<string> {
  const { label, localPath, url, requiredEnvVar, manualDownloadUrl } = options;

  if (localPath !== undefined) {
    return await readFile(localPath, "utf8");
  }

  const env = options.env ?? process.env;
  const credential = requiredEnvVar !== undefined ? env[requiredEnvVar] : undefined;
  const credentialSatisfied = requiredEnvVar === undefined || Boolean(credential);

  if (url !== undefined && credentialSatisfied) {
    const headers: Record<string, string> = {};
    if (credential !== undefined) {
      headers["Authorization"] = `Bearer ${credential}`;
    }
    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(
        `${label}: download failed (${String(response.status)} ${response.statusText}) from ${url}`,
      );
    }
    const text = await response.text();
    const dir = options.downloadDir ?? "data";
    await mkdir(dir, { recursive: true });
    const dest = path.join(dir, options.downloadFilename ?? `${label}.download`);
    await writeFile(dest, text, "utf8");
    return text;
  }

  const missing: string[] = [];
  if (requiredEnvVar !== undefined && !credential) missing.push(requiredEnvVar);
  if (url === undefined) missing.push("a configured source URL");

  throw new Error(
    `${label}: no local file was given and this run cannot download automatically ` +
      `(missing ${missing.join(" and ")}). Download it manually from ${manualDownloadUrl} ` +
      `and pass the saved file's path instead.`,
  );
}

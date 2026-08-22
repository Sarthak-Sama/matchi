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
 *
 * `encoding` (added for Task 12's e-Stat CSVs, which ship Shift-JIS rather
 * than UTF-8) defaults to `"utf8"`, so every existing caller (`import:mlit`'s
 * GeoJSON, which is always UTF-8) is unaffected. A caller that needs to
 * decode raw bytes itself (e.g. with `iconv-lite`, since Node has no
 * built-in Shift-JIS `TextDecoder`) should pass `encoding: "latin1"`
 * instead of the source's real encoding: Node's `"latin1"` maps each byte
 * 0-255 to one UTF-16 code unit losslessly, so `Buffer.from(text, "latin1")`
 * recovers the exact original bytes for the caller to decode however it
 * needs. Requesting the real target encoding directly (e.g. `"utf8"` when
 * the bytes aren't valid UTF-8) would lose information at this layer,
 * before the caller ever sees it — invalid byte sequences get silently
 * replaced with U+FFFD and can't be recovered afterward.
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
  /**
   * Byte-to-string encoding used to read the local file / decode the
   * download. Defaults to `"utf8"`. Pass `"latin1"` for a source whose real
   * encoding isn't UTF-8 (see this module's doc comment) and decode the
   * bytes back out yourself.
   */
  readonly encoding?: BufferEncoding;
}

/** Resolves an import script's input source and returns its raw text contents. */
export async function resolveSource(options: ResolveSourceOptions): Promise<string> {
  const { label, localPath, url, requiredEnvVar, manualDownloadUrl } = options;
  const encoding = options.encoding ?? "utf8";

  if (localPath !== undefined) {
    return await readFile(localPath, encoding);
  }

  const env = options.env ?? process.env;
  const credential = requiredEnvVar !== undefined ? env[requiredEnvVar] : undefined;
  const credentialSatisfied = requiredEnvVar === undefined || Boolean(credential);

  if (url !== undefined && credentialSatisfied) {
    const headers: Record<string, string> = {};
    if (credential !== undefined) {
      headers["Authorization"] = `Bearer ${credential}`;
    }
    let response: Response;
    try {
      response = await fetch(url, { headers });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`${label}: download failed (${message}) from ${url}`, { cause: err });
    }
    if (!response.ok) {
      throw new Error(
        `${label}: download failed (${String(response.status)} ${response.statusText}) from ${url}`,
      );
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    const text = buffer.toString(encoding);
    const dir = options.downloadDir ?? "data";
    await mkdir(dir, { recursive: true });
    const dest = path.join(dir, options.downloadFilename ?? `${label}.download`);
    await writeFile(dest, text, encoding);
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

/**
 * Resolves `--gtfs <dir-or-zip>` to a plain directory containing GTFS's
 * `.txt` files, so the rest of `import:transit` never has to think about
 * zip archives.
 *
 * A GTFS feed is a *set* of files (`stops.txt`, `routes.txt`, `trips.txt`,
 * `stop_times.txt`, `calendar.txt`, ...), unlike every other import
 * script's single-document input — so `lib/source-file.ts`'s
 * one-string-of-text contract doesn't fit here; this module reads paths,
 * not text, and the caller (`import-transit.ts`) reads each named file
 * itself (`stop_times.txt` via a stream — see `gtfs-stop-times.ts` — the
 * rest via plain `readFile`).
 *
 * DELIBERATE CHOICE — no new zip-reading npm dependency: rather than add
 * `adm-zip`/`yauzl`/etc. (a real dependency needing a registry fetch to
 * install, for a feature this repo's no-network-at-test-time fixture path
 * never exercises), a `.zip` argument is extracted by shelling out to the
 * system `unzip` binary (present at `/usr/bin/unzip` on this machine, and
 * near-universal on Unix dev/CI images) into a fresh temp directory. This
 * is a genuine implementation of the zip path, not a stub — it is simply
 * built on a system tool instead of a package. If `unzip` is missing or
 * fails, the error names the problem and suggests extracting by hand and
 * passing the resulting directory instead.
 */

import { execFile } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface ResolvedGtfsSource {
  /** Directory containing the feed's `.txt` files (extracted, for a zip input). */
  readonly dir: string;
  /** Removes any temp directory this created. A no-op for a directory input. */
  readonly cleanup: () => Promise<void>;
}

const NO_OP_CLEANUP = async (): Promise<void> => {
  // Nothing to clean up — the caller passed a directory directly.
};

/**
 * `gtfsArg` is `--gtfs`'s value: a path to either a directory of GTFS
 * `.txt` files, or a `.zip` archive of the same. Throws a clear error for
 * anything else (missing path, or a file that's neither a directory nor
 * a `.zip`).
 */
export async function resolveGtfsSource(gtfsArg: string): Promise<ResolvedGtfsSource> {
  const info = await stat(gtfsArg).catch(() => undefined);
  if (info === undefined) {
    throw new Error(`import:transit — --gtfs path "${gtfsArg}" does not exist.`);
  }

  if (info.isDirectory()) {
    return { dir: gtfsArg, cleanup: NO_OP_CLEANUP };
  }

  if (info.isFile() && gtfsArg.toLowerCase().endsWith(".zip")) {
    const tempDir = await mkdtemp(path.join(tmpdir(), "tokyo-gtfs-"));
    try {
      await execFileAsync("unzip", ["-o", "-q", gtfsArg, "-d", tempDir]);
    } catch (err) {
      await rm(tempDir, { recursive: true, force: true });
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(
        `import:transit — failed to extract "${gtfsArg}" with the system "unzip" command ` +
          `(${message}). Extract it yourself and pass the resulting directory to --gtfs instead.`,
        { cause: err },
      );
    }
    return {
      dir: tempDir,
      cleanup: () => rm(tempDir, { recursive: true, force: true }),
    };
  }

  throw new Error(
    `import:transit — --gtfs path "${gtfsArg}" is neither a directory nor a .zip file.`,
  );
}

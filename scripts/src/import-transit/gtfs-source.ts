import { execFile } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface ResolvedGtfsSource {
  readonly dir: string;

  readonly cleanup: () => Promise<void>;
}

const NO_OP_CLEANUP = async (): Promise<void> => {};

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

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export interface ResolveSourceOptions {
  readonly label: string;

  readonly localPath?: string;

  readonly url?: string;

  readonly requiredEnvVar?: string;

  readonly manualDownloadUrl: string;

  readonly env?: NodeJS.ProcessEnv;

  readonly downloadDir?: string;

  readonly downloadFilename?: string;

  readonly encoding?: BufferEncoding;
}

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

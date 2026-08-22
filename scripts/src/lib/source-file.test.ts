/**
 * Pure/offline tests for `resolveSource`. Every case here either reads a
 * local file or hits the "cannot resolve" error path — none of them set
 * both `url` and a satisfied credential, so `fetch` is never invoked.
 */

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveSource } from "./source-file.js";

describe("resolveSource", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "resolve-source-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("reads localPath directly when given, ignoring url/credentials entirely", async () => {
    const file = path.join(dir, "input.txt");
    await writeFile(file, "hello world", "utf8");

    const text = await resolveSource({
      label: "widgets",
      localPath: file,
      manualDownloadUrl: "https://example.invalid/widgets",
    });

    expect(text).toBe("hello world");
  });

  it("throws naming the missing credential and the manual-download URL when neither a file nor a download is possible", async () => {
    await expect(
      resolveSource({
        label: "wards",
        requiredEnvVar: "MLIT_API_KEY",
        manualDownloadUrl: "https://nlftp.mlit.go.jp/ksj/",
        env: {},
      }),
    ).rejects.toThrowError(/MLIT_API_KEY.*https:\/\/nlftp\.mlit\.go\.jp\/ksj\//s);
  });

  it("still names the missing credential even when a URL is configured", async () => {
    await expect(
      resolveSource({
        label: "wards",
        url: "https://example.invalid/wards.geojson",
        requiredEnvVar: "MLIT_API_KEY",
        manualDownloadUrl: "https://nlftp.mlit.go.jp/ksj/",
        env: {},
      }),
    ).rejects.toThrowError(/MLIT_API_KEY/);
  });

  it("never attempts a network fetch when localPath is provided even if url is also set", async () => {
    const file = path.join(dir, "input.txt");
    await writeFile(file, "local wins", "utf8");

    const text = await resolveSource({
      label: "widgets",
      localPath: file,
      url: "https://example.invalid/should-not-be-fetched",
      manualDownloadUrl: "https://example.invalid/manual",
    });

    expect(text).toBe("local wins");
  });
});

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { runDataPrepare } from "./data-prepare.js";
import { loadDataCatalog } from "./data-catalog.js";
import { runDataValidation } from "./data-validate.js";
import { createPool } from "./lib/db.js";
import { runDerive } from "./derive.js";

export type RefreshSource = "all" | "mlit" | "rent" | "osm" | "localities";

export function parseRefreshSource(argv: readonly string[]): RefreshSource {
  const index = argv.indexOf("--source");
  const raw = index === -1 ? "all" : argv[index + 1];
  if (raw !== "all" && raw !== "mlit" && raw !== "rent" && raw !== "osm" && raw !== "localities") {
    throw new Error("data:refresh --source must be all, mlit, rent, osm, or localities");
  }
  return raw;
}

function runPnpm(script: string, args: readonly string[] = []): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("pnpm", [script, ...args], { stdio: "inherit", cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."), env: process.env });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`${script} exited ${String(code)}`)));
  });
}

export async function runDataRefresh(source: RefreshSource): Promise<void> {
  if (!process.env["DATABASE_URL"]) throw new Error("DATABASE_URL is required for data:refresh");
  if (source === "all" || source === "mlit") {
    await runDataPrepare();
    const catalog = await loadDataCatalog();
    const sourceDate = (id: string) => {
      const value = catalog.find((entry) => entry.id === id)?.sourceDate;
      if (!value) throw new Error(`data catalog is missing ${id}`);
      return value;
    };
    await runPnpm("import:mlit", [
      "--n03-source-date", sourceDate("n03"), "--n02-source-date", sourceDate("n02"),
      "--l01-source-date", sourceDate("l01"), "--a55-source-date", sourceDate("a55-13101"),
    ]);
    await runPnpm("import:transit", ["--from-topology", "--source-date", sourceDate("n02")]);
  }
  if (source === "all" || source === "rent") await runPnpm("import:rent");
  if (source === "all" || source === "osm") await runPnpm("import:osm", ["--download"]);
  if (source === "all" || source === "localities") await runPnpm("import:localities");
  const pool = createPool();
  try { await runDerive(pool); } finally { await pool.end(); }
  await runDataValidation();
  console.log("data:refresh complete — restart the API now; transit graph data is cached at startup.");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runDataRefresh(parseRefreshSource(process.argv.slice(2))).catch((error: unknown) => { console.error(error); process.exit(1); });
}

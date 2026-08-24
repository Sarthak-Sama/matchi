/**
 * Tests for `pnpm import:rent`.
 *
 * The pure-function tests below (Shift-JIS/BOM decoding, CSV parsing, ward
 * matching, range validation) never touch a database or the network —
 * every input comes from the small committed fixtures under
 * `fixtures/rent/` or from hand-built in-memory rows.
 *
 * The DB-guarded section at the bottom requires a real PostGIS database
 * reachable via `DATABASE_URL` — it skips with an explicit message when
 * unset, so a missing env var never reads as a silent pass. Run with:
 *
 *   DATABASE_URL=postgresql://tokyo:tokyo@localhost:5432/tokyo_test pnpm test
 */

import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { decodeEstatCsv, mapEstatRows, parseEstatCsv } from "./import-rent/estat.js";
import { mapReinsRows, parseReinsCsv } from "./import-rent/reins.js";
import { convertToPerSqm } from "./import-rent/rent-unit.js";
import { matchWard, normalizeWardName } from "./import-rent/ward-match.js";
import type { ImportRentArgs, RentImportResult } from "./import-rent.js";
import { parseArgs, runRentImport } from "./import-rent.js";
import { runImport } from "./lib/import-run.js";
import { runMigrations } from "./migrate.js";
import { runSeed } from "./seed.js";
import { destructiveTestDatabaseUrl } from "./test-support/database-url.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, "fixtures/rent");

function fixtureBuffer(name: string): Buffer {
  return readFileSync(path.join(FIXTURES_DIR, name));
}

function fixturePath(name: string): string {
  return path.join(FIXTURES_DIR, name);
}

// The 4 wards seeded by scripts/src/fixtures/seed/wards.ts — the only
// wards this repo's vertical-slice test database knows about.
const SEED_WARDS = [
  { wardCode: "13113", nameJa: "渋谷区" },
  { wardCode: "13104", nameJa: "新宿区" },
  { wardCode: "13112", nameJa: "世田谷区" },
  { wardCode: "13110", nameJa: "目黒区" },
];

// ---------------------------------------------------------------------------
// Pure parsing / decoding / matching — no DB.
// ---------------------------------------------------------------------------

describe("e-Stat: Shift-JIS decoding", () => {
  it("decodes the committed Shift-JIS fixture into the correct Japanese ward names", () => {
    const text = decodeEstatCsv(fixtureBuffer("estat.csv"));
    expect(text).toContain("渋谷区");
    expect(text).toContain("新宿区");
    expect(text).toContain("目黒区");
    expect(text).toContain("世田谷区");
    expect(text).toContain("地域コード");
  });

  it("also accepts a UTF-8 byte-order-marked file without mangling it", () => {
    const utf8WithBom = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from("地域コード,地域\n13113,渋谷区\n", "utf8"),
    ]);
    const text = decodeEstatCsv(utf8WithBom);
    expect(text.startsWith("地域コード")).toBe(true);
    expect(text).toContain("渋谷区");
  });
});

describe("e-Stat: row parsing + mapping", () => {
  it("maps the committed fixture's rows to the expected rent_stats shapes with correct numbers", () => {
    const text = decodeEstatCsv(fixtureBuffer("estat.csv"));
    const rawRows = parseEstatCsv(text);
    expect(rawRows).toHaveLength(4);

    const rows = mapEstatRows(rawRows, SEED_WARDS);
    expect(rows).toHaveLength(4);

    const shibuya = rows.find((r) => r.wardCode === "13113");
    expect(shibuya).toEqual({
      wardCode: "13113",
      period: "2023",
      source: "estat",
      rentPerSqmYen: 4300,
      managementFeeYen: 8100,
      sampleCount: 410,
    });

    const setagaya = rows.find((r) => r.wardCode === "13112");
    expect(setagaya).toMatchObject({
      period: "2023",
      source: "estat",
      rentPerSqmYen: 2700,
      managementFeeYen: 5100,
      sampleCount: 510,
    });
  });

  it("an out-of-range rent value aborts with a clear message naming the value", () => {
    const csv = "地域コード,地域,家賃(1㎡当たり),共益費・サービス費\n13113,渋谷区,999,8000\n";
    const rawRows = parseEstatCsv(csv);
    expect(() => mapEstatRows(rawRows, SEED_WARDS)).toThrowError(
      /rent_per_sqm_yen 999 is outside the sane range \[1000, 20000\]/,
    );
  });

  it("an out-of-range management fee also aborts with a clear message", () => {
    const csv = "地域コード,地域,家賃(1㎡当たり),共益費・サービス費\n13113,渋谷区,4000,99999\n";
    const rawRows = parseEstatCsv(csv);
    expect(() => mapEstatRows(rawRows, SEED_WARDS)).toThrowError(
      /management_fee_yen 99999 is outside the sane range \[0, 50000\]/,
    );
  });

  it("an unmatched ward name aborts and names the unmatched value", () => {
    const csv = "地域コード,地域,家賃(1㎡当たり),共益費・サービス費\n,湾岸区,4000,8000\n";
    const rawRows = parseEstatCsv(csv);
    expect(() => mapEstatRows(rawRows, SEED_WARDS)).toThrowError(/no known ward matches "湾岸区"/);
  });

  it("a missing required column produces a clear validation error", () => {
    expect(() => parseEstatCsv("地域コード,地域\n13113,渋谷区\n")).toThrowError(
      /missing required column\(s\)/,
    );
  });
});

describe("ward-match: normalizeWardName + matchWard", () => {
  it("normalizes full-width/half-width forms and whitespace so they compare equal", () => {
    expect(normalizeWardName("渋谷区")).toBe(normalizeWardName(" 渋谷区 "));
    expect(normalizeWardName("渋谷区")).toBe(normalizeWardName("渋谷区　"));
  });

  it("matches by 5-digit code first, then falls back to normalized name", () => {
    expect(matchWard("13113", undefined, SEED_WARDS, "ctx")).toBe("13113");
    expect(matchWard(undefined, "渋谷区", SEED_WARDS, "ctx")).toBe("13113");
    expect(matchWard(undefined, " 渋谷区　", SEED_WARDS, "ctx")).toBe("13113");
  });

  it("throws naming the unmatched value when neither code nor name resolves", () => {
    expect(() => matchWard("99999", "存在しない区", SEED_WARDS, "ctx")).toThrowError(
      /no known ward matches "99999"/,
    );
    expect(() => matchWard(undefined, "存在しない区", SEED_WARDS, "ctx")).toThrowError(
      /no known ward matches "存在しない区"/,
    );
  });
});

describe("REINS: row parsing + mapping", () => {
  it("parses the committed REINS fixture into period '2026Q2' and source 'reins'", () => {
    const text = fixtureBuffer("reins.csv").toString("utf8");
    const rawRows = parseReinsCsv(text);
    expect(rawRows).toHaveLength(2);

    const rows = mapReinsRows(rawRows, SEED_WARDS);
    const shibuya = rows.find((r) => r.wardCode === "13113");
    expect(shibuya).toEqual({
      wardCode: "13113",
      period: "2026Q2",
      source: "reins",
      rentPerSqmYen: 4500,
      managementFeeYen: 8600,
      sampleCount: 100,
    });

    for (const row of rows) {
      expect(row.source).toBe("reins");
      expect(row.period).toBe("2026Q2");
    }
  });

  it("combines separate year/quarter columns into the YYYYQn shape", () => {
    const csv = "地域コード,地域,year,quarter,rent_per_sqm_yen\n13113,渋谷区,2026,2,4500\n";
    const rows = mapReinsRows(parseReinsCsv(csv), SEED_WARDS);
    expect(rows[0]).toMatchObject({ period: "2026Q2", source: "reins" });
  });

  it("rejects a period not in the YYYYQn shape", () => {
    const csv = "地域コード,地域,period,rent_per_sqm_yen\n13113,渋谷区,2026-Q2,4500\n";
    expect(() => parseReinsCsv(csv)).toThrowError(/is not in the expected "YYYYQn" shape/);
  });
});

describe("rent-unit: convertToPerSqm + --rent-unit", () => {
  it("'sqm' is the identity conversion (hand-computed: unchanged)", () => {
    expect(convertToPerSqm(4300, "sqm")).toBe(4300);
    expect(convertToPerSqm(1, "sqm")).toBe(1);
  });

  it("'tsubo' divides by TSUBO_TO_SQM (hand-computed literal: 3305.8 yen/tsubo -> 1000 yen/m²)", () => {
    // 3305.8 = 1000 * 3.3058 (TSUBO_TO_SQM), chosen so the division comes
    // out to a clean integer and the test doesn't need a tolerance.
    expect(convertToPerSqm(3305.8, "tsubo")).toBe(1000);
  });

  it("a per-tsubo reading of a fixture row converts into a different, still-sane per-m² value " +
    "(demonstrating the exact silent-failure mode the range check alone cannot catch)", () => {
    const text = decodeEstatCsv(fixtureBuffer("estat.csv"));
    const shibuyaRaw = parseEstatCsv(text).find((r) => r.wardCode === "13113");
    if (!shibuyaRaw) throw new Error("fixture is missing ward 13113");

    const asSqm = mapEstatRows([shibuyaRaw], SEED_WARDS, "sqm")[0];
    const asTsubo = mapEstatRows([shibuyaRaw], SEED_WARDS, "tsubo")[0];

    // Raw fixture value is 4300 (already a plausible per-m² figure). Read
    // as "sqm" it passes through unchanged; read as "tsubo" it converts
    // down to a DIFFERENT plausible-looking per-m² value instead of
    // silently equalling itself — this is exactly why the range check
    // alone can't catch a per-tsubo/per-m² mixup: both readings land
    // inside [1000, 20000].
    expect(asSqm?.rentPerSqmYen).toBe(4300);
    expect(asTsubo?.rentPerSqmYen).toBe(Math.round(4300 / 3.3058));
    expect(asTsubo?.rentPerSqmYen).not.toBe(asSqm?.rentPerSqmYen);
  });

  it("mapEstatRows/mapReinsRows default to 'sqm' (unchanged behavior) when rentUnit is omitted", () => {
    const text = decodeEstatCsv(fixtureBuffer("estat.csv"));
    const withDefault = mapEstatRows(parseEstatCsv(text), SEED_WARDS);
    const withExplicitSqm = mapEstatRows(parseEstatCsv(text), SEED_WARDS, "sqm");
    expect(withDefault).toEqual(withExplicitSqm);
  });

  it("parseArgs defaults --rent-unit to undefined (runRentImport then applies 'sqm')", () => {
    const args = parseArgs(["--file", "estat.csv"]);
    expect(args.rentUnit).toBeUndefined();
  });

  it("parseArgs accepts --rent-unit sqm|tsubo and rejects anything else", () => {
    expect(parseArgs(["--file", "x.csv", "--rent-unit", "tsubo"]).rentUnit).toBe("tsubo");
    expect(parseArgs(["--file", "x.csv", "--rent-unit", "sqm"]).rentUnit).toBe("sqm");
    expect(() => parseArgs(["--file", "x.csv", "--rent-unit", "acres"])).toThrowError(
      /--rent-unit "acres" must be "sqm" or "tsubo"/,
    );
  });
});

// ---------------------------------------------------------------------------
// DB-guarded integration tests.
// ---------------------------------------------------------------------------

const databaseUrl = destructiveTestDatabaseUrl();

const GOOD_ARGS: ImportRentArgs = {
  estatPath: fixturePath("estat.csv"),
  reinsPath: fixturePath("reins.csv"),
};

async function rentStatsSnapshot(
  pool: Pool,
): Promise<{ ward_code: string; period: string; source: string; rent_per_sqm_yen: number }[]> {
  const { rows } = await pool.query<{
    ward_code: string;
    period: string;
    source: string;
    rent_per_sqm_yen: number;
  }>(
    `SELECT ward_code, period, source, rent_per_sqm_yen FROM rent_stats
     WHERE source IN ('estat', 'reins') ORDER BY ward_code, period, source`,
  );
  return rows;
}

describe.runIf(Boolean(databaseUrl))("import:rent (DB integration)", () => {
  let pool: Pool;

  beforeAll(async () => {
    if (!databaseUrl) return;
    await runMigrations({ dryRun: false });
    await runSeed();
    pool = new Pool({ connectionString: databaseUrl });
    // Clean slate for this script's own bookkeeping rows, independent of
    // anything else that has run against this shared database.
    await pool.query(`DELETE FROM import_runs WHERE source = 'rent'`);
  });

  afterAll(async () => {
    if (!databaseUrl) return;
    // Restore the pristine seed baseline for rent_stats (this suite
    // overwrites the estat rows and adds/overwrites reins rows with its
    // own fixture numbers), so this file doesn't leave the shared database
    // in a mixed state for whatever runs next.
    await runSeed();
    await pool.end();
  });

  it("a full run writes the estat + reins rows and records one success import_runs row", async () => {
    const result = (await runImport(
      { source: "rent", pool },
      (client) => runRentImport(client, GOOD_ARGS),
    )) as RentImportResult;

    expect(result.estatRowsImported).toBe(4);
    expect(result.reinsRowsImported).toBe(2);
    expect(result.rowsImported).toBe(6);

    const { rows: runRows } = await pool.query<{ status: string; rows_imported: number | null }>(
      `SELECT status, rows_imported FROM import_runs WHERE source = 'rent'`,
    );
    expect(runRows).toHaveLength(1);
    expect(runRows[0]).toMatchObject({ status: "success", rows_imported: 6 });

    const snapshot = await rentStatsSnapshot(pool);
    expect(snapshot).toEqual([
      { ward_code: "13104", period: "2023", source: "estat", rent_per_sqm_yen: 3700 },
      { ward_code: "13104", period: "2026Q2", source: "reins", rent_per_sqm_yen: 3900 },
      { ward_code: "13110", period: "2023", source: "estat", rent_per_sqm_yen: 3400 },
      { ward_code: "13112", period: "2023", source: "estat", rent_per_sqm_yen: 2700 },
      { ward_code: "13113", period: "2023", source: "estat", rent_per_sqm_yen: 4300 },
      { ward_code: "13113", period: "2026Q2", source: "reins", rent_per_sqm_yen: 4500 },
    ]);
  });

  it("re-running with the same fixtures is idempotent: identical rows, one more success run record", async () => {
    const before = await rentStatsSnapshot(pool);

    const result = (await runImport(
      { source: "rent", pool },
      (client) => runRentImport(client, GOOD_ARGS),
    )) as RentImportResult;

    expect(result.rowsImported).toBe(6);

    const after = await rentStatsSnapshot(pool);
    expect(after).toEqual(before);

    const { rows: runRows } = await pool.query<{ status: string }>(
      `SELECT status FROM import_runs WHERE source = 'rent' ORDER BY started_at`,
    );
    expect(runRows).toHaveLength(2);
    expect(runRows.every((r) => r.status === "success")).toBe(true);
  });

  it("a deliberately bad fixture (out-of-range rent) writes one failed import_runs row and leaves rent_stats unchanged", async () => {
    const before = await rentStatsSnapshot(pool);

    const badFile = await mkdtemp(path.join(os.tmpdir(), "import-rent-bad-"));
    const badPath = path.join(badFile, "estat-bad.csv");
    // Plain-ASCII, friendly-alias headers — Shift-JIS and UTF-8 agree on
    // every byte below 0x80, so decodeEstatCsv's Shift-JIS path reads this
    // correctly without needing a real Shift-JIS-encoded fixture here.
    await writeFile(badPath, "ward_code,ward_name,rent_per_sqm_yen\n13113,Shibuya,999\n", "utf8");

    await expect(
      runImport({ source: "rent", pool }, (client) => runRentImport(client, { estatPath: badPath })),
    ).rejects.toThrowError(/rent_per_sqm_yen 999 is outside the sane range \[1000, 20000\]/);

    await rm(badFile, { recursive: true, force: true });

    const after = await rentStatsSnapshot(pool);
    expect(after).toEqual(before);

    const { rows: runRows } = await pool.query<{ status: string; error: string | null }>(
      `SELECT status, error FROM import_runs WHERE source = 'rent' ORDER BY started_at`,
    );
    expect(runRows).toHaveLength(3);
    expect(runRows[2]?.status).toBe("failed");
    expect(runRows[2]?.error).toMatch(/rent_per_sqm_yen 999 is outside the sane range/);
  });
});

describe("import:rent", () => {
  // Sentinel test: passes (with an explicit explanatory title) only when
  // DATABASE_URL is unset, so `pnpm test` output always makes clear *why*
  // the real integration tests above were skipped rather than silently
  // omitted. When DATABASE_URL is set, this sentinel itself is skipped.
  it.skipIf(Boolean(databaseUrl))(
    "SKIPPED integration tests above: DATABASE_URL is not set — set it to a PostGIS connection string to run them, e.g. DATABASE_URL=postgresql://tokyo:tokyo@localhost:5432/tokyo_test pnpm test",
    () => {
      console.warn(
        "import-rent.test.ts: DATABASE_URL is not set; skipping PostGIS integration tests. " +
          "Run with DATABASE_URL=postgresql://tokyo:tokyo@localhost:5432/tokyo_test pnpm test",
      );
    },
  );
});

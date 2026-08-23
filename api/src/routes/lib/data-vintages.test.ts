/**
 * `loadLatestImportRuns` / `loadLatestSuccessfulImportRuns` tests.
 *
 * Requires a real database reachable via `DATABASE_URL` — skips with an
 * explicit message when unset, mirroring `scripts/src/derive.test.ts`'s
 * pattern. Only `import_runs` is touched directly (no migrate/seed/derive
 * needed): a fresh `import_runs` row set is inserted per test run so this
 * suite doesn't depend on — or interfere with — any other suite's data.
 *
 * This test exists because a real (non-seed) failure mode only shows up
 * once a `failed` import run is newer than the last `success`ful one for
 * the same source: `runImport` records the failed row's `finished_at`
 * AFTER rolling its own writes back, so naively picking "the latest row
 * per source" (no status filter) reports a failed run's timestamps as if
 * they described the data currently on disk. `loadLatestSuccessfulImportRuns`
 * (used by `POST /v1/optimize`'s `dataVintages`) must not do that;
 * `loadLatestImportRuns` (used by `GET /v1/data-status`) deliberately still
 * does, since that route exists to surface the latest outcome regardless of
 * status.
 */

import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadLatestImportRuns, loadLatestSuccessfulImportRuns } from "./data-vintages.js";

const databaseUrl = process.env["DATABASE_URL"];

const TEST_SOURCE = "test-data-vintages-source";

describe.runIf(Boolean(databaseUrl))("loadLatestImportRuns / loadLatestSuccessfulImportRuns", () => {
  let pool: Pool;

  beforeAll(() => {
    if (!databaseUrl) return;
    pool = new Pool({ connectionString: databaseUrl });
  });

  afterAll(async () => {
    if (!databaseUrl) return;
    await pool.query("DELETE FROM import_runs WHERE source = $1", [TEST_SOURCE]);
    await pool.end();
  });

  it("a failed run newer than a successful one: loadLatestSuccessfulImportRuns still reports the successful run's timestamps; loadLatestImportRuns reports the failed one", async () => {
    await pool.query("DELETE FROM import_runs WHERE source = $1", [TEST_SOURCE]);

    // Older, successful run — this is what's actually reflected on disk.
    const successSourceUpdatedAt = new Date("2026-01-01T00:00:00Z");
    await pool.query(
      `INSERT INTO import_runs (source, status, source_updated_at, started_at, finished_at, rows_imported)
       VALUES ($1, 'success', $2, $3, $4, 100)`,
      [
        TEST_SOURCE,
        successSourceUpdatedAt,
        new Date("2026-08-01T00:00:00Z"),
        new Date("2026-08-01T00:05:00Z"),
      ],
    );

    // Newer run that FAILED — its own finished_at is set (runImport records
    // this after rolling its writes back) but the underlying data was never
    // updated.
    await pool.query(
      `INSERT INTO import_runs (source, status, source_updated_at, started_at, finished_at, error)
       VALUES ($1, 'failed', $2, $3, $4, $5)`,
      [
        TEST_SOURCE,
        new Date("2026-08-22T00:00:00Z"),
        new Date("2026-08-22T00:10:00Z"),
        new Date("2026-08-22T00:11:00Z"),
        "simulated failure for data-vintages.test.ts",
      ],
    );

    const successfulRuns = await loadLatestSuccessfulImportRuns(pool);
    const successfulRun = successfulRuns.find((r) => r.source === TEST_SOURCE);
    expect(successfulRun, "successful-only projection should include this source").toBeDefined();
    expect(successfulRun?.status).toBe("success");
    expect(successfulRun?.sourceUpdatedAt).toBe(successSourceUpdatedAt.toISOString());
    expect(successfulRun?.importedAt).toBe(new Date("2026-08-01T00:05:00Z").toISOString());

    const allRuns = await loadLatestImportRuns(pool);
    const latestRun = allRuns.find((r) => r.source === TEST_SOURCE);
    expect(latestRun, "unfiltered projection should include this source").toBeDefined();
    expect(latestRun?.status).toBe("failed");
    expect(latestRun?.importedAt).toBe(new Date("2026-08-22T00:11:00Z").toISOString());
  });
});

describe("loadLatestImportRuns / loadLatestSuccessfulImportRuns", () => {
  it.skipIf(Boolean(databaseUrl))(
    "SKIPPED integration test above: DATABASE_URL is not set — set it to a PostgreSQL connection string to run it, e.g. DATABASE_URL=postgresql://tokyo:tokyo@localhost:5432/tokyo_test pnpm test",
    () => {
      console.warn(
        "data-vintages.test.ts: DATABASE_URL is not set; skipping the DB integration test. " +
          "Run with DATABASE_URL=postgresql://tokyo:tokyo@localhost:5432/tokyo_test pnpm test",
      );
    },
  );
});

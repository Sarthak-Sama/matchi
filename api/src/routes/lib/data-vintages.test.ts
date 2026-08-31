import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadLatestImportRuns, loadLatestSuccessfulImportRuns } from "./data-vintages.js";

const databaseUrl = process.env["DATABASE_URL"];

const TEST_SOURCE = "test-data-vintages-source";

describe.runIf(Boolean(databaseUrl))(
  "loadLatestImportRuns / loadLatestSuccessfulImportRuns",
  () => {
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
  },
);

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

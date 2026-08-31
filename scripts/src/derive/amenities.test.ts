import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { lateNightConditionSql } from "./amenities.js";
import { destructiveTestDatabaseUrl } from "../test-support/database-url.js";

const databaseUrl = destructiveTestDatabaseUrl();

const CASES: readonly { readonly openingHours: string | null; readonly expected: boolean }[] = [
  { openingHours: "24/7", expected: true },
  { openingHours: "11:00-23:30", expected: true },
  { openingHours: "11:00-23:45", expected: true },
  {
    openingHours: "Mo-Fr 09:00-18:00; Sa-Su 10:00-23:30",
    expected: true,
  },
  { openingHours: "09:00-18:00", expected: false },
  { openingHours: "Mo-Su 18:00-02:00", expected: false },
  {
    openingHours: "Mo-Su 09:00-22:00; Tu 22:00-23:30 off",
    expected: false,
  },
  {
    openingHours: "Standoff Bar 11:00-23:30",
    expected: true,
  },
  { openingHours: null, expected: false },
];

describe.runIf(Boolean(databaseUrl))("lateNightConditionSql", () => {
  let pool: Pool;

  beforeAll(() => {
    if (!databaseUrl) return;
    pool = new Pool({ connectionString: databaseUrl });
  });

  afterAll(async () => {
    if (!databaseUrl) return;
    await pool.end();
  });

  it.each(CASES)("$openingHours -> $expected", async ({ openingHours, expected }) => {
    const { rows } = await pool.query<{ matched: boolean }>(
      `SELECT ${lateNightConditionSql("t.opening_hours")} AS matched FROM (VALUES ($1::text)) t(opening_hours)`,
      [openingHours],
    );
    expect(rows[0]?.matched ?? false).toBe(expected);
  });
});

describe("lateNightConditionSql", () => {
  it.skipIf(Boolean(databaseUrl))(
    "SKIPPED integration tests above: DATABASE_URL is not set — set it to a PostgreSQL connection string to run them, e.g. DATABASE_URL=postgresql://tokyo:tokyo@localhost:5432/tokyo_test pnpm test",
    () => {
      console.warn(
        "derive/amenities.test.ts: DATABASE_URL is not set; skipping integration tests. " +
          "Run with DATABASE_URL=postgresql://tokyo:tokyo@localhost:5432/tokyo_test pnpm test",
      );
    },
  );
});

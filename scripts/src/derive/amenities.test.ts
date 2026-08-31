/**
 * Direct unit coverage of `lateNightConditionSql`'s conservative
 * `opening_hours` heuristic (see amenities.ts's module doc comment) against
 * a table of sample strings — including OSM's `off` rule modifier, which a
 * bare `-HH:MM` substring match would wrongly count as late-night.
 *
 * This runs the exact SQL fragment `runAmenitiesStep` embeds into its real
 * query (via a `VALUES` table, no `pois`/`station_groups` schema needed),
 * so it can't drift from production behavior the way a re-typed regex
 * would. Requires a real PostGIS/Postgres database reachable via
 * `DATABASE_URL` — skips with an explicit message when unset, mirroring
 * every other integration test in this package.
 */

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
    expected: true, // any segment closing late is enough
  },
  { openingHours: "09:00-18:00", expected: false },
  { openingHours: "Mo-Su 18:00-02:00", expected: false }, // cross-midnight false negative, by design
  {
    // The false positive this task fixed: `off` marks the 22:00-23:30
    // segment CLOSED, so this venue never opens past 22:00 — but its
    // "-23:30" substring would otherwise match.
    openingHours: "Mo-Su 09:00-22:00; Tu 22:00-23:30 off",
    expected: false,
  },
  {
    // `off` appearing inside an unrelated word must NOT trigger the
    // exclusion — the word-boundary regex should still count this one.
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

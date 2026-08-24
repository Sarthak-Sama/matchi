/**
 * Tests for the guard that stands between `pnpm test` and a working
 * database. These are pure — they never open a connection.
 */

import { describe, expect, it } from "vitest";

import { databaseNameFrom, destructiveTestDatabaseUrl } from "./database-url.js";

const TEST_DB = "postgresql://tokyo:tokyo@localhost:5432/tokyo_test";
const DEV_DB = "postgresql://tokyo:tokyo@localhost:5432/tokyo";

describe("databaseNameFrom", () => {
  it("extracts the database name from a postgres URL", () => {
    expect(databaseNameFrom(TEST_DB)).toBe("tokyo_test");
    expect(databaseNameFrom(DEV_DB)).toBe("tokyo");
  });

  it("returns null when there is no database path or the URL is unparseable", () => {
    expect(databaseNameFrom("postgresql://tokyo:tokyo@localhost:5432/")).toBeNull();
    expect(databaseNameFrom("not a url")).toBeNull();
  });
});

describe("destructiveTestDatabaseUrl", () => {
  it("returns undefined when DATABASE_URL is unset or empty, so suites still skip", () => {
    expect(destructiveTestDatabaseUrl({})).toBeUndefined();
    expect(destructiveTestDatabaseUrl({ DATABASE_URL: "" })).toBeUndefined();
  });

  it("allows a database whose name ends in _test", () => {
    expect(destructiveTestDatabaseUrl({ DATABASE_URL: TEST_DB })).toBe(TEST_DB);
  });

  it("refuses the development database rather than letting it be truncated", () => {
    expect(() => destructiveTestDatabaseUrl({ DATABASE_URL: DEV_DB })).toThrowError(
      /Refusing to run destructive integration tests against database "tokyo"/,
    );
  });

  it("names the offending database and the fix in the error", () => {
    expect(() => destructiveTestDatabaseUrl({ DATABASE_URL: DEV_DB })).toThrowError(
      /ALLOW_DESTRUCTIVE_TESTS=1/,
    );
  });

  it("refuses an unparseable DATABASE_URL rather than guessing", () => {
    expect(() => destructiveTestDatabaseUrl({ DATABASE_URL: "not a url" })).toThrowError(
      /an unparseable DATABASE_URL/,
    );
  });

  it("honours the explicit ALLOW_DESTRUCTIVE_TESTS=1 escape hatch", () => {
    expect(
      destructiveTestDatabaseUrl({ DATABASE_URL: DEV_DB, ALLOW_DESTRUCTIVE_TESTS: "1" }),
    ).toBe(DEV_DB);
  });

  it("does not treat any other ALLOW_DESTRUCTIVE_TESTS value as consent", () => {
    for (const value of ["0", "true", "yes", ""]) {
      expect(() =>
        destructiveTestDatabaseUrl({ DATABASE_URL: DEV_DB, ALLOW_DESTRUCTIVE_TESTS: value }),
      ).toThrowError(/Refusing to run destructive integration tests/);
    }
  });

  it("is not fooled by a name that merely contains _test", () => {
    const url = "postgresql://tokyo:tokyo@localhost:5432/tokyo_test_backup";
    expect(() => destructiveTestDatabaseUrl({ DATABASE_URL: url })).toThrowError(
      /database "tokyo_test_backup"/,
    );
  });
});

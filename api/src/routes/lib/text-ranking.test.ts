/**
 * `lib/text-ranking.ts` builds SQL fragments, so these tests assert on the
 * generated SQL rather than on query results — the fragments' behaviour
 * against a real database is covered where they are used
 * (`stations.test.ts`, `places.test.ts`, both with DB integration suites).
 * What matters here is the structure `/v1/stations` and `/v1/places` both
 * depend on: every column contributes a term, array columns go through
 * `unnest`, and the user's input only ever appears as a bound placeholder.
 */

import { describe, expect, it } from "vitest";

import {
  similarityScoreSql,
  STATION_GROUP_MATCH_COLUMNS,
  textMatchSql,
} from "./text-ranking.js";

describe("similarityScoreSql", () => {
  it("scores every text column against the bound query parameter", () => {
    const sql = similarityScoreSql({ text: ["p.name"] }, "$1");
    expect(sql).toBe("COALESCE(GREATEST(similarity(lower(p.name), lower($1))), 0)");
  });

  it("scores an array column through unnest, defaulting an all-null array to 0", () => {
    const sql = similarityScoreSql(STATION_GROUP_MATCH_COLUMNS, "$1");
    expect(sql).toContain("similarity(lower(sg.name_en), lower($1))");
    expect(sql).toContain("similarity(lower(sg.name_ja), lower($1))");
    expect(sql).toContain("FROM unnest(sg.aliases) AS alias_0");
    // A NULL-named row must not sort unpredictably — GREATEST of all-NULLs
    // is NULL, so the whole expression is coalesced to 0.
    expect(sql.startsWith("COALESCE(GREATEST(")).toBe(true);
    expect(sql.endsWith("), 0)")).toBe(true);
  });

  it("gives two array columns distinct unnest aliases so they cannot shadow each other", () => {
    const sql = similarityScoreSql({ text: [], arrays: ["t.a", "t.b"] }, "$1");
    expect(sql).toContain("FROM unnest(t.a) AS alias_0");
    expect(sql).toContain("FROM unnest(t.b) AS alias_1");
  });

  it("honours a placeholder other than $1", () => {
    expect(similarityScoreSql({ text: ["p.name"] }, "$3")).toContain("lower($3)");
  });
});

describe("textMatchSql", () => {
  it("ORs a case-insensitive contains predicate over every text column", () => {
    const sql = textMatchSql({ text: ["sg.name_en", "sg.name_ja"] }, "$1");
    expect(sql).toContain("sg.name_en ILIKE '%' || $1 || '%'");
    expect(sql).toContain("sg.name_ja ILIKE '%' || $1 || '%'");
    expect(sql).toContain("OR");
  });

  it("matches an array column element-wise via EXISTS + unnest", () => {
    const sql = textMatchSql(STATION_GROUP_MATCH_COLUMNS, "$1");
    expect(sql).toContain("EXISTS (SELECT 1 FROM unnest(sg.aliases) AS alias_0");
    expect(sql).toContain("alias_0 ILIKE '%' || $1 || '%'");
  });
});

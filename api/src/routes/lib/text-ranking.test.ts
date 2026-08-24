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
  escapeLikeWildcards,
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

  it("is total: no columns yields the constant 0, never the syntax error `GREATEST()`", () => {
    expect(similarityScoreSql({ text: [] }, "$1")).toBe("0");
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

  it("always parenthesises the fragment, so an AND at the call site cannot re-associate the OR", () => {
    // The bug this prevents: `WHERE guard AND a OR b` parses as
    // `(guard AND a) OR b`, silently dropping the guard for every column
    // but the first. Callers compose this with AND, so the parentheses
    // belong here rather than at each call site.
    for (const columns of [
      { text: ["p.name"] },
      { text: ["p.name", "p.name_ja"] },
      STATION_GROUP_MATCH_COLUMNS,
    ]) {
      const sql = textMatchSql(columns, "$1");
      expect(sql.startsWith("(")).toBe(true);
      expect(sql.endsWith(")")).toBe(true);
    }
  });

  it("composes safely under AND once a second column exists", () => {
    // The concrete regression: places.ts guards `p.name IS NOT NULL AND
    // <fragment>`. With two columns the guard must still apply to both.
    const sql = `p.name IS NOT NULL AND ${textMatchSql({ text: ["p.name", "p.alt_name"] }, "$1")}`;
    expect(sql).toContain("AND (p.name ILIKE");
    expect(sql.trimEnd().endsWith(")")).toBe(true);
  });

  it("is total: no columns yields `false`, never the syntax error `()`", () => {
    expect(textMatchSql({ text: [] }, "$1")).toBe("false");
  });
});

describe("escapeLikeWildcards", () => {
  it("escapes a bare % so it cannot match every row", () => {
    // Without this, `?query=%` becomes `ILIKE '%' || '%' || '%'`, i.e. a
    // full scan returning the whole table — not what the user asked for,
    // and not something the trigram index can help with.
    expect(escapeLikeWildcards("%")).toBe("\\%");
  });

  it("escapes the single-character wildcard _", () => {
    expect(escapeLikeWildcards("a_b")).toBe("a\\_b");
  });

  it("escapes backslashes FIRST, so its own escapes are not double-escaped", () => {
    // Order matters: escaping % first and then \ would turn `%` into
    // `\\%` — an escaped backslash followed by a live wildcard.
    expect(escapeLikeWildcards("\\")).toBe("\\\\");
    expect(escapeLikeWildcards("\\%")).toBe("\\\\\\%");
  });

  it("leaves an ordinary query completely untouched", () => {
    expect(escapeLikeWildcards("Shibuya")).toBe("Shibuya");
    expect(escapeLikeWildcards("渋谷")).toBe("渋谷");
  });
});

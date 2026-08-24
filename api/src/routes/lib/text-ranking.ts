/**
 * The trigram match + similarity ranking shared by `GET /v1/stations` and
 * `GET /v1/places`.
 *
 * Both endpoints answer the same question — "which rows have a name that
 * looks like what the user typed, best first?" — over different tables
 * (`station_groups`'s `name_en`/`name_ja`/`aliases`, `pois`'s `name`).
 * Extracted here rather than copy-pasted so the two stay in step: a fix to
 * the match predicate that lands in only one of two hand-written copies is
 * a ranking bug that shows up as "the autocomplete finds it but the
 * destination picker doesn't".
 *
 * Two SQL fragments, matching the shapes `stations.ts` established:
 *
 * - `similarityScoreSql` — a `GREATEST(similarity(...), ...)` expression,
 *   the ORDER BY key.
 * - `textMatchSql` — the `OR`-joined `ILIKE '%' || $n || '%'` predicate,
 *   the WHERE clause. `pg_trgm`'s `gin_trgm_ops` indexes support `ILIKE`
 *   on the base column directly, which is why the predicate matches on the
 *   raw column while the SCORE lowercases both sides.
 *
 * Index coverage is per column and must be checked before pointing these
 * helpers at a new one — an uncovered column still WORKS, it just
 * sequentially scans on every keystroke, which is invisible against seed
 * data and ruinous against the real import. Covered today:
 * `station_groups.name_en` / `.name_ja` (`0001_init.sql`) and `pois.name`
 * (`0005_poi_name_trigram_index.sql`). NOT covered: `station_groups.aliases`
 * — a small `text[]` matched via `unnest`, deliberately left unindexed at
 * this dataset's scale.
 *
 * These build SQL by string interpolation, which is safe here and only
 * here: every `columns` value is a compile-time constant written in this
 * repository (`"sg.name_en"`), never a value from a request. The USER's
 * input only ever arrives through `queryParam`, i.e. as a bound `$n`
 * placeholder. Do not extend these helpers to accept caller-supplied
 * column names.
 */

/**
 * Escapes the `LIKE`/`ILIKE` metacharacters in a user-typed query so it is
 * matched literally.
 *
 * `textMatchSql` builds `col ILIKE '%' || $n || '%'`. Binding the query as
 * a parameter stops SQL injection, but it does NOT stop the query's own
 * characters from being read as PATTERN syntax once inside `ILIKE`: a lone
 * `%` matches every row, and `_` matches any single character. That is a
 * user typing a punctuation mark and silently getting the entire table
 * back — a scan the trigram index cannot help with, and not what they
 * asked for either.
 *
 * The backslash must be escaped FIRST, or the backslashes this function
 * itself introduces would be escaped a second time. `\` is Postgres's
 * default `ESCAPE` character for `LIKE`, so no `ESCAPE` clause is needed.
 */
export function escapeLikeWildcards(query: string): string {
  return query.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

export interface TextMatchColumns {
  /** Plain `text` columns, e.g. `"sg.name_en"`. Nullable columns are fine. */
  readonly text: readonly string[];
  /** `text[]` columns matched element-wise via `unnest`, e.g. `"sg.aliases"`. */
  readonly arrays?: readonly string[];
}

/** Distinct `unnest(...) AS <alias>` names, so two array columns can't collide. */
function arrayElementAlias(index: number): string {
  return `alias_${String(index)}`;
}

/**
 * A `0..1` similarity score for the best-matching of `columns` against the
 * query bound at `queryParam`.
 *
 * `COALESCE(..., 0)` wraps the whole expression because `GREATEST` returns
 * `NULL` when every argument is `NULL` — which is exactly what a row with
 * a `NULL` name (legal in `pois`) produces — and a `NULL` sort key would
 * order unpredictably rather than last.
 *
 * Returns the constant `0` for an empty `columns`, so the helper is total:
 * `GREATEST()` with no arguments is a syntax error, and a SQL syntax error
 * raised from a fragment builder is far harder to place than a score that
 * ranks everything equally.
 */
export function similarityScoreSql(columns: TextMatchColumns, queryParam: string): string {
  const terms = [
    ...columns.text.map((column) => `similarity(lower(${column}), lower(${queryParam}))`),
    ...(columns.arrays ?? []).map((column, index) => {
      const alias = arrayElementAlias(index);
      return (
        `COALESCE((SELECT MAX(similarity(lower(${alias}), lower(${queryParam}))) ` +
        `FROM unnest(${column}) AS ${alias}), 0)`
      );
    }),
  ];

  if (terms.length === 0) return "0";

  return `COALESCE(GREATEST(${terms.join(", ")}), 0)`;
}

/**
 * A boolean predicate: any of `columns` contains the query bound at
 * `queryParam`, case-insensitively.
 *
 * The result is ALWAYS parenthesised, because it is `OR`-joined and callers
 * compose it with `AND` (`places.ts` guards `p.name IS NOT NULL AND
 * <this>`). Without the parentheses, `AND` binding tighter than `OR` would
 * silently re-associate that into `(p.name IS NOT NULL AND A) OR B` the
 * moment a second column is added — the NULL guard would quietly stop
 * applying to every column but the first. Wrapping here rather than at each
 * call site is what makes the helper safe to compose by default instead of
 * safe only if you remember.
 */
export function textMatchSql(columns: TextMatchColumns, queryParam: string): string {
  const predicates = [
    ...columns.text.map((column) => `${column} ILIKE '%' || ${queryParam} || '%'`),
    ...(columns.arrays ?? []).map((column, index) => {
      const alias = arrayElementAlias(index);
      return (
        `EXISTS (SELECT 1 FROM unnest(${column}) AS ${alias} ` +
        `WHERE ${alias} ILIKE '%' || ${queryParam} || '%')`
      );
    }),
  ];

  // `()` is a syntax error the same way `GREATEST()` is. A match predicate
  // over no columns matches nothing, so `false` is also the honest answer.
  if (predicates.length === 0) return "false";

  return `(${predicates.join("\n     OR ")})`;
}

/** The `station_groups` columns both `/v1/stations` and `/v1/places` search. */
export const STATION_GROUP_MATCH_COLUMNS: TextMatchColumns = {
  text: ["sg.name_en", "sg.name_ja"],
  arrays: ["sg.aliases"],
};

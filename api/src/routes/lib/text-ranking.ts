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
 *   the WHERE clause. `pg_trgm`'s `gin_trgm_ops` indexes (see
 *   `db/migrations/0001_init.sql`) support `ILIKE` on the base column
 *   directly, which is why the predicate matches on the raw column while
 *   the SCORE lowercases both sides.
 *
 * These build SQL by string interpolation, which is safe here and only
 * here: every `columns` value is a compile-time constant written in this
 * repository (`"sg.name_en"`), never a value from a request. The USER's
 * input only ever arrives through `queryParam`, i.e. as a bound `$n`
 * placeholder. Do not extend these helpers to accept caller-supplied
 * column names.
 */

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

  return `COALESCE(GREATEST(${terms.join(", ")}), 0)`;
}

/** A boolean predicate: any of `columns` contains the query bound at `queryParam`, case-insensitively. */
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

  return predicates.join("\n     OR ");
}

/** The `station_groups` columns both `/v1/stations` and `/v1/places` search. */
export const STATION_GROUP_MATCH_COLUMNS: TextMatchColumns = {
  text: ["sg.name_en", "sg.name_ja"],
  arrays: ["sg.aliases"],
};

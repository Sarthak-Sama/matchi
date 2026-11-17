export function escapeLikeWildcards(query: string): string {
  return query.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

export interface TextMatchColumns {
  readonly text: readonly string[];

  readonly arrays?: readonly string[];
}

function arrayElementAlias(index: number): string {
  return `alias_${String(index)}`;
}

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

  if (predicates.length === 0) return "false";

  return `(${predicates.join("\n     OR ")})`;
}

export const STATION_GROUP_MATCH_COLUMNS: TextMatchColumns = {
  text: ["sg.name_en", "sg.name_ja"],
  arrays: ["sg.aliases"],
};

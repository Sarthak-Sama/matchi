// Guard for the query_areas tool. Pure validation: never touches a database.
// The caller must still run the returned SQL in a read-only transaction with a
// statement timeout (plan step 5); this guard is the first line, not the only one.

export const AGENT_SQL_ROW_LIMIT = 50;
const MAX_SQL_LENGTH = 4000;

export type SqlGuardCode =
  | "empty"
  | "too_long"
  | "multiple_statements"
  | "comment"
  | "forbidden_syntax"
  | "not_select"
  | "forbidden_word"
  | "forbidden_reference"
  | "forbidden_function";

export type SqlGuardResult =
  | { ok: true; sql: string }
  | { ok: false; code: SqlGuardCode; reason: string };

const FORBIDDEN_WORDS = [
  "insert", "update", "delete", "drop", "alter", "create", "grant", "copy", "set",
  "truncate", "merge", "revoke", "call", "do", "execute", "prepare", "deallocate", "into",
  "lock", "vacuum", "analyze", "explain", "listen", "notify", "begin", "commit", "rollback",
  "savepoint", "reset", "show", "refresh", "reindex", "cluster", "comment", "security",
  "declare", "fetch", "import", "load", "discard", "checkpoint",
];

// Words that may legitimately sit directly before "(" without being a function.
const KEYWORDS_BEFORE_PAREN = new Set([
  "select", "from", "where", "and", "or", "not", "in", "exists", "any", "all", "some", "as",
  "on", "join", "union", "intersect", "except", "over", "filter", "by", "when", "then", "else",
  "case", "having", "limit", "offset", "with", "materialized", "lateral", "distinct", "using",
  "values", "between", "like", "ilike", "is", "group", "within",
]);

// Side-effect-free builtins the model may call unqualified.
const SAFE_FUNCTIONS = new Set([
  "count", "sum", "avg", "min", "max", "round", "floor", "ceil", "ceiling", "abs", "trunc",
  "coalesce", "nullif", "greatest", "least", "lower", "upper", "length", "trim", "btrim",
  "concat", "cast", "row_number", "rank", "dense_rank", "ntile", "lag", "lead", "first_value",
  "last_value", "percentile_cont", "percentile_disc", "stddev", "variance", "sqrt", "power",
  "ln", "exp", "array_agg", "string_agg", "bool_and", "bool_or", "left", "right", "substr",
  "replace", "sign", "mod",
]);

const fail = (code: SqlGuardCode, reason: string): SqlGuardResult => ({ ok: false, code, reason });

export function guardAgentSql(input: unknown): SqlGuardResult {
  if (typeof input !== "string" || input.trim() === "") return fail("empty", "query must be a non-empty string");
  const query = input.trim();
  if (query.length > MAX_SQL_LENGTH) return fail("too_long", `query exceeds ${MAX_SQL_LENGTH} characters`);

  if (query.includes(";")) return fail("multiple_statements", "semicolons are not allowed; send exactly one statement");
  if (query.includes("--") || query.includes("/*") || query.includes("*/")) {
    return fail("comment", "SQL comments are not allowed");
  }
  // Quoted identifiers, dollar quoting, backslash escapes and control characters
  // can hide a reference from the checks below, so none of them is accepted.
  // eslint-disable-next-line no-control-regex -- matching control characters is the point
  if (/["$\\`\u0000-\u0008\u000b-\u001f\u007f]/.test(query)) {
    return fail("forbidden_syntax", "double quotes, dollar signs, backslashes and control characters are not allowed");
  }

  // String literals are data: blank them so their contents cannot trip or dodge a check.
  const bare = query.replace(/'(?:[^']|'')*'/g, "''").toLowerCase();
  if (bare.replace(/''/g, "").includes("'")) return fail("forbidden_syntax", "unbalanced string literal");
  if (/[^\x20-\x7e\s]/.test(bare)) return fail("forbidden_syntax", "non-ASCII characters are allowed only inside string literals");

  if (!/^(select|with)\b/.test(bare)) return fail("not_select", "query must start with SELECT or WITH");

  for (const word of FORBIDDEN_WORDS) {
    if (new RegExp(`\\b${word}\\b`).test(bare)) return fail("forbidden_word", `the word "${word}" is not allowed`);
  }

  // agent_sessions holds user chat text: named here too, in case a reference slips past the FROM scan.
  if (/\b(pg_\w*|information_schema|public|agent_sessions|current_setting|current_user|session_user|version)\b/.test(bare)) {
    return fail("forbidden_reference", "only the agent schema may be referenced");
  }
  if (/\b[a-z_]\w*\s*\.\s*[a-z_]\w*\s*\.\s*[a-z_*]/.test(bare)) {
    return fail("forbidden_reference", "three-part names are not allowed; use agent.<table>");
  }

  const cteNames = new Set<string>();
  for (const match of bare.matchAll(/\b([a-z_]\w*)\s*(?:\([^()]*\)\s*)?as\s+(?:(?:not\s+)?materialized\s+)?\(/g)) {
    if (match[1]) cteNames.add(match[1]);
  }

  for (const match of bare.matchAll(/\b(?:from|join)\s+(?:only\s+|lateral\s+)*(\(|[a-z_][\w]*(?:\s*\.\s*[a-z_]\w*)?)/g)) {
    const target = (match[1] ?? "").replace(/\s+/g, "");
    if (target === "(") continue;
    if (target.startsWith("agent.")) continue;
    if (!target.includes(".") && cteNames.has(target)) continue;
    return fail("forbidden_reference", `"${target}" is not in the agent schema; use agent.<table>`);
  }
  // A comma join could bring in a table the FROM/JOIN scan never sees.
  if (hasCommaJoin(bare)) return fail("forbidden_reference", "comma joins are not allowed; use JOIN");

  for (const match of bare.matchAll(/([a-z_][\w]*(?:\s*\.\s*[a-z_]\w*)?)\s*\(/g)) {
    const name = (match[1] ?? "").replace(/\s+/g, "");
    if (name.startsWith("agent.")) continue;
    if (name.includes(".")) return fail("forbidden_function", `function "${name}" is not in the agent schema`);
    if (KEYWORDS_BEFORE_PAREN.has(name) || SAFE_FUNCTIONS.has(name) || cteNames.has(name)) continue;
    return fail("forbidden_function", `function "${name}" is not allowed`);
  }

  return { ok: true, sql: `SELECT * FROM (${query}) q LIMIT ${AGENT_SQL_ROW_LIMIT}` };
}

const FROM_CLAUSE_END = /^(?:where|group|order|limit|having|union|except|intersect|window|offset|fetch|for)\b/;

/**
 * True when a FROM clause lists tables with commas. A comma at paren depth 0
 * between FROM and the clause's end is always a join in SQL (commas inside
 * ON conditions or function calls sit inside parentheses), so this needs no
 * pattern for each place a table name can appear.
 */
function hasCommaJoin(sql: string): boolean {
  for (const match of sql.matchAll(/\bfrom\b/g)) {
    let depth = 0;
    for (let i = match.index + 4; i < sql.length; i++) {
      const ch = sql[i];
      if (ch === "(") depth++;
      else if (ch === ")") {
        if (depth === 0) break; // end of the subquery this FROM belongs to
        depth--;
      } else if (depth === 0) {
        if (ch === ",") return true;
        if (/\s/.test(sql[i - 1] ?? "") && FROM_CLAUSE_END.test(sql.slice(i))) break;
      }
    }
  }
  return false;
}

import { loadAgentLimits } from "../config.js";
import type { AgentLimits } from "../config.js";
import type { DbPool } from "../db.js";

export type UsageKind = "turn" | "session";

export type UsageDecision =
  | { ok: true }
  | { ok: false; status: 429 | 503; code: "DAILY_LIMIT" | "BUDGET_EXHAUSTED" };

interface UsageRow {
  key: string;
  turns: number;
  sessions: number;
  tokens: number;
}

const GLOBAL_KEY = "global";

// Days roll over at 00:00 UTC, which is also when model providers reset
// their own daily quotas.
const UPSERT_USAGE_SQL = `
  INSERT INTO public.agent_usage AS u (day, key, turns, sessions, tokens)
  SELECT (now() AT TIME ZONE 'UTC')::date, key, $2::int, $3::int, $4::int
  FROM unnest($1::text[]) AS key
  ON CONFLICT (day, key) DO UPDATE SET
    turns = u.turns + EXCLUDED.turns,
    sessions = u.sessions + EXCLUDED.sessions,
    tokens = u.tokens + EXCLUDED.tokens
  RETURNING u.key, u.turns, u.sessions, u.tokens
`;

function ipKey(ip: string): string {
  return `ip:${ip}`;
}

async function upsertUsage(
  pool: DbPool,
  ip: string,
  delta: { turns: number; sessions: number; tokens: number },
): Promise<UsageRow[]> {
  const result = (await pool.query(UPSERT_USAGE_SQL, [
    [ipKey(ip), GLOBAL_KEY],
    delta.turns,
    delta.sessions,
    delta.tokens,
  ])) as { rows: UsageRow[] };
  return result.rows;
}

/**
 * Counts one turn or session creation against the caller's IP and the global
 * total in a single atomic upsert, then reports whether a limit is exceeded.
 * Refused requests still count, so retrying cannot get around a limit.
 * Limits default to the AGENT_DAILY_* environment variables.
 */
export async function checkAndCount(
  pool: DbPool,
  request: { ip: string; kind: UsageKind },
  limits: AgentLimits = loadAgentLimits(),
): Promise<UsageDecision> {
  const isTurn = request.kind === "turn";
  const rows = await upsertUsage(pool, request.ip, {
    turns: isTurn ? 1 : 0,
    sessions: isTurn ? 0 : 1,
    tokens: 0,
  });

  const global = rows.find((row) => row.key === GLOBAL_KEY);
  const budget = limits.AGENT_DAILY_TOKEN_BUDGET;
  if (budget !== undefined && global !== undefined && global.tokens >= budget) {
    return { ok: false, status: 503, code: "BUDGET_EXHAUSTED" };
  }

  const mine = rows.find((row) => row.key === ipKey(request.ip));
  const overLimit = isTurn
    ? (mine?.turns ?? 0) > limits.AGENT_DAILY_TURNS_PER_IP
    : (mine?.sessions ?? 0) > limits.AGENT_DAILY_SESSIONS_PER_IP;
  return overLimit ? { ok: false, status: 429, code: "DAILY_LIMIT" } : { ok: true };
}

/** Adds the tokens a turn used to the caller's IP and the global total. */
export async function addTokens(pool: DbPool, ip: string, tokens: number): Promise<void> {
  const used = Math.round(tokens);
  if (!(used > 0)) return;
  await upsertUsage(pool, ip, { turns: 0, sessions: 0, tokens: used });
}

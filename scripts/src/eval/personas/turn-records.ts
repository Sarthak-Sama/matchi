// Reads the server's own record of each turn (public.agent_events, kind 'turn') for one session.
import type { Pool } from 'pg';

interface GroundingRecord {
  pass: boolean;
  unmatched: string[];
  markup: boolean;
}

/** The fields of api/src/agent/loop.ts TurnRecord that the evaluation reads. */
export interface TurnRecordPayload {
  traceId: string;
  outcome: string;
  firstGrounding: GroundingRecord | null;
  finalGrounding: GroundingRecord | null;
  fallbackUsed: boolean;
  markupLeaked: boolean;
}

/** One read-only transaction; the table is written by the API at the end of each turn, before its stream closes. */
export async function fetchTurnRecords(pool: Pool, sessionId: string): Promise<TurnRecordPayload[]> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const { rows } = await client.query<{ payload: TurnRecordPayload }>(
      "SELECT payload FROM public.agent_events WHERE session_id = $1 AND kind = 'turn' ORDER BY id",
      [sessionId],
    );
    return rows.map((r) => r.payload);
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    client.release();
  }
}

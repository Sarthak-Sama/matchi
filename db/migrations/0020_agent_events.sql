-- Agent telemetry and limits (plan items H4, H5, H1).
--
-- agent_events: one append-only table for server turn records (kind 'turn')
-- and client feedback (impression, open, like, dislike, map_click,
-- listing_click, share, chosen). payload is the event body; session_id is not
-- a foreign key, so events outlive the 7-day session cleanup.
-- agent_usage: daily counters per key (ip:<addr> or global) for the per-IP
-- and global spend limits.
-- agent_sessions.version / lease_until: the turn lease and the compare-and-swap
-- save, so two instances cannot run or overwrite the same session at once.
--
-- Like 0019, in public (not the agent schema the model can read), schema-
-- qualified, and idempotent, for the same reasons.

CREATE TABLE IF NOT EXISTS public.agent_events (
  id bigserial PRIMARY KEY,
  session_id uuid,
  kind text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_events_kind_created_at_idx ON public.agent_events (kind, created_at);

CREATE TABLE IF NOT EXISTS public.agent_usage (
  day date NOT NULL,
  key text NOT NULL,
  turns int NOT NULL DEFAULT 0,
  sessions int NOT NULL DEFAULT 0,
  tokens int NOT NULL DEFAULT 0,
  PRIMARY KEY (day, key)
);

ALTER TABLE public.agent_sessions
  ADD COLUMN IF NOT EXISTS version int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lease_until timestamptz;

COMMENT ON TABLE public.agent_events IS
  'Append-only agent events. kind turn: the server TurnRecord (trace id, model calls, tools, grounding, outcome). Other kinds: client feedback from POST /v1/agent/events; chosen is the ground-truth label for offline evaluation.';
COMMENT ON TABLE public.agent_usage IS
  'Daily agent usage counters per key (ip:<addr> or global), for the daily turn, session and token limits.';

-- Never readable by the model's role; see 0019 for why this is explicit.
REVOKE ALL ON public.agent_events FROM PUBLIC;
REVOKE ALL ON public.agent_usage FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'matchi_agent_ro') THEN
    REVOKE ALL ON public.agent_events FROM matchi_agent_ro;
    REVOKE ALL ON public.agent_usage FROM matchi_agent_ro;
  END IF;
END;
$$;

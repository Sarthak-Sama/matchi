-- Agent chat sessions, persisted so a conversation survives across serverless
-- instances (plan step "Persistence and deployment"). One row per session:
-- the engine snapshot, the anchor travel times the engine was given, and the
-- chat turns. The API rebuilds the engine from state.seed and restores it.
--
-- Deliberately in public, not the agent schema: the agent schema is readable
-- by the model (query_areas, matchi_agent_ro), and these rows hold user text.
-- Everything is schema-qualified so the pooled Neon endpoint, whose clients
-- can inherit an empty search_path, resolves it. IF NOT EXISTS because the
-- schema-qualified name ignores search_path, so a scratch-schema migration
-- run (scripts/src/migrate.test.ts) meets the table that public already has.

CREATE TABLE IF NOT EXISTS public.agent_sessions (
  id uuid PRIMARY KEY,
  state jsonb NOT NULL,
  anchor_times jsonb NOT NULL DEFAULT '{}',
  turns jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_sessions_updated_at_idx ON public.agent_sessions (updated_at);

COMMENT ON TABLE public.agent_sessions IS
  'Agent chat sessions. state is the engine SessionState (profile, evidence, seed, questionsAsked); anchor_times maps anchor id to minutes per area (null = unreachable); turns is the chat log. Rows idle for 7 days are deleted when a new session is created.';

-- Never readable by the model's role. No migration grants it anything in
-- public, and grant_agent_read_access() covers only the agent schema; this
-- strips the default PUBLIC privileges and anything granted to the role by
-- hand before this migration ran. A later broad GRANT on public would need
-- its own REVOKE for this table.
REVOKE ALL ON public.agent_sessions FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'matchi_agent_ro') THEN
    REVOKE ALL ON public.agent_sessions FROM matchi_agent_ro;
  END IF;
END;
$$;

import { randomUUID } from "node:crypto";

import { SessionStateSchema } from "@tokyo/shared";
import type { AnchorTimes, ComputeAnchorTimes, CreateEngine, Engine } from "@tokyo/shared";

import type { DbPool } from "../db.js";
import type { TransitGraphs } from "../domain/transit/graph.js";
import { createComputeAnchorTimes } from "./anchor-times.js";
import type { FeatureStore } from "./feature-store.js";
import { loadFeatureStore } from "./feature-store.js";

export interface AgentSession {
  id: string;
  seed: number;
  engine: Engine;
  anchorTimes: AnchorTimes;
  turns: { role: "user" | "assistant"; content: string }[];
  /** The stored version this session was read at; `save` only succeeds if it is still current. */
  version?: number;
}

/** Another writer saved the session since it was read. */
export class SessionConflictError extends Error {
  constructor(id: string) {
    super(`Session "${id}" changed since it was read`);
    this.name = "SessionConflictError";
  }
}

export interface SessionStoreOptions {
  makeSeed?: () => number;
  makeId?: () => string;
}

/**
 * Where agent sessions live between requests. Callers must `save` after any
 * change to the engine, anchorTimes or turns: with the database store, `get`
 * returns a fresh object rebuilt from the row, so unsaved changes are lost
 * when the request ends.
 *
 * A request that changes a session holds its lease: `acquire` before `get`,
 * `release` when done. `save` throws SessionConflictError if the version moved.
 */
/** A held lease. `token` identifies the holder; it is the lease's expiry, which each acquire sets anew. */
export interface Lease {
  version: number;
  token: string;
}

export interface SessionStore {
  create(): Promise<AgentSession>;
  get(id: string): Promise<AgentSession | undefined>;
  /** The lease, or null when the session is leased by someone else or does not exist. */
  acquire(id: string, ttlMs: number): Promise<Lease | null>;
  /** Frees the lease only if it is still this holder's: an expired holder must not free its successor's. */
  release(id: string, lease: Lease): Promise<void>;
  save(session: AgentSession): Promise<void>;
}

/**
 * Stored turns are capped at 40 exchanges (user + assistant), which is
 * MAX_TURNS_PER_SESSION in loop.ts. Capping lower would hide old user turns
 * from the loop's per-session turn limit and so disable it.
 */
export const MAX_STORED_TURNS = 80;

/** Sessions untouched this long are deleted when a new one is created. */
export const SESSION_TTL_DAYS = 7;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const randomSeed = (): number => Math.floor(Math.random() * 2 ** 31);

type Features = Pick<FeatureStore, "areas" | "params">;

/**
 * Process-local sessions, for tests and local tooling. `get` returns the same
 * object `create` returned (identity semantics), so mutations are visible
 * without `save`; `save` only counts calls. Use PgSessionStore anywhere more
 * than one process serves requests.
 */
export class MemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, AgentSession>();
  private readonly leases = new Map<string, number>();
  private readonly makeSeed: () => number;
  private readonly makeId: () => string;
  /** Number of save calls, so tests can assert that routes persist. */
  saves = 0;

  constructor(
    private readonly createEngine: CreateEngine,
    private readonly features: Features,
    options: SessionStoreOptions = {},
  ) {
    this.makeSeed = options.makeSeed ?? randomSeed;
    this.makeId = options.makeId ?? randomUUID;
  }

  create(): Promise<AgentSession> {
    const seed = this.makeSeed();
    const session: AgentSession = {
      id: this.makeId(),
      seed,
      engine: this.createEngine(this.features.areas, this.features.params, seed),
      anchorTimes: {},
      turns: [],
      version: 0,
    };
    this.sessions.set(session.id, session);
    return Promise.resolve(session);
  }

  get(id: string): Promise<AgentSession | undefined> {
    return Promise.resolve(this.sessions.get(id));
  }

  acquire(id: string, ttlMs: number): Promise<Lease | null> {
    const session = this.sessions.get(id);
    if (session === undefined || (this.leases.get(id) ?? 0) > Date.now()) return Promise.resolve(null);
    const expiry = Math.max(Date.now() + ttlMs, (this.leases.get(id) ?? 0) + 1);
    this.leases.set(id, expiry);
    return Promise.resolve({ version: session.version ?? 0, token: String(expiry) });
  }

  release(id: string, lease: Lease): Promise<void> {
    if (String(this.leases.get(id)) === lease.token) this.leases.delete(id);
    return Promise.resolve();
  }

  save(session: AgentSession): Promise<void> {
    this.saves++;
    session.version = (session.version ?? 0) + 1;
    this.sessions.set(session.id, session);
    return Promise.resolve();
  }
}

/** JSON has no NaN: unreachable minutes are stored as null and read back as NaN. */
function encodeAnchorTimes(times: AnchorTimes): Record<string, (number | null)[]> {
  const out: Record<string, (number | null)[]> = {};
  for (const [id, v] of Object.entries(times)) out[id] = Array.from(v, (x) => (Number.isFinite(x) ? x : null));
  return out;
}

function decodeAnchorTimes(raw: unknown): AnchorTimes {
  const out: AnchorTimes = {};
  if (raw === null || typeof raw !== "object") return out;
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    if (Array.isArray(v)) out[id] = Float64Array.from(v, (x) => (typeof x === "number" ? x : Number.NaN));
  }
  return out;
}

function decodeTurns(raw: unknown): AgentSession["turns"] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (t): t is AgentSession["turns"][number] =>
      t !== null &&
      typeof t === "object" &&
      ((t as { role?: unknown }).role === "user" || (t as { role?: unknown }).role === "assistant") &&
      typeof (t as { content?: unknown }).content === "string",
  );
}

interface SessionRow {
  state: unknown;
  anchor_times: unknown;
  turns: unknown;
  version: number;
}

/**
 * Sessions in public.agent_sessions, so a chat survives across serverless
 * instances. Each `get` rebuilds the engine from the stored seed and replays
 * the stored state; `save` writes the engine snapshot back. The lease keeps
 * concurrent requests off one session; the version check catches a lease that
 * expired mid-request.
 */
export class PgSessionStore implements SessionStore {
  private readonly makeSeed: () => number;
  private readonly makeId: () => string;

  constructor(
    private readonly pool: DbPool,
    private readonly createEngine: CreateEngine,
    private readonly features: Features,
    options: SessionStoreOptions = {},
  ) {
    this.makeSeed = options.makeSeed ?? randomSeed;
    this.makeId = options.makeId ?? randomUUID;
  }

  async create(): Promise<AgentSession> {
    const seed = this.makeSeed();
    const session: AgentSession = {
      id: this.makeId(),
      seed,
      engine: this.createEngine(this.features.areas, this.features.params, seed),
      anchorTimes: {},
      turns: [],
      version: 0,
    };
    await this.pool.query(
      `INSERT INTO public.agent_sessions (id, state, anchor_times, turns)
       VALUES ($1::uuid, $2::jsonb, '{}'::jsonb, '[]'::jsonb)`,
      [session.id, JSON.stringify(session.engine.snapshot())],
    );
    try {
      await this.pool.query(
        `DELETE FROM public.agent_sessions WHERE updated_at < now() - make_interval(days => $1::int)`,
        [SESSION_TTL_DAYS],
      );
    } catch {
      // Cleanup is opportunistic; the next create tries again.
    }
    return session;
  }

  async get(id: string): Promise<AgentSession | undefined> {
    if (!UUID.test(id)) return undefined;
    const result = (await this.pool.query(
      `SELECT state, anchor_times, turns, version FROM public.agent_sessions WHERE id = $1::uuid`,
      [id],
    )) as { rows: SessionRow[] };
    const row = result.rows[0];
    if (row === undefined) return undefined;
    // A row the current schema cannot read is treated as gone: the client starts over.
    const state = SessionStateSchema.safeParse(row.state);
    if (!state.success) return undefined;
    const anchorTimes = decodeAnchorTimes(row.anchor_times);
    const engine = this.createEngine(this.features.areas, this.features.params, state.data.seed);
    engine.restore(state.data, anchorTimes);
    return { id, seed: state.data.seed, engine, anchorTimes, turns: decodeTurns(row.turns), version: row.version };
  }

  async acquire(id: string, ttlMs: number): Promise<Lease | null> {
    if (!UUID.test(id)) return null;
    // clock_timestamp() rather than now(): two acquires in one transaction would share now().
    const result = (await this.pool.query(
      `UPDATE public.agent_sessions
       SET lease_until = clock_timestamp() + $2::int * interval '1 millisecond'
       WHERE id = $1::uuid AND (lease_until IS NULL OR lease_until < now())
       RETURNING version, lease_until::text AS token`,
      [id, ttlMs],
    )) as { rows: { version: number; token: string }[] };
    const row = result.rows[0];
    return row === undefined ? null : { version: row.version, token: row.token };
  }

  async release(id: string, lease: Lease): Promise<void> {
    if (!UUID.test(id)) return;
    await this.pool.query(
      `UPDATE public.agent_sessions SET lease_until = NULL WHERE id = $1::uuid AND lease_until::text = $2`,
      [id, lease.token],
    );
  }

  async save(session: AgentSession): Promise<void> {
    const version = session.version ?? 0;
    const result = (await this.pool.query(
      `UPDATE public.agent_sessions
       SET state = $2::jsonb, anchor_times = $3::jsonb, turns = $4::jsonb, version = version + 1, updated_at = now()
       WHERE id = $1::uuid AND version = $5::int`,
      [
        session.id,
        JSON.stringify(session.engine.snapshot()),
        JSON.stringify(encodeAnchorTimes(session.anchorTimes)),
        JSON.stringify(session.turns.slice(-MAX_STORED_TURNS)),
        version,
      ],
    )) as { rowCount: number | null };
    if (result.rowCount === 0) throw new SessionConflictError(session.id);
    session.version = version + 1;
  }
}

/** Everything the agent routes share. Built once, on first use. */
export interface AgentRuntime {
  features: FeatureStore;
  sessions: SessionStore;
  computeAnchorTimes: ComputeAnchorTimes;
}

/**
 * buildApp is synchronous, so the feature store (a few queries) is loaded on
 * the first agent request and memoised; a failed load is retried next request.
 * Route modules share one runtime by calling the returned getter.
 */
export function createAgentRuntimeGetter(
  deps: { pool: DbPool; graphs: TransitGraphs },
  createEngine: CreateEngine,
): () => Promise<AgentRuntime> {
  let runtime: Promise<AgentRuntime> | null = null;
  return () => {
    runtime ??= loadFeatureStore(deps.pool).then(
      (features): AgentRuntime => ({
        features,
        sessions: new PgSessionStore(deps.pool, createEngine, features),
        computeAnchorTimes: createComputeAnchorTimes(deps),
      }),
    );
    runtime.catch(() => {
      runtime = null;
    });
    return runtime;
  };
}

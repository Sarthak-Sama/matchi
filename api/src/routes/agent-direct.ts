import { EvidenceSchema, ProfileSchema } from "@tokyo/shared";
import type {
  AgentStateView,
  Engine,
  LoggedEvidence,
  ObserveResult,
  ProfileResult,
  Recommendation,
} from "@tokyo/shared";
import type { FastifyBaseLogger, FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import { ApiError } from "../application.js";
import type { AgentRuntime, AgentSession, Lease, SessionStore } from "../agent/session.js";
import { SessionConflictError } from "../agent/session.js";
import { checkAndCount } from "../agent/usage.js";
import type { UsageKind } from "../agent/usage.js";
import type { DbPool } from "../db.js";
import { parseOrThrow } from "./lib/validation.js";

export interface AgentDirectDeps {
  /** Resolves the shared runtime (feature store, sessions, anchor times); see createAgentRuntimeGetter. */
  getRuntime: () => Promise<AgentRuntime>;
  /** Where the daily usage counters live. */
  pool: DbPool;
}

/** A direct mutation is one quick read-modify-write; the lease only has to outlast that. */
const DIRECT_LEASE_TTL_MS = 5_000;

const EvidenceBodySchema = z.object({ items: z.array(EvidenceSchema).min(1).max(50) });
const RecommendBodySchema = z.object({ k: z.number().int().min(1).max(20).optional() });
const WhyNotBodySchema = z.object({ localityId: z.string().min(1) });
const CompareBodySchema = z.object({ a: z.string().min(1), b: z.string().min(1) });
const CreateSessionBodySchema = z.object({ fromId: z.string().min(1).max(100).optional() });
const SessionParamsSchema = z.object({ id: z.string().min(1) });
const EvidenceParamsSchema = z.object({ id: z.string().min(1) });
const EvidenceQuerySchema = z.object({ sessionId: z.string().min(1) });

async function requireSession(sessions: SessionStore, id: string): Promise<AgentSession> {
  const session = await sessions.get(id);
  if (session === undefined) {
    throw new ApiError(404, "SESSION_NOT_FOUND", `Unknown session "${id}"`);
  }
  return session;
}

const BUSY_MESSAGE = "Another request is using this session; try again in a moment.";

/** Takes the session's lease, or throws 404 for an unknown session and 409 SESSION_BUSY for a busy one. */
export async function acquireLease(sessions: SessionStore, id: string, ttlMs: number): Promise<Lease> {
  const lease = await sessions.acquire(id, ttlMs);
  if (lease !== null) return lease;
  // acquire answers null for both cases; only a missing session is a 404.
  await requireSession(sessions, id);
  throw new ApiError(409, "SESSION_BUSY", BUSY_MESSAGE);
}

/** Frees the lease. A failure is not worth failing the request: the lease expires on its own. */
export async function releaseLease(
  sessions: SessionStore,
  id: string,
  lease: Lease,
  log: FastifyBaseLogger,
): Promise<void> {
  try {
    await sessions.release(id, lease);
  } catch (err) {
    log.warn({ err, sessionId: id }, "agent session lease release failed");
  }
}

/** Counts the request against the caller's daily limits and throws the API error when one is hit. */
export async function enforceDailyLimit(pool: DbPool, ip: string, kind: UsageKind): Promise<void> {
  const decision = await checkAndCount(pool, { ip, kind });
  if (decision.ok) return;
  const message =
    decision.code === "DAILY_LIMIT"
      ? "Daily limit reached; try again tomorrow."
      : "The agent has used its budget for today; try again tomorrow.";
  throw new ApiError(decision.status, decision.code, message);
}

/**
 * A new session with the source's profile and evidence and no turns, for share
 * links and "continue in a new chat". The source session is only read.
 */
async function forkSession(sessions: SessionStore, fromId: string): Promise<AgentSession> {
  const source = await requireSession(sessions, fromId);
  const fork = await sessions.create();
  fork.engine.restore(source.engine.snapshot(), source.anchorTimes);
  fork.seed = source.seed;
  fork.anchorTimes = { ...source.anchorTimes };
  await sessions.save(fork);
  return fork;
}

/**
 * Builds the state view from the engine alone; nothing derived is stored.
 * A recommendation the engine cannot produce (it throws, e.g. profile too
 * incomplete) shows as null with belief and evidence still present.
 */
export function buildView(engine: Engine, k?: number): AgentStateView {
  const snapshot = engine.snapshot();
  let recommendation: Recommendation | null;
  try {
    recommendation = engine.recommend(k);
  } catch {
    recommendation = null;
  }
  return {
    profile: snapshot.profile,
    evidence: snapshot.evidence as LoggedEvidence[],
    belief: engine.beliefSummary(),
    recommendation,
    riskYen: recommendation?.riskYen ?? null,
    excluded: recommendation?.excluded ?? null,
  };
}

/**
 * Sessions persist between requests (see SessionStore): the routes that change
 * engine state (profile, evidence add and remove) save before replying. The
 * others only read: recommend, why-not, compare and relax leave the snapshot
 * unchanged.
 */
export function registerAgentDirectRoute(app: FastifyInstance, deps: AgentDirectDeps): void {
  const sessionFor = async (
    request: FastifyRequest,
  ): Promise<{ session: AgentSession; runtime: AgentRuntime }> => {
    const { id } = parseOrThrow(SessionParamsSchema, request.params);
    const runtime = await deps.getRuntime();
    return { session: await requireSession(runtime.sessions, id), runtime };
  };

  /** Runs a read-modify-write on one session under its lease. */
  const withLease = async <T>(sessionId: string, run: (runtime: AgentRuntime) => Promise<T>, log: FastifyBaseLogger): Promise<T> => {
    const runtime = await deps.getRuntime();
    const lease = await acquireLease(runtime.sessions, sessionId, DIRECT_LEASE_TTL_MS);
    try {
      return await run(runtime);
    } catch (err) {
      if (err instanceof SessionConflictError) throw new ApiError(409, "SESSION_BUSY", BUSY_MESSAGE);
      throw err;
    } finally {
      await releaseLease(runtime.sessions, sessionId, lease, log);
    }
  };

  app.post("/v1/agent/session", async (request, reply) => {
    const { fromId } = parseOrThrow(CreateSessionBodySchema, request.body ?? {});
    await enforceDailyLimit(deps.pool, request.ip, "session");
    const { sessions } = await deps.getRuntime();
    const session = fromId === undefined ? await sessions.create() : await forkSession(sessions, fromId);
    reply.status(200).send({ sessionId: session.id, view: buildView(session.engine) });
  });

  app.get("/v1/agent/session/:id", async (request, reply) => {
    const { session } = await sessionFor(request);
    reply.status(200).send({ view: buildView(session.engine), turns: session.turns });
  });

  app.put("/v1/agent/session/:id/profile", async (request, reply) => {
    const { id } = parseOrThrow(SessionParamsSchema, request.params);
    const payload = await withLease(id, async (runtime) => {
      const session = await requireSession(runtime.sessions, id);
      const profile = parseOrThrow(ProfileSchema, request.body);

      const { times, refused } = await runtime.computeAnchorTimes(profile.anchors, runtime.features.areas);
      session.anchorTimes = times;
      const engineResult = session.engine.setProfile(profile, times);
      await runtime.sessions.save(session);

      // The engine flags anchors with no vector as 'no_times'; ours carry the real reason.
      const ours = new Set(refused.map((r) => r.anchorId));
      const result: ProfileResult = {
        ...engineResult,
        refusedAnchors: [
          ...refused,
          ...engineResult.refusedAnchors.filter((r) => !(r.reason === "no_times" && ours.has(r.anchorId))),
        ],
      };
      return { result, view: buildView(session.engine) };
    }, request.log);
    reply.status(200).send(payload);
  });

  app.post("/v1/agent/session/:id/evidence", async (request, reply) => {
    const { id } = parseOrThrow(SessionParamsSchema, request.params);
    const payload = await withLease(id, async (runtime) => {
      const session = await requireSession(runtime.sessions, id);
      const { items } = parseOrThrow(EvidenceBodySchema, request.body);
      // Direct routes carry the person's taps (R4); the client cannot claim otherwise.
      const results: ObserveResult[] = items.map((item) => session.engine.observe({ ...item, source: "tap" }));
      await runtime.sessions.save(session);
      return { results, view: buildView(session.engine) };
    }, request.log);
    reply.status(200).send(payload);
  });

  app.delete("/v1/agent/evidence/:id", async (request, reply) => {
    const { id } = parseOrThrow(EvidenceParamsSchema, request.params);
    const { sessionId } = parseOrThrow(EvidenceQuerySchema, request.query);
    const payload = await withLease(sessionId, async ({ sessions }) => {
      const session = await requireSession(sessions, sessionId);
      if (!session.engine.snapshot().evidence.some((e) => e.id === id)) {
        throw new ApiError(404, "EVIDENCE_NOT_FOUND", `Unknown evidence "${id}" in this session`);
      }
      session.engine.removeEvidence(id);
      await sessions.save(session);
      return { view: buildView(session.engine) };
    }, request.log);
    reply.status(200).send(payload);
  });

  app.post("/v1/agent/session/:id/recommend", async (request, reply) => {
    const { session } = await sessionFor(request);
    const { k } = parseOrThrow(RecommendBodySchema, request.body ?? {});
    reply.status(200).send({ view: buildView(session.engine, k) });
  });

  app.post("/v1/agent/session/:id/why-not", async (request, reply) => {
    const { session } = await sessionFor(request);
    const { localityId } = parseOrThrow(WhyNotBodySchema, request.body);
    reply.status(200).send({ result: session.engine.whyNot(localityId) });
  });

  app.post("/v1/agent/session/:id/compare", async (request, reply) => {
    const { session, runtime } = await sessionFor(request);
    const { a, b } = parseOrThrow(CompareBodySchema, request.body);
    for (const id of [a, b]) {
      if (!runtime.features.areaIndex.has(id)) {
        throw new ApiError(404, "AREA_NOT_FOUND", `Unknown area "${id}"`);
      }
    }
    reply.status(200).send({ result: session.engine.compare(a, b) });
  });

  app.post("/v1/agent/session/:id/relax", async (request, reply) => {
    const { session } = await sessionFor(request);
    reply.status(200).send({ result: session.engine.relax() });
  });
}

import { EvidenceSchema, ProfileSchema } from "@tokyo/shared";
import type {
  AgentStateView,
  Engine,
  LoggedEvidence,
  ObserveResult,
  ProfileResult,
  Recommendation,
} from "@tokyo/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import { ApiError } from "../application.js";
import type { AgentRuntime, AgentSession, SessionStore } from "../agent/session.js";
import { parseOrThrow } from "./lib/validation.js";

export interface AgentDirectDeps {
  /** Resolves the shared runtime (feature store, sessions, anchor times); see createAgentRuntimeGetter. */
  getRuntime: () => Promise<AgentRuntime>;
}

const EvidenceBodySchema = z.object({ items: z.array(EvidenceSchema).min(1).max(50) });
const RecommendBodySchema = z.object({ k: z.number().int().min(1).max(20).optional() });
const WhyNotBodySchema = z.object({ localityId: z.string().min(1) });
const CompareBodySchema = z.object({ a: z.string().min(1), b: z.string().min(1) });
const SessionParamsSchema = z.object({ id: z.string().min(1) });
const EvidenceParamsSchema = z.object({ id: z.string().min(1) });
const EvidenceQuerySchema = z.object({ sessionId: z.string().min(1) });

function requireSession(sessions: SessionStore, id: string): AgentSession {
  const session = sessions.get(id);
  if (session === undefined) {
    throw new ApiError(404, "SESSION_NOT_FOUND", `Unknown session "${id}"`);
  }
  return session;
}

/**
 * Builds the state view from the engine alone; nothing derived is stored.
 * A recommendation the engine cannot produce (it throws, e.g. profile too
 * incomplete) shows as null with belief and evidence still present.
 */
export function buildView(engine: Engine, k?: number): AgentStateView {
  const snapshot = engine.snapshot();
  let recommendation: Recommendation | null = null;
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

export function registerAgentDirectRoute(app: FastifyInstance, deps: AgentDirectDeps): void {
  const sessionFor = async (
    request: FastifyRequest,
  ): Promise<{ session: AgentSession; runtime: AgentRuntime }> => {
    const { id } = parseOrThrow(SessionParamsSchema, request.params);
    const runtime = await deps.getRuntime();
    return { session: requireSession(runtime.sessions, id), runtime };
  };

  app.post("/v1/agent/session", async (_request, reply) => {
    const session = (await deps.getRuntime()).sessions.create();
    reply.status(200).send({ sessionId: session.id, view: buildView(session.engine) });
  });

  app.get("/v1/agent/session/:id", async (request, reply) => {
    const { session } = await sessionFor(request);
    reply.status(200).send({ view: buildView(session.engine) });
  });

  app.put("/v1/agent/session/:id/profile", async (request, reply) => {
    const { session, runtime } = await sessionFor(request);
    const profile = parseOrThrow(ProfileSchema, request.body);

    const { times, refused } = await runtime.computeAnchorTimes(profile.anchors, runtime.features.areas);
    session.anchorTimes = times;
    const engineResult = session.engine.setProfile(profile, times);

    // The engine flags anchors with no vector as 'no_times'; ours carry the real reason.
    const ours = new Set(refused.map((r) => r.anchorId));
    const result: ProfileResult = {
      ...engineResult,
      refusedAnchors: [
        ...refused,
        ...engineResult.refusedAnchors.filter((r) => !(r.reason === "no_times" && ours.has(r.anchorId))),
      ],
    };
    reply.status(200).send({ result, view: buildView(session.engine) });
  });

  app.post("/v1/agent/session/:id/evidence", async (request, reply) => {
    const { session } = await sessionFor(request);
    const { items } = parseOrThrow(EvidenceBodySchema, request.body);
    const results: ObserveResult[] = items.map((item) => session.engine.observe(item));
    reply.status(200).send({ results, view: buildView(session.engine) });
  });

  app.delete("/v1/agent/evidence/:id", async (request, reply) => {
    const { id } = parseOrThrow(EvidenceParamsSchema, request.params);
    const { sessionId } = parseOrThrow(EvidenceQuerySchema, request.query);
    const session = requireSession((await deps.getRuntime()).sessions, sessionId);
    if (!session.engine.snapshot().evidence.some((e) => e.id === id)) {
      throw new ApiError(404, "EVIDENCE_NOT_FOUND", `Unknown evidence "${id}" in this session`);
    }
    session.engine.removeEvidence(id);
    reply.status(200).send({ view: buildView(session.engine) });
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

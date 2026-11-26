import type { AgentStreamEvent, AreaFeatures, Engine, Evidence, LoggedEvidence, Profile, Recommendation } from "@tokyo/shared";
import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, buildApp } from "../application.js";
import { createScriptedModel } from "../agent/model-client.js";
import type { ModelClient, ScriptedStep } from "../agent/model-client.js";
import { MemorySessionStore } from "../agent/session.js";
import type { AgentRuntime, AgentSession } from "../agent/session.js";
import { emptyGraphs, testConfig } from "../test-support/fixtures.js";
import { registerAgentRoute } from "./agent.js";

// The usage counters need a real database; the limits have their own tests.
vi.mock("../agent/usage.js", () => ({
  checkAndCount: vi.fn(async () => ({ ok: true })),
  addTokens: vi.fn(async () => undefined),
}));

const REC: Recommendation = {
  shortlist: [
    {
      localityId: "L1", nameEn: "Ebisu", nameJa: "恵比寿", wardNameEn: "Shibuya", lat: 35.65, lon: 139.71, nearestStation: null, safety: null, rentYen: 82_340,
      commuteMinutes: 23.4, monthlyTravelHours: 16.3, pBest: 0.4567, regretYen: 1_234, role: null,
      breakdown: { rent: -82_340, timeCost: -10_000, features: {} as never, budgetPenalty: 0, capPenalty: 0, total: -92_340 },
      vsMedian: { rent: 0, timeCost: 0, features: {} as never, budgetPenalty: 0, capPenalty: 0, total: 0 },
      confidence: { rent: "near_price_point", landValueNearestM: 100, access: "high", commuteBandMinutes: 4, lateReturnNotCovered: false },
    },
  ],
  feasibleCount: 2, riskYen: 2_345, shouldStop: false, stopReason: null, nextQuestion: null,
  excluded: { nullRent: 0, nullLifestyle: 0, missingAccess: 0, disconnected: 0, overBudgetFirm: 0, overCommuteCapFirm: 0, uninhabited: 0 },
  ess: 3000,
};

function stubEngine(): Engine {
  let profile = { anchors: [], enoughMultipliers: {} } as Profile;
  const log: LoggedEvidence[] = [];
  return {
    setProfile: (p) => {
      profile = p;
      return { profile: p, refusedAnchors: [], feasibleCount: 2, missing: [] };
    },
    observe: (ev: Evidence) => {
      const id = `ev${String(log.length + 1)}`;
      log.push({ ...ev, id });
      return { ok: true, id, predictive: 0.6, surprising: false };
    },
    removeEvidence: () => undefined,
    recommend: () => REC,
    whyNot: (id) => ({ kind: "is_top_pick", localityId: id }),
    relax: () => [],
    compare: (a, b) => ({ a, b, diff: REC.shortlist[0]!.vsMedian, pABeatsB: 0.5 }),
    beliefSummary: () => ({ params: [], ess: 3000, lowConfidence: false, scale: 100_000 }),
    snapshot: () => ({ profile, evidence: log, seed: 1, questionsAsked: 0 }),
    restore: () => undefined,
  };
}

function runtimeWith(session: AgentSession, save: AgentRuntime["sessions"]["save"]): AgentRuntime {
  const areas = [{ locality_id: "L1" }, { locality_id: "L2" }] as AreaFeatures[];
  return {
    features: {
      areas,
      areaIndex: new Map([["L1", 0], ["L2", 1]]),
      params: { rentElasticity: 0.356, layoutAreaSqm: { "1LDK": 38 } },
      columnComments: {},
    },
    sessions: {
      create: () => Promise.reject(new Error("not used")),
      get: async (id: string) => (id === session.id ? session : undefined),
      acquire: async (id: string) => (id === session.id ? 0 : null),
      release: async () => undefined,
      save,
    },
    computeAnchorTimes: vi.fn(async (anchors: readonly { id: string }[]) => ({
      times: Object.fromEntries(anchors.map((a) => [a.id, [10, 20]])),
      refused: [],
    })),
  };
}

function parseSse(body: string): AgentStreamEvent[] {
  return body
    .split("\n\n")
    .filter((block) => block.trim() !== "")
    .map((block) => {
      const data = block.split("\n").find((l) => l.startsWith("data: "));
      return JSON.parse(data!.slice(6)) as AgentStreamEvent;
    });
}

function testApp(steps: ScriptedStep[] | null, save = vi.fn(async (session: AgentSession): Promise<void> => void session)) {
  const session: AgentSession = { id: "s1", seed: 1, engine: stubEngine(), anchorTimes: {}, turns: [] };
  const app = Fastify();
  const model = steps === null ? null : createScriptedModel(steps);
  registerAgentRoute(app, { getRuntime: async () => runtimeWith(session, save), pool: { query: vi.fn() }, model, queryAreasEnabled: false });
  return { app, session, model, save };
}

const GROUNDED = "Ebisu leads: modelled rent ¥82,000, about 23 minutes to the office, a 46% chance of being best.";
const TURN_STEPS: ScriptedStep[] = [
  {
    toolCalls: [
      { name: "set_profile", input: { anchors: [{ label: "office", stationId: "S1", tripsPerWeek: 5 }], budget: { value: 100_000, firm: true } } },
      { name: "observe", input: { items: [{ type: "direction", feature: "green_space", sign: 1, quote: "I like parks" }] } },
    ],
  },
  { text: GROUNDED },
];

afterEach(() => vi.unstubAllEnvs());

describe("POST /v1/agent/turn", () => {
  it("streams a full turn end to end over SSE", async () => {
    const { app, session } = testApp(TURN_STEPS);
    const res = await app.inject({ method: "POST", url: "/v1/agent/turn", payload: { sessionId: "s1", message: "Shibuya office, 100k, parks" } });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^text\/event-stream/);
    expect(res.body).toContain("event: tool_call\ndata: ");
    const events = parseSse(res.body);
    expect(events.map((e) => (e.type === "tool_call" ? `call:${e.name}` : e.type))).toEqual([
      "call:set_profile",
      "tool_result",
      "call:observe",
      "tool_result",
      "call:recommend",
      "tool_result",
      "state",
      "text",
      "grounding",
      "done",
    ]);
    expect(events.find((e) => e.type === "text")).toEqual({ type: "text", delta: GROUNDED });
    expect(events.find((e) => e.type === "grounding")).toEqual({ type: "grounding", pass: true, failures: [] });
    const state = events.find((e) => e.type === "state");
    expect(state).toMatchObject({ state: { riskYen: 2_345, recommendation: { feasibleCount: 2 }, evidence: [{ id: "ev1" }] } });
    expect(session.turns).toHaveLength(2);
  });

  it("saves the session before done, with the turn's changes", async () => {
    let turnsAtSave = -1;
    let evidenceAtSave = -1;
    const save = vi.fn(async (s: AgentSession) => {
      turnsAtSave = s.turns.length;
      evidenceAtSave = s.engine.snapshot().evidence.length;
    });
    const { app, session } = testApp(TURN_STEPS, save);
    const res = await app.inject({ method: "POST", url: "/v1/agent/turn", payload: { sessionId: "s1", message: "parks" } });
    await app.close();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(session);
    expect(turnsAtSave).toBe(2);
    expect(evidenceAtSave).toBe(1);
    expect(parseSse(res.body).filter((e) => e.type === "done")).toHaveLength(1);
  });

  it("saves even when the turn fails", async () => {
    const { app, save } = testApp([
      () => {
        throw new Error("model down");
      },
    ]);
    const res = await app.inject({ method: "POST", url: "/v1/agent/turn", payload: { sessionId: "s1", message: "hi" } });
    await app.close();
    expect(save).toHaveBeenCalledTimes(1);
    expect(parseSse(res.body).map((e) => e.type)).toEqual(["error", "done"]);
  });

  it("reports a failed save as an error event and still ends with done", async () => {
    const save = vi.fn(async () => {
      throw new Error("db down");
    });
    const { app } = testApp(TURN_STEPS, save);
    const res = await app.inject({ method: "POST", url: "/v1/agent/turn", payload: { sessionId: "s1", message: "parks" } });
    await app.close();
    expect(res.statusCode).toBe(200);
    const events = parseSse(res.body);
    expect(events.slice(-2)).toEqual([
      expect.objectContaining({ type: "error", code: "SESSION_SAVE_FAILED" }),
      { type: "done" },
    ]);
  });

  it("streams a grounding failure, the one retry and the outcome", async () => {
    const { app, model } = testApp([
      { toolCalls: [{ name: "recommend", input: {} }] },
      { text: "Ebisu rent is ¥95,000." },
      { text: GROUNDED },
    ]);
    const res = await app.inject({ method: "POST", url: "/v1/agent/turn", payload: { sessionId: "s1", message: "suggest?" } });
    await app.close();
    const events = parseSse(res.body);
    expect(events.map((e) => e.type).slice(-4)).toEqual(["state", "text", "grounding", "done"]);
    expect(events.filter((e) => e.type === "grounding").map((e) => e.type === "grounding" && e.pass)).toEqual([true]);
    expect(model!.requests).toHaveLength(3);
  });

  it("emits a typed error then done when no model is configured", async () => {
    const { app } = testApp(null);
    const res = await app.inject({ method: "POST", url: "/v1/agent/turn", payload: { sessionId: "s1", message: "hi" } });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(parseSse(res.body)).toEqual([
      { type: "error", code: "MODEL_NOT_CONFIGURED", message: "no model configured" },
      { type: "done" },
    ]);
  });

  it("answers 409 SESSION_BUSY to a second turn while the first is running", async () => {
    const sessions = new MemorySessionStore(stubEngine, { areas: [], params: { rentElasticity: 0.356, layoutAreaSqm: {} } });
    const { id } = await sessions.create();
    let modelCalled!: () => void;
    const firstTurnRunning = new Promise<void>((resolve) => (modelCalled = resolve));
    let finishFirstTurn!: () => void;
    const hold = new Promise<void>((resolve) => (finishFirstTurn = resolve));
    const model: ModelClient = {
      complete: async () => {
        modelCalled();
        await hold;
        return { text: "Noted.", toolCalls: [], ms: 1, finishReason: "stop", usage: null };
      },
    };
    const unused: AgentSession = { id: "unused", seed: 1, engine: stubEngine(), anchorTimes: {}, turns: [] };
    const app = Fastify();
    app.setErrorHandler((err, _request, reply) => {
      if (err instanceof ApiError) void reply.status(err.statusCode).send({ error: { code: err.code } });
      else void reply.status(500).send({ error: { code: "INTERNAL_ERROR" } });
    });
    registerAgentRoute(app, { getRuntime: async () => ({ ...runtimeWith(unused, vi.fn()), sessions }), pool: { query: vi.fn() }, model, queryAreasEnabled: false });
    const turn = { method: "POST", url: "/v1/agent/turn", payload: { sessionId: id, message: "hi" } } as const;

    const first = app.inject(turn);
    await firstTurnRunning;
    const second = await app.inject(turn);
    finishFirstTurn();
    const firstDone = await first;
    const third = await app.inject(turn);
    await app.close();

    expect(second.statusCode).toBe(409);
    expect((second.json() as { error: { code: string } }).error.code).toBe("SESSION_BUSY");
    expect(firstDone.statusCode).toBe(200);
    expect(third.statusCode).toBe(200);
  });

  it("rejects a bad body and an unknown session", async () => {
    const { app } = testApp(TURN_STEPS);
    const bad = await app.inject({ method: "POST", url: "/v1/agent/turn", payload: { message: "" } });
    const unknown = await app.inject({ method: "POST", url: "/v1/agent/turn", payload: { sessionId: "nope", message: "hi" } });
    await app.close();
    expect(bad.statusCode).toBe(400);
    expect(unknown.statusCode).toBe(404);
  });

  it("is wired into buildApp and does not crash without AGENT_MODEL_API_KEY", async () => {
    vi.stubEnv("AGENT_MODEL_API_KEY", "");
    const pool = { query: vi.fn().mockRejectedValue(new Error("no database in this test")) };
    const app = buildApp({ config: testConfig(), pool, graphs: emptyGraphs() });
    const res = await app.inject({ method: "POST", url: "/v1/agent/turn", payload: { sessionId: "s1", message: "hi" } });
    const health = await app.inject({ method: "OPTIONS", url: "/v1/agent/evidence/x", headers: { origin: "http://localhost:3000", "access-control-request-method": "DELETE" } });
    await app.close();
    expect(parseSse(res.body).map((e) => e.type)).toEqual(["error", "done"]);
    expect(pool.query).not.toHaveBeenCalled();
    expect(String(health.headers["access-control-allow-methods"])).toContain("DELETE");
  });
});

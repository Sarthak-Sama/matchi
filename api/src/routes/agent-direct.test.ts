import type {
  AreaFeatures,
  BeliefSummary,
  Engine,
  LoggedEvidence,
  Profile,
  Recommendation,
} from "@tokyo/shared";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { describe, expect, it, vi } from "vitest";

import { ApiError, buildApp } from "../application.js";
import type { FeatureStore } from "../agent/feature-store.js";
import { MemorySessionStore } from "../agent/session.js";
import type { DbPool } from "../db.js";
import { emptyGraphs, testConfig } from "../test-support/fixtures.js";
import { registerAgentDirectRoute } from "./agent-direct.js";

// The usage counters need a real database; the limits have their own tests.
vi.mock("../agent/usage.js", () => ({
  checkAndCount: vi.fn(async () => ({ ok: true })),
  addTokens: vi.fn(async () => undefined),
}));

const areas = [{ locality_id: "a" }, { locality_id: "b" }] as AreaFeatures[];
const features: FeatureStore = {
  areas,
  params: { rentElasticity: 0.36, layoutAreaSqm: {} },
  columnComments: {},
  areaIndex: new Map([
    ["a", 0],
    ["b", 1],
  ]),
};
const belief = { params: [], ess: 4000, lowConfidence: false, scale: 100000 } as BeliefSummary;
const recommendation = { shortlist: [], feasibleCount: 2, riskYen: 1234, excluded: { nullRent: 0 } } as unknown as Recommendation;

function stubEngine(): Engine & { evidence: LoggedEvidence[]; profile: Profile } {
  const state = { evidence: [] as LoggedEvidence[], profile: { anchors: [], enoughMultipliers: {} } as Profile };
  let n = 0;
  return Object.assign(state, {
    setProfile: vi.fn((p: Profile, times: Record<string, unknown>) => {
      state.profile = p;
      return {
        profile: p,
        refusedAnchors: p.anchors
          .filter((a) => !(a.id in times))
          .map((a) => ({ anchorId: a.id, reason: "no_times" as const, message: "no vector" })),
        feasibleCount: 2,
        missing: [],
      };
    }),
    observe: vi.fn((e) => {
      if (e.type === "like_area" && e.area === "zzz") {
        return { ok: false as const, error: { code: "unknown_area" as const, message: "zzz" } };
      }
      const id = `ev${++n}`;
      state.evidence.push({ ...e, id });
      return { ok: true as const, id, predictive: 0.5, surprising: false };
    }),
    removeEvidence: vi.fn((id: string) => {
      state.evidence = state.evidence.filter((e) => e.id !== id);
    }),
    recommend: vi.fn(() => recommendation),
    whyNot: vi.fn((localityId: string) => ({ kind: "is_top_pick" as const, localityId })),
    relax: vi.fn(() => []),
    compare: vi.fn((a: string, b: string) => ({ a, b, pABeatsB: 0.5 })),
    beliefSummary: vi.fn(() => belief),
    snapshot: vi.fn(() => ({ profile: state.profile, evidence: state.evidence, seed: 1, questionsAsked: 0 })),
    restore: vi.fn(),
  }) as unknown as Engine & { evidence: LoggedEvidence[]; profile: Profile };
}

function build() {
  const engines: ReturnType<typeof stubEngine>[] = [];
  const sessions = new MemorySessionStore(
    () => {
      const e = stubEngine();
      engines.push(e);
      return e;
    },
    features,
  );
  const computeAnchorTimes = vi.fn(async (anchors: readonly { id: string }[]) => {
    const times: Record<string, number[]> = {};
    const refused = [];
    for (const a of anchors) {
      if (a.id === "bad") refused.push({ anchorId: a.id, reason: "unknown_station" as const, message: "nope" });
      else times[a.id] = [10, 20];
    }
    return { times, refused };
  });
  const app = Fastify();
  app.setErrorHandler((err: Error, _req, reply) => {
    if (err instanceof ApiError) {
      void reply.status(err.statusCode).send({ error: { code: err.code, message: err.message, details: err.details } });
      return;
    }
    void reply.status(500).send({ error: { code: "INTERNAL_ERROR", message: err.message } });
  });
  registerAgentDirectRoute(app, {
    getRuntime: async () => ({ features, sessions, computeAnchorTimes }),
    pool: { query: vi.fn() },
  });
  return { app, engines, computeAnchorTimes, sessions };
}

async function newSession(app: FastifyInstance): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/v1/agent/session" });
  return (res.json() as { sessionId: string }).sessionId;
}

describe("agent direct routes", () => {
  it("creates a session and returns a view with a recommendation", async () => {
    const { app } = build();
    const res = await app.inject({ method: "POST", url: "/v1/agent/session" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { sessionId: string; view: { recommendation: unknown; riskYen: number; excluded: unknown } };
    expect(body.sessionId).toBeTruthy();
    expect(body.view.recommendation).toBeTruthy();
    expect(body.view.riskYen).toBe(1234);
    expect(body.view.excluded).toEqual({ nullRent: 0 });

    const got = await app.inject({ method: "GET", url: `/v1/agent/session/${body.sessionId}` });
    expect(got.statusCode).toBe(200);
    expect((got.json() as { view: unknown }).view).toBeTruthy();
  });

  it("view.recommendation is null when the engine cannot recommend", async () => {
    const { app, engines } = build();
    const id = await newSession(app);
    engines[0]!.recommend = vi.fn(() => {
      throw new Error("profile incomplete");
    });
    const res = await app.inject({ method: "GET", url: `/v1/agent/session/${id}` });
    const view = (res.json() as { view: { recommendation: unknown; riskYen: unknown; excluded: unknown } }).view;
    expect(view).toMatchObject({ recommendation: null, riskYen: null, excluded: null });
  });

  it("404s on an unknown session for every session route", async () => {
    const { app } = build();
    for (const [method, url, payload] of [
      ["GET", "/v1/agent/session/nope", undefined],
      ["PUT", "/v1/agent/session/nope/profile", { anchors: [] }],
      ["POST", "/v1/agent/session/nope/evidence", { items: [{ type: "like_area", area: "a" }] }],
      ["POST", "/v1/agent/session/nope/recommend", {}],
      ["POST", "/v1/agent/session/nope/why-not", { localityId: "a" }],
      ["POST", "/v1/agent/session/nope/compare", { a: "a", b: "b" }],
      ["POST", "/v1/agent/session/nope/relax", {}],
      ["DELETE", "/v1/agent/evidence/ev1?sessionId=nope", undefined],
    ] as const) {
      const res = await app.inject({ method, url, payload });
      expect(res.statusCode, `${method} ${url}`).toBe(404);
      expect((res.json() as { error: { code: string } }).error.code).toBe("SESSION_NOT_FOUND");
    }
  });

  it("PUT profile computes anchor times, merges refusals and stores the times", async () => {
    const { app, engines, computeAnchorTimes, sessions } = build();
    const id = await newSession(app);
    const res = await app.inject({
      method: "PUT",
      url: `/v1/agent/session/${id}/profile`,
      payload: {
        anchors: [
          { id: "work", label: "Work", stationId: "S1", tripsPerWeek: 5 },
          { id: "bad", label: "Bad", stationId: "??", tripsPerWeek: 1, period: "offpeak" },
        ],
        layout: "1K",
        budget: { value: 150000, firm: true },
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      result: { refusedAnchors: { anchorId: string; reason: string }[] };
      view: { profile: { anchors: { period: string }[] } };
    };
    // the engine's own "no_times" for "bad" is replaced by the real reason, not duplicated
    expect(body.result.refusedAnchors).toEqual([{ anchorId: "bad", reason: "unknown_station", message: "nope" }]);
    expect(body.view.profile.anchors[0]!.period).toBe("peak");
    expect(computeAnchorTimes).toHaveBeenCalledWith(expect.any(Array), features.areas);
    expect(engines[0]!.setProfile).toHaveBeenCalledWith(expect.anything(), { work: [10, 20] });
    expect(sessions.saves).toBe(1);
  });

  it("PUT profile rejects a bad body with a typed 400", async () => {
    const { app } = build();
    const id = await newSession(app);
    const res = await app.inject({
      method: "PUT",
      url: `/v1/agent/session/${id}/profile`,
      payload: { anchors: [{ id: "w", label: "W", tripsPerWeek: -1 }] },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe("VALIDATION_ERROR");
  });

  it("observes evidence in order, reports per-item failures, and removes by id", async () => {
    const { app, sessions } = build();
    const id = await newSession(app);
    const res = await app.inject({
      method: "POST",
      url: `/v1/agent/session/${id}/evidence`,
      payload: {
        items: [
          { type: "like_area", area: "a", quote: "I like a" },
          { type: "like_area", area: "zzz" },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { results: { ok: boolean; id?: string }[]; view: { evidence: { id: string; strength: string }[] } };
    expect(body.results.map((r) => r.ok)).toEqual([true, false]);
    expect(body.view.evidence).toHaveLength(1);
    expect(body.view.evidence[0]!.strength).toBe("normal");

    expect(sessions.saves).toBe(1);

    const evId = body.results[0]!.id!;
    const del = await app.inject({ method: "DELETE", url: `/v1/agent/evidence/${evId}?sessionId=${id}` });
    expect(del.statusCode).toBe(200);
    expect(sessions.saves).toBe(2);
    expect((del.json() as { view: { evidence: unknown[] } }).view.evidence).toHaveLength(0);

    const again = await app.inject({ method: "DELETE", url: `/v1/agent/evidence/${evId}?sessionId=${id}` });
    expect(again.statusCode).toBe(404);
    expect((again.json() as { error: { code: string } }).error.code).toBe("EVIDENCE_NOT_FOUND");

    const noSession = await app.inject({ method: "DELETE", url: `/v1/agent/evidence/${evId}` });
    expect(noSession.statusCode).toBe(400);
  });

  it("rejects malformed evidence with 400", async () => {
    const { app } = build();
    const id = await newSession(app);
    for (const payload of [{ items: [] }, { items: [{ type: "nonsense" }] }, {}]) {
      const res = await app.inject({ method: "POST", url: `/v1/agent/session/${id}/evidence`, payload });
      expect(res.statusCode).toBe(400);
    }
  });

  it("recommend passes k through and validates it", async () => {
    const { app, engines } = build();
    const id = await newSession(app);
    engines[0]!.recommend = vi.fn(() => recommendation);
    const ok = await app.inject({ method: "POST", url: `/v1/agent/session/${id}/recommend`, payload: { k: 3 } });
    expect(ok.statusCode).toBe(200);
    expect(engines[0]!.recommend).toHaveBeenLastCalledWith(3);
    const bad = await app.inject({ method: "POST", url: `/v1/agent/session/${id}/recommend`, payload: { k: 0 } });
    expect(bad.statusCode).toBe(400);
  });

  it("why-not, compare and relax return engine results; compare 404s unknown areas", async () => {
    const { app, sessions } = build();
    const id = await newSession(app);
    const base = `/v1/agent/session/${id}`;
    const why = await app.inject({ method: "POST", url: `${base}/why-not`, payload: { localityId: "b" } });
    expect(why.json()).toEqual({ result: { kind: "is_top_pick", localityId: "b" } });
    const cmp = await app.inject({ method: "POST", url: `${base}/compare`, payload: { a: "a", b: "b" } });
    expect(cmp.json()).toEqual({ result: { a: "a", b: "b", pABeatsB: 0.5 } });
    const missing = await app.inject({ method: "POST", url: `${base}/compare`, payload: { a: "a", b: "q" } });
    expect(missing.statusCode).toBe(404);
    expect((missing.json() as { error: { code: string } }).error.code).toBe("AREA_NOT_FOUND");
    const relax = await app.inject({ method: "POST", url: `${base}/relax`, payload: {} });
    expect(relax.json()).toEqual({ result: [] });
    const badWhy = await app.inject({ method: "POST", url: `${base}/why-not`, payload: {} });
    expect(badWhy.statusCode).toBe(400);
    // read-only routes do not write the session
    expect(sessions.saves).toBe(0);
  });
});

describe("buildApp wiring", () => {
  it("creates a session with the real createEngine from @tokyo/shared", async () => {
    const pool: DbPool = {
      query: vi.fn(async (text: string) => {
        if (text.includes("ORDER BY locality_id")) return { rows: [{ locality_id: "a", name_ja: "a", lat: 1, lon: 1 }] };
        if (text.includes("agent.model_params")) return { rows: [{ key: "rent_land_elasticity", value: 0.36 }] };
        return { rows: [] };
      }),
    };
    const app = buildApp({ config: testConfig(), pool, graphs: emptyGraphs() });
    const res = await app.inject({ method: "POST", url: "/v1/agent/session" });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(typeof (res.json() as { sessionId: unknown }).sessionId).toBe("string");
    // buildApp persists sessions in the database
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO public.agent_sessions"), expect.any(Array));
  });
});

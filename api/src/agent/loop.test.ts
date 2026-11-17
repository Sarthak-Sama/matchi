import type { AgentStreamEvent, AreaFeatures, Engine, Evidence, LoggedEvidence, Profile, Recommendation } from "@tokyo/shared";
import { describe, expect, it, vi } from "vitest";

import { MAX_TOOL_CALLS_PER_TURN, runTurn } from "./loop.js";
import { createScriptedModel, readChatStream } from "./model-client.js";
import type { ScriptedStep } from "./model-client.js";
import type { AgentSession } from "./session.js";
import { createAgentTools } from "./tools.js";
import type { ToolContext } from "./tools.js";

const AREAS = [{ locality_id: "L1" }, { locality_id: "L2" }] as AreaFeatures[];

const REC: Recommendation = {
  shortlist: [
    {
      localityId: "L1", nameEn: "Ebisu", nameJa: "恵比寿", wardNameEn: "Shibuya", rentYen: 82_340,
      commuteMinutes: 23.4, monthlyTravelHours: 16.3, pBest: 0.4567, regretYen: 1_234, role: null,
      breakdown: { rent: -82_340, timeCost: -10_000, features: {} as never, budgetPenalty: 0, capPenalty: 0, total: -92_340 },
      vsMedian: { rent: 0, timeCost: 0, features: {} as never, budgetPenalty: 0, capPenalty: 0, total: 0 },
      confidence: { rent: "near_price_point", landValueNearestM: 100, access: "high", commuteBandMinutes: 4, lateReturnNotCovered: false },
    },
  ],
  feasibleCount: 2, riskYen: 2_345, shouldStop: false, stopReason: null, nextQuestion: null,
  excluded: { nullRent: 0, nullLifestyle: 0, missingAccess: 0, disconnected: 0, overBudgetFirm: 0, overCommuteCapFirm: 0 },
  ess: 3000,
};

function stubEngine() {
  const state: { profile: Profile; log: LoggedEvidence[] } = { profile: { anchors: [], enoughMultipliers: {} } as Profile, log: [] };
  const e = {
    setProfile: vi.fn((p: Profile) => {
      state.profile = p;
      return { profile: p, refusedAnchors: [], feasibleCount: 2, missing: [] };
    }),
    observe: vi.fn((ev: Evidence) => {
      const id = `ev${String(state.log.length + 1)}`;
      state.log.push({ ...ev, id });
      return { ok: true as const, id, predictive: 0.6, surprising: false };
    }),
    removeEvidence: vi.fn(),
    recommend: vi.fn(() => REC),
    whyNot: vi.fn(),
    relax: vi.fn(() => []),
    compare: vi.fn(),
    beliefSummary: vi.fn(() => ({ params: [], ess: 3000, lowConfidence: false, scale: 100_000 })),
    snapshot: vi.fn(() => ({ profile: state.profile, evidence: state.log, seed: 1, questionsAsked: 0 })),
    restore: vi.fn(),
  };
  const engine: Engine = e;
  void engine;
  return Object.defineProperty(e, "profile", { get: () => state.profile }) as typeof e & { readonly profile: Profile };
}

function setup(steps: ScriptedStep[], turns: AgentSession["turns"] = []) {
  const engine = stubEngine();
  const session: AgentSession = { id: "s1", seed: 1, engine, anchorTimes: {}, turns };
  const toolContext: ToolContext = {
    session,
    features: { areas: AREAS, areaIndex: new Map([["L1", 0], ["L2", 1]]) },
    computeAnchorTimes: vi.fn(async (anchors: readonly { id: string }[]) => ({
      times: Object.fromEntries(anchors.map((a) => [a.id, [10, 20]])),
      refused: [],
    })),
    pool: { query: vi.fn() },
    queryAreasEnabled: false,
  };
  const model = createScriptedModel(steps);
  const events: AgentStreamEvent[] = [];
  const run = (message: string) =>
    runTurn({
      message,
      model,
      tools: createAgentTools(() => ["1LDK"]),
      toolContext,
      columnComments: { rent_per_sqm_yen: "Modelled rent per square metre, yen" },
      emit: (e) => events.push(e),
    });
  return { engine, session, model, events, run };
}

const PROFILE_CALL = {
  name: "set_profile",
  input: { anchors: [{ label: "office", stationId: "S1", tripsPerWeek: 5 }], budget: { value: 100_000, firm: true } },
};
const OBSERVE_CALL = {
  name: "observe",
  input: { items: [{ type: "direction", feature: "green_space", sign: 1, quote: "I like parks" }] },
};
const GROUNDED = "Ebisu leads: modelled rent ¥82,000, about 23 minutes to the office, a 46% chance of being best.";

describe("runTurn", () => {
  it("emits tool calls, a harness recommend, grounded text, grounding, state and done in order", async () => {
    const t = setup([{ toolCalls: [PROFILE_CALL, OBSERVE_CALL] }, { text: GROUNDED }]);
    await t.run("I work in Shibuya, budget 100k, I like parks");
    expect(t.events.map((e) => (e.type === "tool_call" || e.type === "tool_result" ? `${e.type}:${e.name}` : e.type))).toEqual([
      "tool_call:set_profile",
      "tool_result:set_profile",
      "tool_call:observe",
      "tool_result:observe",
      "tool_call:recommend",
      "tool_result:recommend",
      "text",
      "grounding",
      "state",
      "done",
    ]);
    expect(t.events.find((e) => e.type === "text")).toEqual({ type: "text", delta: GROUNDED });
    expect(t.events.find((e) => e.type === "grounding")).toEqual({ type: "grounding", pass: true, failures: [] });
    const state = t.events.find((e) => e.type === "state");
    expect(state?.type === "state" && state.state.recommendation?.shortlist[0]?.localityId).toBe("L1");
    expect(state?.type === "state" && state.state.evidence).toHaveLength(1);
    // The second model call saw the harness recommend result.
    const second = t.model.requests[1]!.messages;
    expect(second.some((m) => m.role === "tool" && m.tool_call_id.startsWith("harness_recommend") && m.content.includes("82000"))).toBe(true);
    expect(t.session.turns).toEqual([
      { role: "user", content: "I work in Shibuya, budget 100k, I like parks" },
      { role: "assistant", content: GROUNDED },
    ]);
    // System prompt carries the state summary and column comments.
    const system = t.model.requests[0]!.messages[0]!;
    expect(system.role === "system" && system.content).toMatch(/untrusted_text/);
    expect(system.role === "system" && system.content).toMatch(/rent_per_sqm_yen: Modelled rent/);
  });

  it("does not add a recommend when the model already called it after the change", async () => {
    const t = setup([{ toolCalls: [OBSERVE_CALL, { name: "recommend", input: {} }] }, { text: GROUNDED }]);
    await t.run("parks");
    expect(t.events.filter((e) => e.type === "tool_call").map((e) => e.type === "tool_call" && e.name)).toEqual(["observe", "recommend"]);
  });

  it("on a grounding failure sends one correction and takes the retry", async () => {
    const t = setup([
      { toolCalls: [{ name: "recommend", input: {} }] },
      { text: "Ebisu rent is ¥95,000 a month." },
      { text: GROUNDED },
    ]);
    await t.run("what do you suggest?");
    const types = t.events.map((e) => e.type);
    expect(types.slice(-5)).toEqual(["grounding", "text", "grounding", "state", "done"]);
    const [first, last] = t.events.filter((e) => e.type === "grounding");
    expect(first).toMatchObject({ pass: false, failures: [{ figure: "¥95,000", context: "Ebisu rent is ¥95,000 a month." }] });
    expect(last).toEqual({ type: "grounding", pass: true, failures: [] });
    expect(t.events.find((e) => e.type === "text")).toEqual({ type: "text", delta: GROUNDED });
    expect(t.model.requests).toHaveLength(3);
    const retry = t.model.requests[2]!;
    expect(retry.tools).toBeUndefined();
    const lastMsg = retry.messages.at(-1)!;
    expect(lastMsg.role === "user" && lastMsg.content).toMatch(/¥95,000/);
  });

  it("drops sentences that still fail after the retry", async () => {
    const t = setup([
      { toolCalls: [{ name: "recommend", input: {} }] },
      { text: "Rent is ¥95,000." },
      { text: "Ebisu has a 46% chance of being best. Rent is ¥91,000." },
    ]);
    await t.run("hi");
    expect(t.events.find((e) => e.type === "text")).toEqual({ type: "text", delta: "Ebisu has a 46% chance of being best." });
    expect(t.events.filter((e) => e.type === "grounding").at(-1)).toMatchObject({ pass: false, failures: [{ figure: "¥91,000" }] });
  });

  it("caps tool calls per turn and keeps the last 8 turns of context", async () => {
    const many = Array.from({ length: MAX_TOOL_CALLS_PER_TURN + 2 }, () => ({ name: "relax", input: {} }));
    const history = Array.from({ length: 20 }, (_, i) => ({ role: i % 2 === 0 ? ("user" as const) : ("assistant" as const), content: `m${String(i)}` }));
    const t = setup([{ toolCalls: many }, { text: "Done." }], history);
    await t.run("go");
    const results = t.events.filter((e) => e.type === "tool_result");
    expect(results.filter((e) => e.type === "tool_result" && e.ok)).toHaveLength(MAX_TOOL_CALLS_PER_TURN);
    expect(results.at(-1)).toMatchObject({ ok: false, result: { code: "budget_exceeded" } });
    // After the budget, the model is offered no tools.
    expect(t.model.requests[1]!.tools).toBeUndefined();
    const first = t.model.requests[0]!.messages;
    expect(first).toHaveLength(1 + 16 + 1);
    expect(first[1]).toEqual({ role: "user", content: "m4" });
  });

  it("turns a model failure into an error event followed by done", async () => {
    const t = setup([
      () => {
        throw new Error("upstream 500");
      },
    ]);
    await t.run("hi");
    expect(t.events).toEqual([{ type: "error", code: "TURN_FAILED", message: "upstream 500" }, { type: "done" }]);
  });
});

describe("readChatStream", () => {
  it("assembles text and tool calls from OpenAI-style chunks", async () => {
    const chunks = [
      'data: {"choices":[{"delta":{"content":"Hel"}}]}\n',
      'data: {"choices":[{"delta":{"content":"lo","tool_calls":[{"index":0,"id":"c1","function":{"name":"recommend","arguments":"{\\"k\\""}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":":3}"}}]}}]}\n',
      "data: [DONE]\n",
    ];
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const c of chunks) controller.enqueue(new TextEncoder().encode(c));
        controller.close();
      },
    });
    const deltas: string[] = [];
    const r = await readChatStream(body, (d) => deltas.push(d));
    expect(r).toEqual({ text: "Hello", toolCalls: [{ id: "c1", name: "recommend", arguments: '{"k":3}' }] });
    expect(deltas).toEqual(["Hel", "lo"]);
  });
});

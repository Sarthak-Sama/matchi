import type { AreaFeatures, Engine, Evidence, LoggedEvidence, Profile, Recommendation } from "@tokyo/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AgentSession } from "./session.js";
import type { AgentPool, ToolContext } from "./tools.js";
import { createAgentTools, roundRent } from "./tools.js";

function area(id: string, nameEn: string): AreaFeatures {
  return {
    locality_id: id, name_en: nameEn, name_ja: `${nameEn}町`, ward_code: "13113", ward_name_en: "Shibuya",
    ward_name_ja: "渋谷区", lat: 35.66, lon: 139.7, rent_per_sqm_yen: 3000, management_fee_yen: 8000,
    land_price_used_fallback: false, land_value_yen_per_sqm: 1e6, land_value_nearest_m: 200,
    supermarket_count: 3, restaurant_count: 20, cafe_count: 5, convenience_count: 4, cuisine_variety_count: 6,
    late_night_count: 2, health_count: 3, green_space_share: 0.1, residential_zoning_share: 0.5,
    road_rail_exposure_share: 0.2, bar_count: 3, line_count: 2, reach_restaurant: 100,
    nearest_station_walk_min: 6, access_confidence: "high",
  };
}

const AREAS = [area("L1", "Ebisu"), area("L2", "Hiroo")];

const REC: Recommendation = {
  shortlist: [
    {
      localityId: "L1", nameEn: "Ebisu", nameJa: "恵比寿", wardNameEn: "Shibuya", rentYen: 82_340,
      commuteMinutes: 23.4, monthlyTravelHours: 16.27, pBest: 0.4567, regretYen: 1234, role: null,
      breakdown: { rent: -82_340, timeCost: -10_000, features: {} as never, budgetPenalty: 0, capPenalty: 0, total: -92_340 },
      vsMedian: { rent: 0, timeCost: 0, features: {} as never, budgetPenalty: 0, capPenalty: 0, total: 0 },
      confidence: { rent: "near_price_point", landValueNearestM: 100, access: "high", commuteBandMinutes: 3.6, lateReturnNotCovered: false },
    },
  ],
  feasibleCount: 2, riskYen: 2_345, shouldStop: false, stopReason: null,
  nextQuestion: { kind: "pair", a: "L1", b: "L2", pABeatsB: 0.512 },
  excluded: { uninhabited: 0, nullRent: 0, nullLifestyle: 0, missingAccess: 0, disconnected: 0, overBudgetFirm: 0, overCommuteCapFirm: 0 },
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
      return { ok: true as const, id, predictive: 0.634, surprising: false };
    }),
    removeEvidence: vi.fn((id: string) => {
      state.log = state.log.filter((x) => x.id !== id);
    }),
    recommend: vi.fn(() => REC),
    whyNot: vi.fn((id: string) => ({ kind: "dominated" as const, localityId: id, gapYen: 4_321 })),
    relax: vi.fn(() => []),
    compare: vi.fn((a: string, b: string) => ({ a, b, diff: REC.shortlist[0]!.vsMedian, pABeatsB: 0.6 })),
    beliefSummary: vi.fn(() => ({ params: [], ess: 3000, lowConfidence: false, scale: 100_000 })),
    snapshot: vi.fn(() => ({ profile: state.profile, evidence: state.log, seed: 1, questionsAsked: 0 })),
    restore: vi.fn(),
  };
  const engine: Engine = e;
  void engine;
  return Object.defineProperty(e, "profile", { get: () => state.profile }) as typeof e & { readonly profile: Profile };
}

function ctx(overrides: Partial<ToolContext> = {}) {
  const engine = stubEngine();
  const session: AgentSession = { id: "s1", seed: 1, engine, anchorTimes: {}, turns: [] };
  const computeAnchorTimes = vi.fn(async (anchors: readonly { id: string }[]) => ({
    times: Object.fromEntries(anchors.map((a) => [a.id, [10, 20]])),
    refused: [],
  }));
  const context: ToolContext = {
    session,
    features: { areas: AREAS, areaIndex: new Map(AREAS.map((a, i) => [a.locality_id, i])) },
    computeAnchorTimes,
    pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
    queryAreasEnabled: false,
    ...overrides,
  };
  return { context, engine, computeAnchorTimes };
}

const tools = createAgentTools(() => ["1K", "1LDK"]);

afterEach(() => vi.restoreAllMocks());

describe("agent tools", () => {
  it("exposes nine tools with JSON schemas", () => {
    expect(tools.specs.map((s) => s.name)).toEqual([
      "lookup", "set_profile", "observe", "remove_evidence", "recommend", "why_not", "relax", "compare", "query_areas",
    ]);
    for (const spec of tools.specs) expect(spec.parameters["type"]).toBe("object");
  });

  it("leaves query_areas out of specs when disabled, but a stray call still gets the typed disabled result", async () => {
    const off = createAgentTools(() => ["1K"], { queryAreasEnabled: false });
    expect(off.specs.map((s) => s.name)).not.toContain("query_areas");
    expect(off.specs).toHaveLength(8);
    const { context } = ctx();
    expect(await off.run("query_areas", { sql: "select 1" }, context)).toMatchObject({ ok: false, error: { code: "disabled" } });
    const on = createAgentTools(() => ["1K"], { queryAreasEnabled: true });
    expect(on.specs.map((s) => s.name)).toContain("query_areas");
  });

  it("returns typed errors for bad JSON, bad input and unknown tools", async () => {
    const { context } = ctx();
    expect(await tools.run("nope", "{}", context)).toMatchObject({ ok: false, error: { code: "unknown_tool" } });
    expect(await tools.run("lookup", "{not json", context)).toMatchObject({ ok: false, error: { code: "invalid_input" } });
    expect(await tools.run("lookup", { kind: "zoo", query: "x" }, context)).toMatchObject({ ok: false, error: { code: "invalid_input" } });
  });

  it("looks up areas in memory with names as untrusted_text", async () => {
    const { context } = ctx();
    const r = await tools.run("lookup", { kind: "area", query: "ebi" }, context);
    expect(r).toMatchObject({ ok: true, result: { matches: [{ area_id: "L1", names: { untrusted_text: { name_en: "Ebisu" } } }] } });
  });

  it("looks up stations through the pool and labels station ids", async () => {
    const pool: AgentPool = { query: vi.fn().mockResolvedValue({ rows: [{ id: "S1", nameEn: "Shibuya", nameJa: "渋谷", lat: 35.658, lon: 139.7016 }] }) };
    const { context } = ctx({ pool });
    const r = await tools.run("lookup", { kind: "station", query: "shib" }, context);
    expect(r).toMatchObject({ ok: true, result: { matches: [{ station_id: "S1" }] } });
    expect((pool.query as ReturnType<typeof vi.fn>).mock.calls[0]![1]).toEqual(["shib", 5]);
  });

  it("set_profile computes anchor times before engine.setProfile and merges partial updates", async () => {
    const { context, engine, computeAnchorTimes } = ctx();
    const r = await tools.run(
      "set_profile",
      { anchors: [{ label: "office", stationId: "S1", tripsPerWeek: 5 }], budget: { value: 100_000, firm: true }, layout: "1LDK" },
      context,
    );
    expect(r.ok).toBe(true);
    expect(computeAnchorTimes.mock.invocationCallOrder[0]!).toBeLessThan(engine.setProfile.mock.invocationCallOrder[0]!);
    expect(context.session.anchorTimes).toEqual({ anchor_1: [10, 20] });
    await tools.run("set_profile", { commuteCap: { value: 40, firm: false } }, context);
    expect(engine.profile).toMatchObject({ layout: "1LDK", budget: { value: 100_000 }, commuteCap: { value: 40 } });
    expect(await tools.run("set_profile", { layout: "9LDK" }, context)).toMatchObject({ ok: false, error: { code: "unknown_layout" } });
  });

  it("set_profile reports a typed error when anchor times fail", async () => {
    const { context } = ctx({ computeAnchorTimes: vi.fn().mockRejectedValue(new Error("graph")) });
    const r = await tools.run("set_profile", { anchors: [{ label: "x", stationId: "S1", tripsPerWeek: 1 }] }, context);
    expect(r).toMatchObject({ ok: false, error: { code: "anchor_times_unavailable" } });
  });

  it("observe rounds predictive to a whole percent; remove_evidence checks ids", async () => {
    const { context } = ctx();
    const r = await tools.run("observe", { items: [{ type: "direction", feature: "green_space", sign: 1, quote: "parks" }] }, context);
    expect(r).toMatchObject({ ok: true, result: { items: [{ id: "ev1", how_expected_percent: 63, surprising: false }] } });
    expect(await tools.run("remove_evidence", { id: "zzz" }, context)).toMatchObject({ ok: false, error: { code: "unknown_evidence_id" } });
    expect(await tools.run("remove_evidence", { id: "ev1" }, context)).toMatchObject({ ok: true });
  });

  it("recommend rounds rent, minutes and probabilities and labels every figure", async () => {
    const { context } = ctx();
    const r = await tools.run("recommend", {}, context);
    expect(r.ok).toBe(true);
    const item = (r as { result: { shortlist: Record<string, unknown>[] } }).result.shortlist[0]!;
    expect(item).toMatchObject({ rent_yen: 82_000, commute_minutes: 23, chance_best_percent: 46, regret_yen: 1_200 });
    expect(item["rent_label"]).toMatch(/modelled/);
    expect(roundRent(82_500)).toBe(83_000);
    expect(r).toMatchObject({ result: { next_question: { kind: "pair", a_beats_b_percent: 51 }, value_at_risk_yen: 2_300 } });
  });

  it("recommend turns an engine throw into profile_incomplete", async () => {
    const { context, engine } = ctx();
    engine.recommend.mockImplementation(() => {
      throw new Error("needs an anchor");
    });
    expect(await tools.run("recommend", {}, context)).toMatchObject({ ok: false, error: { code: "profile_incomplete" } });
  });

  it("why_not and compare refuse unknown areas", async () => {
    const { context } = ctx();
    expect(await tools.run("why_not", { area_id: "L9" }, context)).toMatchObject({ ok: false, error: { code: "unknown_area" } });
    expect(await tools.run("why_not", { area_id: "L2" }, context)).toMatchObject({ ok: true, result: { kind: "dominated", gap_yen: 4_300 } });
    expect(await tools.run("compare", { a: "L1", b: "L1" }, context)).toMatchObject({ ok: false, error: { code: "same_area" } });
    expect(await tools.run("compare", { a: "L1", b: "L2" }, context)).toMatchObject({ ok: true, result: { a_beats_b_percent: 60 } });
  });

  it("maps an engine unknown_area throw to a typed error", async () => {
    const { context, engine } = ctx();
    engine.compare.mockImplementation(() => {
      throw Object.assign(new Error("no utility for L2"), { code: "unknown_area" });
    });
    expect(await tools.run("compare", { a: "L1", b: "L2" }, context)).toMatchObject({ ok: false, error: { code: "unknown_area" } });
  });

  it("query_areas is disabled by default", async () => {
    const { context } = ctx();
    expect(await tools.run("query_areas", { sql: "SELECT 1 FROM agent.area_features" }, context)).toMatchObject({
      ok: false,
      error: { code: "disabled" },
    });
  });

  it("query_areas, when enabled, runs guarded SQL read-only with a timeout and rolls back", async () => {
    const queries: string[] = [];
    const release = vi.fn();
    const client = {
      query: vi.fn(async (sql: string) => {
        queries.push(sql);
        return { rows: sql.startsWith("SELECT *") ? [{ locality_id: "L1", n: 3 }] : [] };
      }),
      release,
    };
    const { context } = ctx({ queryAreasEnabled: true, agentReadPool: { query: vi.fn(), connect: vi.fn(async () => client) } });
    expect(await tools.run("query_areas", { sql: "DELETE FROM agent.area_features" }, context)).toMatchObject({
      ok: false,
      error: { code: "sql_rejected" },
    });
    const r = await tools.run("query_areas", { sql: "SELECT locality_id, 3 AS n FROM agent.area_features" }, context);
    expect(r).toMatchObject({ ok: true, result: { rows: [{ locality_id: { untrusted_text: "L1" }, n: 3 }] } });
    expect(queries).toEqual([
      "BEGIN READ ONLY",
      "SET LOCAL search_path = agent",
      "SET LOCAL statement_timeout = '5s'",
      "SELECT * FROM (SELECT locality_id, 3 AS n FROM agent.area_features) q LIMIT 50",
      "ROLLBACK",
    ]);
    expect(release).toHaveBeenCalledOnce();
  });
});

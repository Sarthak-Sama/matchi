import { ProfileSchema } from "@tokyo/shared";
import type { AreaFeatures, CreateEngine, Engine, ModelParams, SessionState } from "@tokyo/shared";
import { describe, expect, it, vi } from "vitest";

import type { DbPool } from "../db.js";
import { MAX_STORED_TURNS, MemorySessionStore, PgSessionStore } from "./session.js";

const areas = [{ locality_id: "a" }] as AreaFeatures[];
const params: ModelParams = { rentElasticity: 0.36, layoutAreaSqm: {} };
const STATE: SessionState = { profile: ProfileSchema.parse({}), evidence: [], seed: 42, questionsAsked: 0 };
const ID = "6f1c2a4e-1b2c-4d3e-8f90-123456789abc";

function fakeEngine(state: SessionState = STATE): Engine {
  return { snapshot: vi.fn(() => state), restore: vi.fn() } as unknown as Engine;
}

describe("MemorySessionStore", () => {
  it("creates sessions with unique ids, the injected engine and a seed", async () => {
    const createEngine = vi.fn((() => ({}) as Engine) as CreateEngine);
    const store = new MemorySessionStore(createEngine, { areas, params }, { makeSeed: () => 42 });
    const s1 = await store.create();
    const s2 = await store.create();
    expect(s1.id).not.toBe(s2.id);
    expect(s1.seed).toBe(42);
    expect(s1.anchorTimes).toEqual({});
    expect(s1.turns).toEqual([]);
    expect(createEngine).toHaveBeenCalledWith(areas, params, 42);
    expect(await store.get(s1.id)).toBe(s1);
    expect(await store.get("nope")).toBeUndefined();
    await store.save(s1);
    expect(store.saves).toBe(1);
  });
});

describe("PgSessionStore", () => {
  it("create inserts the snapshot and cleans up old rows; a cleanup failure does not fail create", async () => {
    const query = vi.fn(async (text: string) => {
      if (text.includes("DELETE")) throw new Error("cleanup down");
      return { rows: [] };
    });
    const engine = fakeEngine();
    const store = new PgSessionStore({ query }, () => engine, { areas, params }, { makeSeed: () => 42, makeId: () => ID });
    const session = await store.create();
    expect(session).toMatchObject({ id: ID, seed: 42, anchorTimes: {}, turns: [] });
    expect(query).toHaveBeenCalledTimes(2);
    const [insertSql, insertParams] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(insertSql).toContain("INSERT INTO public.agent_sessions");
    expect(insertParams).toEqual([ID, JSON.stringify(STATE)]);
    expect(query.mock.calls[1]![0]).toContain("DELETE FROM public.agent_sessions");
  });

  it("get returns undefined for a non-UUID id without querying", async () => {
    const query = vi.fn();
    const store = new PgSessionStore({ query } as DbPool, () => fakeEngine(), { areas, params });
    expect(await store.get("nope")).toBeUndefined();
    expect(query).not.toHaveBeenCalled();
  });

  it("get rebuilds the engine from the stored seed and restores state and anchor times", async () => {
    const state = { ...STATE, seed: 7 };
    const query = vi.fn(async () => ({
      rows: [{ state, anchor_times: { work: [10, null] }, turns: [{ role: "user", content: "hi" }, { bad: 1 }] }],
    }));
    const engine = fakeEngine();
    const createEngine = vi.fn(() => engine);
    const store = new PgSessionStore({ query }, createEngine, { areas, params });
    const session = await store.get(ID);
    expect(createEngine).toHaveBeenCalledWith(areas, params, 7);
    const times = session!.anchorTimes["work"]!;
    expect(Array.from(times)).toEqual([10, Number.NaN]);
    expect(engine.restore).toHaveBeenCalledWith(state, session!.anchorTimes);
    expect(session).toMatchObject({ id: ID, seed: 7, turns: [{ role: "user", content: "hi" }] });
  });

  it("get treats a missing row or an unreadable state as no session", async () => {
    const rows: unknown[][] = [[], [{ state: { nonsense: true }, anchor_times: {}, turns: [] }]];
    const query = vi.fn(async () => ({ rows: rows.shift() }));
    const store = new PgSessionStore({ query }, () => fakeEngine(), { areas, params });
    expect(await store.get(ID)).toBeUndefined();
    expect(await store.get(ID)).toBeUndefined();
  });

  it("save writes the snapshot, anchor times with NaN as null, and the last turns", async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    const store = new PgSessionStore({ query }, () => fakeEngine(), { areas, params });
    const turns = Array.from({ length: MAX_STORED_TURNS + 4 }, (_, i) => ({
      role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
      content: String(i),
    }));
    await store.save({ id: ID, seed: 42, engine: fakeEngine(), anchorTimes: { work: Float64Array.from([5, Number.NaN]) }, turns });
    const [sql, values] = query.mock.calls[0] as unknown as [string, string[]];
    expect(sql).toContain("UPDATE public.agent_sessions");
    expect(values[0]).toBe(ID);
    expect(JSON.parse(values[1]!)).toEqual(STATE);
    expect(JSON.parse(values[2]!)).toEqual({ work: [5, null] });
    const saved = JSON.parse(values[3]!) as { content: string }[];
    expect(saved).toHaveLength(MAX_STORED_TURNS);
    expect(saved[0]!.content).toBe("4");
  });
});

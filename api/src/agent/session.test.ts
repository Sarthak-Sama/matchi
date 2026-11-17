import type { AreaFeatures, CreateEngine, Engine, ModelParams } from "@tokyo/shared";
import { describe, expect, it, vi } from "vitest";

import { SessionStore } from "./session.js";

const areas = [{ locality_id: "a" }] as AreaFeatures[];
const params: ModelParams = { rentElasticity: 0.36, layoutAreaSqm: {} };

describe("SessionStore", () => {
  it("creates sessions with unique ids, the injected engine and a seed", () => {
    const createEngine = vi.fn((() => ({}) as Engine) as CreateEngine);
    const store = new SessionStore(createEngine, { areas, params }, { makeSeed: () => 42 });
    const s1 = store.create();
    const s2 = store.create();
    expect(s1.id).not.toBe(s2.id);
    expect(s1.seed).toBe(42);
    expect(s1.anchorTimes).toEqual({});
    expect(s1.turns).toEqual([]);
    expect(createEngine).toHaveBeenCalledWith(areas, params, 42);
    expect(store.get(s1.id)).toBe(s1);
    expect(store.get("nope")).toBeUndefined();
  });

  it("drops the oldest session past maxSessions", () => {
    const store = new SessionStore(() => ({}) as Engine, { areas, params }, { maxSessions: 2 });
    const [a, b, c] = [store.create(), store.create(), store.create()];
    expect(store.get(a.id)).toBeUndefined();
    expect(store.get(b.id)).toBe(b);
    expect(store.get(c.id)).toBe(c);
  });
});

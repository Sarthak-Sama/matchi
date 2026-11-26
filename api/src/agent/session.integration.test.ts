import { createEngine, createRng } from "@tokyo/shared";
import type { AreaFeatures, ModelParams } from "@tokyo/shared";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";

import { buildView } from "../routes/agent-direct.js";
import { PgSessionStore, SessionConflictError } from "./session.js";

// Writes and deletes its own rows in public.agent_sessions (migration 0019).
// Runs only when DATABASE_URL points at a local database; the repo-wide vitest
// guard also requires a _test database name or ALLOW_DESTRUCTIVE_TESTS=1.
const url = process.env["DATABASE_URL"] ?? "";
const isLocal = /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url);

// Synthetic areas, generated from a seed; not real data.
function syntheticAreas(n: number): AreaFeatures[] {
  const rng = createRng(7);
  return Array.from({ length: n }, (_, i): AreaFeatures => ({
    locality_id: `syn-${String(i).padStart(3, "0")}`,
    name_en: `Synthetic ${String(i)}`,
    name_ja: `合成${String(i)}`,
    ward_code: `9990${String(i % 3)}`,
    ward_name_en: `Synthetic ward ${String(i % 3)}`,
    ward_name_ja: `合成区${String(i % 3)}`,
    lat: 35.6 + rng.next() * 0.1,
    lon: 139.6 + rng.next() * 0.1,
    rent_per_sqm_yen: 2500 + (i % 3) * 400,
    management_fee_yen: 4000,
    land_price_used_fallback: false,
    land_value_yen_per_sqm: 400000 * rng.lognormal(0, 0.4),
    land_value_nearest_m: 50 + rng.next() * 800,
    supermarket_count: rng.int(20),
    restaurant_count: rng.int(150),
    cafe_count: rng.int(40),
    convenience_count: rng.int(30),
    cuisine_variety_count: rng.int(40),
    late_night_count: rng.int(15),
    health_count: rng.int(30),
    green_space_share: rng.next() * 0.3,
    residential_zoning_share: rng.next(),
    road_rail_exposure_share: rng.next() * 0.8,
    bar_count: rng.int(40),
    line_count: 1 + rng.int(6),
    reach_restaurant: rng.next() * 100,
    nearest_station_walk_min: 2 + rng.int(15),
    access_confidence: "low",
  }));
}

const params: ModelParams = {
  rentElasticity: 0.356,
  layoutAreaSqm: { "1R": 21, "1K": 24, "1DK": 30, "1LDK": 38, "2K_2DK": 43, "2LDK": 55, "3LDK": 70 },
};

describe.skipIf(!isLocal)("PgSessionStore against the local database", () => {
  const pool = new Pool({ connectionString: url, max: 2 });
  const created: string[] = [];
  afterAll(async () => {
    if (created.length > 0) await pool.query("DELETE FROM public.agent_sessions WHERE id = ANY($1::uuid[])", [created]);
    await pool.end();
  });

  it("a session saved by one store loads identically in a fresh store", async () => {
    const areas = syntheticAreas(30);
    const features = { areas, params };
    const writer = new PgSessionStore(pool, createEngine, features);
    const session = await writer.create();
    created.push(session.id);

    // One unreachable area, stored as null and read back as NaN.
    const minutes = areas.map((_, i) => (i === 5 ? Number.NaN : 10 + i * 2));
    session.anchorTimes = { work: Float64Array.from(minutes) };
    session.engine.setProfile(
      {
        anchors: [{ id: "work", label: "Office", tripsPerWeek: 5, period: "peak" }],
        layout: "1K",
        budget: { value: 100000, firm: false },
        enoughMultipliers: {},
      },
      session.anchorTimes,
    );
    const liked = session.engine.observe({ type: "like_area", area: "syn-003", strength: "normal", quote: "I like it" });
    const picked = session.engine.observe({ type: "pick_from_set", chosen: "syn-001", set: ["syn-001", "syn-002", "syn-004"], strength: "normal" });
    expect(liked.ok && picked.ok).toBe(true);
    session.turns.push({ role: "user", content: "Office in Shibuya, 100k" }, { role: "assistant", content: "Noted." });
    await writer.save(session);

    const reader = new PgSessionStore(pool, createEngine, features);
    const loaded = await reader.get(session.id);
    expect(loaded).toBeDefined();
    expect(loaded!.seed).toBe(session.seed);
    expect(loaded!.turns).toEqual(session.turns);
    expect(Array.from(loaded!.anchorTimes["work"]!)).toEqual(minutes);
    expect(loaded!.engine.snapshot()).toEqual(session.engine.snapshot());
    expect(buildView(loaded!.engine)).toEqual(buildView(session.engine));
    expect(buildView(loaded!.engine).evidence).toHaveLength(2);
  });

  it("leases a session to one holder and rejects a save from a stale version", async () => {
    const store = new PgSessionStore(pool, createEngine, { areas: syntheticAreas(3), params });
    const session = await store.create();
    created.push(session.id);

    const first = await store.acquire(session.id, 60_000);
    expect(first?.version).toBe(0);
    expect(await store.acquire(session.id, 60_000)).toBeNull();
    await store.release(session.id, first!);
    const second = await store.acquire(session.id, 60_000);
    expect(second?.version).toBe(0);
    await store.release(session.id, second!);

    const stale = await store.get(session.id);
    await store.save(session);
    expect(session.version).toBe(1);
    await expect(store.save(stale!)).rejects.toBeInstanceOf(SessionConflictError);
  });

  it("returns undefined for an unknown or malformed id", async () => {
    const store = new PgSessionStore(pool, createEngine, { areas: syntheticAreas(3), params });
    expect(await store.get("00000000-0000-4000-8000-000000000000")).toBeUndefined();
    expect(await store.get("not-a-uuid")).toBeUndefined();
  });
});

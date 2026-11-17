import { describe, expect, it } from "vitest";

import { EvidenceSchema } from "../../../../shared/src/engine/types";
import { comparisonRows, describeWhyNot } from "./explain";
import {
  answersFor,
  cheaper,
  closer,
  dislikeArea,
  featureDirection,
  likeArea,
  preferOverNeighbour,
  quieter,
  withoutId,
} from "./evidence";
import { EMPTY_FORM, buildProfile } from "./profile";
import { SseParser } from "./sse";
import { entryFromEvent } from "./trace";
import type { ShortlistItem } from "./types";

// MOCK: test-only shortlist items; not real areas.
function mockItem(id: string, nameEn: string | null = `Mock ${id}`): ShortlistItem {
  return { localityId: id, nameEn, nameJa: `モック${id}` } as unknown as ShortlistItem;
}
const names = (id: string) => `N(${id})`;

describe("engine-only evidence builders", () => {
  it("produce items the Evidence schema accepts", () => {
    const items = [
      quieter(),
      cheaper("weak"),
      closer("strong"),
      featureDirection("green_space", -1),
      likeArea(mockItem("a")),
      dislikeArea(mockItem("a")),
      preferOverNeighbour([mockItem("a"), mockItem("b")], 0)!,
      ...answersFor({ kind: "pair", a: "a", b: "b", pABeatsB: 0.5 }, names).map((x) => x.evidence),
      ...answersFor({ kind: "pick_from_shortlist", set: ["a", "b", "c"] }, names).map((x) => x.evidence),
    ];
    for (const e of items) expect(EvidenceSchema.safeParse(e).success, JSON.stringify(e)).toBe(true);
  });

  it("prefers a card over its neighbour, and the last card over the one above", () => {
    const list = [mockItem("a"), mockItem("b"), mockItem("c")];
    expect(preferOverNeighbour(list, 0)).toMatchObject({ type: "prefer_area", a: "a", b: "b" });
    expect(preferOverNeighbour(list, 2)).toMatchObject({ type: "prefer_area", a: "c", b: "b" });
    expect(preferOverNeighbour([mockItem("a")], 0)).toBeNull();
  });

  it("cheaper and closer are opposite answers to the same trade", () => {
    const c = cheaper();
    const f = closer();
    expect(c).toMatchObject({ type: "time_tradeoff", accept: false });
    expect(f).toMatchObject({ type: "time_tradeoff", accept: true });
  });

  it("withoutId drops only the id", () => {
    expect(withoutId({ ...quieter(), id: "e1" })).toEqual(quieter());
  });
});

describe("SseParser", () => {
  const ev = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;

  it("parses events split across chunks and ignores comments and junk", () => {
    const p = new SseParser();
    const text = ev({ type: "text", delta: "Hi" }) + ": keepalive\n\n" + "data: not json\n\n" + ev({ type: "done" });
    const cut = 10;
    const out = [...p.push(text.slice(0, cut)), ...p.push(text.slice(cut))];
    expect(out).toEqual([{ type: "text", delta: "Hi" }, { type: "done" }]);
  });

  it("handles CRLF and event: lines, and flushes a trailing message", () => {
    const p = new SseParser();
    const out = p.push(`event: x\r\ndata: {"type":"text","delta":"a"}\r\n\r\ndata: {"type":"done"}`);
    expect(out).toEqual([{ type: "text", delta: "a" }]);
    expect(p.flush()).toEqual([{ type: "done" }]);
  });

  it("skips unknown event types", () => {
    const p = new SseParser();
    expect(p.push(ev({ type: "mystery" }))).toEqual([]);
  });
});

describe("trace entries", () => {
  it("marks a failed grounding check bad and lists the figures", () => {
    const e = entryFromEvent({ type: "grounding", pass: false, failures: [{ figure: "¥99,000", context: "rent" }] });
    expect(e?.tone).toBe("bad");
    expect(e?.summary).toContain("FAIL");
    expect(e?.detail).toEqual([{ figure: "¥99,000", context: "rent" }]);
  });
  it("traces tool calls and results, not text deltas", () => {
    expect(entryFromEvent({ type: "text", delta: "x" })).toBeNull();
    expect(entryFromEvent({ type: "tool_call", id: "1", name: "observe", input: {} })?.summary).toBe("call observe");
    expect(entryFromEvent({ type: "tool_result", id: "1", name: "observe", ok: false, result: {} })?.tone).toBe("bad");
  });
});

describe("buildProfile", () => {
  it("builds a station anchor, limits and layout", () => {
    const r = buildProfile({
      ...EMPTY_FORM,
      anchor: { label: "Mock station", stationId: "sg-mock" },
      budget: "120000",
      commuteCap: "40",
      commuteCapFirm: false,
      layout: "1K",
    });
    expect(r).toMatchObject({
      ok: true,
      profile: {
        anchors: [{ id: "main", stationId: "sg-mock", tripsPerWeek: 5, period: "peak" }],
        budget: { value: 120000, firm: true },
        commuteCap: { value: 40, firm: false },
        layout: "1K",
        enoughMultipliers: {},
      },
    });
  });
  it("rejects non-positive input and allows an empty profile", () => {
    expect(buildProfile({ ...EMPTY_FORM, budget: "-5" }).ok).toBe(false);
    expect(buildProfile({ ...EMPTY_FORM, anchor: { label: "x", stationId: "s" }, tripsPerWeek: "0" }).ok).toBe(false);
    expect(buildProfile(EMPTY_FORM)).toMatchObject({ ok: true, profile: { anchors: [] } });
  });
});

describe("explanations", () => {
  it("copies figures from the why-not result", () => {
    const s = describeWhyNot(
      { kind: "fails_firm_limit", localityId: "a", limit: "budget", by: 12345, unit: "yen" },
      names,
    );
    expect(s).toContain("¥12,345");
    expect(describeWhyNot({ kind: "is_top_pick", localityId: "a" }, names)).toContain("top pick");
  });
  it("lists only non-zero comparison terms, largest first", () => {
    const zero = { rent: 0, timeCost: -3000, budgetPenalty: 0, capPenalty: 0, total: 0 };
    const features = Object.fromEntries(
      ["supermarkets", "dining", "konbini", "cuisine_variety", "late_night", "health", "green_space", "residential_calm", "road_rail_exposure", "bars", "dining_reach", "connectedness"].map((k) => [k, 0]),
    );
    const rows = comparisonRows({
      a: "a",
      b: "b",
      pABeatsB: 0.5,
      diff: { ...zero, rent: 5000, features: { ...features, bars: -100 } } as never,
    });
    expect(rows.map((r) => r.term)).toEqual(["rent", "timeCost", "bars"]);
  });
});

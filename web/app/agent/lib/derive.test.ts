import { describe, expect, it } from "vitest";
import {
  chanceLabel,
  confidenceMeter,
  friendlyText,
  groupEvidence,
  matchStrength,
  rankDeltas,
  whyLine,
} from "./derive";
import type { LoggedEvidence, ShortlistItem } from "./types";
describe("plain recommendation summaries", () => {
  it("labels boundary probabilities and preserves tiny chances", () => {
    expect([0, 0.001, 0.05, 0.15, 0.35].map((p) => matchStrength(p).steps)).toEqual([
      0, 1, 2, 3, 4,
    ]);
    expect(chanceLabel(0.000001)).toBe("less than 0.01%");
  });
  it("uses monthly uncertainty boundaries and honours stopping", () => {
    expect(
      [299, 300, 999, 1000, 2999, 3000, 7999, 8000].map(
        (riskYen) => confidenceMeter({ riskYen, shouldStop: false }).steps,
      ),
    ).toEqual([5, 4, 4, 3, 3, 2, 2, 1]);
    expect(confidenceMeter({ riskYen: 90000, shouldStop: true }).steps).toBe(5);
  });
  it("never calls a missing commute the shortest and uses only positive features", () => {
    const item = {
      role: null,
      rentYen: 100,
      commuteMinutes: null,
      breakdown: { features: { green_space: 10, bars: -20 } },
    } as ShortlistItem;
    expect(whyLine(item, [item, { ...item, rentYen: 200 }])).toBe(
      "Strong on green space. Cheapest here.",
    );
    expect(whyLine({ ...item, role: { param: "gamma", direction: "higher" } }, [item])).toContain(
      "staying under your commute cap",
    );
  });
  it("groups repeated quotes by type, without mutating source", () => {
    const items = [
      { id: "a", type: "direction", quote: "quiet" },
      { id: "b", type: "direction", quote: "quiet" },
      { id: "c", type: "magnitude", quote: "quiet" },
    ] as LoggedEvidence[];
    expect(groupEvidence(items).map((g) => [g.item.id, g.count])).toEqual([
      ["a", 2],
      ["c", 1],
    ]);
    expect(items.length).toBe(3);
  });
  it("counts places moved and marks entrants", () => {
    expect(rankDeltas(["a", "b", "c"], ["c", "a", "d"])).toEqual({ c: 2, a: -1, d: "New" });
  });
  it("cleans engine wording without altering figures", () => {
    expect(friendlyText("11 feasible areas; anchor; regret ¥1,278; 4 terms")).toBe(
      "11 matching areas; destination; cost if I’ve misread you ¥1,278; 4 factors",
    );
  });
});

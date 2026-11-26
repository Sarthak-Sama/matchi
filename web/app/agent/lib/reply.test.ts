import { describe, expect, it } from "vitest";
import { choicesFor, presentReply, type QuickChoice } from "./reply";
import type { AgentStateView } from "./types";

const choices: QuickChoice[] = ["本町", "北沢"].map((label) => ({
  label,
  sublabel: null,
  message: `Pick ${label}`,
  metrics: [{ label: "Rent / month", value: "¥63,000" }],
}));
const table = `| Area | Rent | Trip | Food |
|---|---|---|---|
| 本町 (Shibuya) | 62,000 yen | 22 min | Many restaurants |
| **北沢 (Setagaya)** | 63,000 yen | 24 min | Late-night food |`;

describe("guide choice presentation", () => {
  it("turns the duplicated comparison into selectable cards without losing extra columns", () => {
    const reply = presentReply(
      `**Food after dark matters.**\n\n${table}\n\nWhich of these fits best?`,
      choices,
    );
    expect(reply.body.map((b) => b.kind)).toEqual(["paragraph"]);
    expect(reply.question).toBeNull();
    expect(reply.choices[1]?.metrics).toContainEqual({ label: "Food", value: "Late-night food" });
  });

  it("replaces the verbose legacy question, retaining its preceding explanation", () => {
    const reply = presentReply(
      "Dining matters. Which fits best: 本町 (62,000 yen, 22 min) or 北沢 (63,000 yen, 24 min)?",
      choices,
    );
    expect(reply.body).toHaveLength(1);
    expect(reply.question).toBeNull();
    expect(reply.choices).toEqual(choices);
  });

  it("does not attach area options to a profile question", () => {
    const reply = presentReply("What is your monthly budget?", choices);
    expect(reply.question).not.toBeNull();
    expect(reply.choices).toEqual([]);
  });

  it("preserves comparisons that contain other areas", () => {
    const reply = presentReply(
      `${table.replace("本町 (Shibuya)", "代々木 (Shibuya)")}\n\nWhich of these fits best?`,
      choices,
    );
    expect(reply.body[0]?.kind).toBe("table");
  });

  it("keeps ordinary free-text questions without an engine choice set", () => {
    const reply = presentReply("Which of these fits best?", []);
    expect(reply.question).not.toBeNull();
    expect(reply.choices).toEqual([]);
  });

  it("uses engine estimates, handles missing travel, and refuses incomplete sets", () => {
    const view = {
      recommendation: {
        shouldStop: false,
        nextQuestion: { kind: "pair", a: "a", b: "b" },
        shortlist: [
          {
            localityId: "a",
            nameJa: "本町",
            nameEn: null,
            wardNameEn: "Shibuya",
            rentYen: 62491,
            commuteMinutes: 22.4,
          },
          {
            localityId: "b",
            nameJa: "北沢",
            nameEn: null,
            wardNameEn: "Setagaya",
            rentYen: 63101,
            commuteMinutes: null,
          },
        ],
      },
    } as unknown as AgentStateView;
    const result = choicesFor(view);
    expect(result[0]?.metrics.map((m) => m.value)).toEqual(["about ¥62k", "22 min"]);
    expect(result[1]?.metrics[1]?.value).toBe("Not set");
    view.recommendation!.shortlist.pop();
    expect(choicesFor(view)).toEqual([]);
  });
});

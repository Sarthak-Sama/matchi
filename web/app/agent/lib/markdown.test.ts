import { describe, expect, it } from "vitest";

import { cellFigure, numericColumns, parseBlocks, parseInline, splitName, splitQuestion } from "./markdown";

const REPLY = `**北沢 leads on late-night food.**

| Area | Rent | To campus |
|---|---:|---:|
| 本町 (Shibuya) | 62,000 yen | 22 min |
| **北沢 (Setagaya)** | 63,000 yen | 24 min |
| 代々木 (Shibuya) | 74,000 yen | 13 min |

- Rent is modelled at ward level.

Which of these fits best?`;

describe("guide markdown", () => {
  it("parses headline, table, list and the closing question", () => {
    const blocks = parseBlocks(REPLY);
    expect(blocks.map((b) => b.kind)).toEqual(["paragraph", "table", "list", "paragraph"]);
    const { body, question } = splitQuestion(blocks);
    expect(body).toHaveLength(3);
    expect(question?.kind === "paragraph" && question.raw).toBe("Which of these fits best?");
  });

  it("finds numeric columns and the best value per column", () => {
    const table = parseBlocks(REPLY)[1]!;
    if (table.kind !== "table") throw new Error("expected a table");
    const cols = numericColumns(table);
    expect(cols.map((c) => [c.unit, c.best])).toEqual([
      ["yen", 62000],
      ["minutes", 13],
    ]);
  });

  it("reads figures from cells", () => {
    expect(cellFigure("¥63,000")).toEqual({ value: 63000, unit: "yen" });
    expect(cellFigure("6.3万円")).toEqual({ value: 63000, unit: "yen" });
    expect(cellFigure("**24 min**")).toEqual({ value: 24, unit: "minutes" });
    expect(cellFigure("46%")).toEqual({ value: 46, unit: "percent" });
    expect(cellFigure("quiet")).toBeNull();
    expect(cellFigure("2,300")).toBeNull();
  });

  it("splits a bilingual name", () => {
    expect(splitName("**北沢 (Setagaya)**")).toEqual(["北沢", "Setagaya"]);
    expect(splitName("代々木")).toEqual(["代々木", null]);
  });

  it("splits only the final question sentence off plain prose", () => {
    const { body, question } = splitQuestion(
      parseBlocks("Ebisu is the strongest match so far, with a 46% chance of being best. What is your monthly budget?"),
    );
    expect(body[0]?.kind === "paragraph" && body[0].raw).toBe(
      "Ebisu is the strongest match so far, with a 46% chance of being best.",
    );
    expect(question?.kind === "paragraph" && question.raw).toBe("What is your monthly budget?");
  });

  it("keeps unclosed markers and snake_case literal", () => {
    expect(parseInline("late_night and 2 * 3")).toEqual([{ kind: "text", text: "late_night and 2 * 3" }]);
    expect(parseInline("a **b** _c_")).toEqual([
      { kind: "text", text: "a " },
      { kind: "strong", children: [{ kind: "text", text: "b" }] },
      { kind: "text", text: " " },
      { kind: "em", children: [{ kind: "text", text: "c" }] },
    ]);
  });
});

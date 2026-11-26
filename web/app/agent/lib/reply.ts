import type { AgentStateView } from "./types";
import { plainText, splitName, splitQuestion, parseBlocks, type Block } from "./markdown";
import { yen } from "./format";

export interface QuickChoice {
  /** Japanese name. Also the key that matches a row in the model's comparison table. */
  label: string;
  /** What the card shows as its heading. Falls back to the Japanese label. */
  title?: string;
  sublabel: string | null;
  message: string;
  metrics: { label: string; value: string }[];
}

/** Use engine values, with the same rounding as the guide's tools. */
export function choicesFor(view: AgentStateView | null): QuickChoice[] {
  const rec = view?.recommendation;
  const q = rec?.nextQuestion;
  if (!rec || !q || rec.shouldStop || q.kind === "profile_fact" || q.kind === "time_tradeoff")
    return [];
  const ids = q.kind === "pair" ? [q.a, q.b] : q.set;
  const items = ids.map((id) => rec.shortlist.find((s) => s.localityId === id));
  // A partial choice set would misrepresent the question.
  if (items.some((s) => !s)) return [];
  return items.map((s) => {
    const english = s!.nameEn && s!.nameEn !== s!.nameJa ? s!.nameEn : null;
    return {
      label: s!.nameJa,
      title: s!.nameJa,
      // Show the locality's romanization as well as its ward: names like 本町
      // exist in several wards. Avoid repeating names such as Nerima · Nerima.
      sublabel: [...new Set([english, s!.wardNameEn].filter(Boolean))].join(" · ") || null,
      message: `I'd pick ${s!.nameJa}${english ? ` (${english})` : ""}${s!.wardNameEn ? `, ${s!.wardNameEn}` : ""}.`,
      metrics: [
        { label: "Rent / month", value: yen(Math.round(s!.rentYen / 1000) * 1000) },
        {
          label: "One-way trip",
          value:
            s!.commuteMinutes !== null && Number.isFinite(s!.commuteMinutes)
              ? `${Math.round(s!.commuteMinutes)} min`
              : "Not set",
        },
      ],
    };
  });
}

/** Consolidate only a matching comparison; unrelated tables and extra facts survive. */
export function presentReply(text: string, choices: QuickChoice[] = []) {
  const { body, question } = splitQuestion(parseBlocks(text));
  const asksAboutChoices =
    question &&
    "children" in question &&
    choices.some((c) => plainText(question.children).includes(c.label));
  const genericChoice =
    question &&
    "children" in question &&
    /^(which (?:of these|area|one)|where would you|どの)/i.test(plainText(question.children));
  const hasChoiceTable = body.some((b) => b.kind === "table" && matchingTable(b, choices));
  const showChoices =
    choices.length > 0 &&
    (!!asksAboutChoices || !!genericChoice || (!!question && hasChoiceTable) || !question);
  if (!showChoices) return { body, question, choices: [] };
  let enriched = choices;
  const filtered = body.filter((b) => {
    if (b.kind !== "table" || !matchingTable(b, choices)) return true;
    enriched = enriched.map((c) => {
      const row = b.rows.find((r) => splitName(r[0] ?? "")[0] === c.label)!;
      return {
        ...c,
        metrics: [
          ...c.metrics,
          ...b.header.slice(1).flatMap((label, i) => {
            // The engine owns rent and travel values; keep any other comparison facts.
            if (/rent|commute|one.way|to campus|trip/i.test(label)) return [];
            return [{ label, value: row[i + 1]!.replace(/\*\*/g, "") }];
          }),
        ],
      };
    });
    return false;
  });
  return {
    body: filtered,
    question: asksAboutChoices || genericChoice ? null : question,
    choices: enriched,
  };
}

function matchingTable(table: Extract<Block, { kind: "table" }>, choices: QuickChoice[]): boolean {
  const names = table.rows.map((r) => splitName(r[0] ?? "")[0]);
  return (
    choices.length > 0 &&
    names.length === choices.length &&
    new Set(names).size === names.length &&
    choices.every((c) => names.includes(c.label))
  );
}

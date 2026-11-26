import { percent, yen } from "./format";
import type { NameOf } from "./evidence";
import { PARAM_LABELS, termLabel, type Comparison, type WhyNot } from "./types";
import type { BreakdownTerm } from "./types";

/** Plain wording for the engine's WhyNot result. Every figure is copied from the result. */
export function describeWhyNot(w: WhyNot, names: NameOf): string {
  const name = names(w.localityId);
  switch (w.kind) {
    case "unknown_area":
      return `${w.localityId} is not an area the guide knows.`;
    case "is_top_pick":
      return `${name} is already the top pick.`;
    case "fails_firm_limit": {
      const by = w.unit === "yen" ? ` by ${yen(w.by)} a month` : w.unit === "minutes" ? ` by ${Math.round(w.by)} min` : "";
      const reason: Record<typeof w.limit, string> = {
        budget: `it is over your firm budget${by}`,
        commute_cap: `it is over your firm commute cap${by}`,
        null_rent: "there is no rent data for it",
        null_lifestyle: "its lifestyle data is incomplete",
        no_access: "its access data is missing",
        disconnected: "it cannot be reached from your anchor",
        uninhabited: "almost nobody lives there",
      };
      return `${name} is left out because ${reason[w.limit]}.`;
    }
    case "wins_for_some":
      return `${name} is the best pick for about ${percent(w.weight)} of the plausible versions of you: those where ${PARAM_LABELS[w.param].toLowerCase()} is about ${w.ratio.toFixed(1)} times its likely value.`;
    case "needs_weight_change":
      return `${name} would win only if ${termLabel(w.term).toLowerCase()} counted about ${w.factor.toFixed(1)} times as much; today it trails by ${yen(w.gapYen)} a month.`;
    case "dominated":
      return `${name} trails the top pick by ${yen(w.gapYen)} a month and is not ahead on any term that matters to you.`;
  }
}

export function comparisonRows(c: Comparison): { term: BreakdownTerm; value: number }[] {
  const d = c.diff;
  const rows: { term: BreakdownTerm; value: number }[] = [
    { term: "rent", value: d.rent },
    { term: "timeCost", value: d.timeCost },
    { term: "budgetPenalty", value: d.budgetPenalty },
    { term: "capPenalty", value: d.capPenalty },
    ...(Object.keys(d.features) as (keyof typeof d.features)[]).map((k) => ({ term: k as BreakdownTerm, value: d.features[k] })),
  ];
  return rows.filter((r) => Math.round(r.value) !== 0).sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
}

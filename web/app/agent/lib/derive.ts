import { FEATURE_LABELS, type LoggedEvidence, type ParamKey, type Recommendation, type ShortlistItem } from "./types";

export function plainParam(param: ParamKey): string {
  return param === "c_t" ? "a short commute" : param === "lambda_b" ? "staying under budget" : param === "gamma" ? "staying under your commute cap" : FEATURE_LABELS[param].toLowerCase();
}
export function matchStrength(pBest: number) {
  if (pBest >= .35) return { label: "Strong match", steps: 4 };
  if (pBest >= .15) return { label: "Good match", steps: 3 };
  if (pBest >= .05) return { label: "Possible", steps: 2 };
  if (pBest > 0) return { label: "Long shot", steps: 1 };
  return { label: "Outside chance", steps: 0 };
}
/** Keep a tiny positive probability honest instead of rounding it down to zero. */
export function chanceLabel(value: number): string {
  return value > 0 && value < .0001 ? "less than 0.01%" : `${Number((value * 100).toFixed(2))}%`;
}
export function whyLine(item: ShortlistItem, list: readonly ShortlistItem[]): string {
  let line = "";
  if (item.role) line = `Best if ${plainParam(item.role.param)} matters ${item.role.direction === "higher" ? "more" : "less"} to you.`;
  else {
    const positive = (Object.keys(item.breakdown.features) as (keyof typeof FEATURE_LABELS)[]).filter(k => item.breakdown.features[k] > 0).sort((a,b) => item.breakdown.features[b]-item.breakdown.features[a]);
    if (positive[0]) line = `Strong on ${FEATURE_LABELS[positive[0]].toLowerCase()}.`;
  }
  if (list.length > 1 && list.every(s => s.rentYen >= item.rentYen)) line += " Cheapest here.";
  if (item.commuteMinutes !== null && list.length > 1 && list.every(s => s.commuteMinutes !== null && s.commuteMinutes >= item.commuteMinutes!)) line += " Shortest ride.";
  return line.trim();
}
export function confidenceMeter(rec: Pick<Recommendation, "riskYen" | "shouldStop">) {
  // Monthly uncertainty thresholds: ¥300 / ¥1,000 / ¥3,000 / ¥8,000. These describe learning, not data quality.
  const steps = rec.shouldStop ? 5 : rec.riskYen < 300 ? 5 : rec.riskYen < 1000 ? 4 : rec.riskYen < 3000 ? 3 : rec.riskYen < 8000 ? 2 : 1;
  const caption = rec.shouldStop ? "That’s enough to go on." : steps===5 ? "I know you well" : steps===4 ? "Getting a clear picture" : steps===3 ? "Getting to know your week" : "Still getting to know you";
  return { steps, caption };
}
export function groupEvidence(items: readonly LoggedEvidence[]) {
  const groups = new Map<string, { item: LoggedEvidence; count: number }>();
  for (const item of items) {
    // Without a quote, group only the identical claim; do not merge unrelated directions.
    const { id: _id, ...claim } = item;
    const key = item.quote ? `${item.type}:${item.quote}` : JSON.stringify(claim);
    const group = groups.get(key);
    if (group) group.count++; else groups.set(key, { item, count: 1 });
  }
  return [...groups.values()];
}
export function rankDeltas(previous: readonly string[], next: readonly string[]): Record<string, number | "New"> {
  return Object.fromEntries(next.map((id,i) => { const old = previous.indexOf(id); return [id, old < 0 ? "New" : old-i]; }));
}
/** The API can return default recommendations before the user gives any details. */
export function hasBrief(profile: { anchors: unknown[]; budget?: unknown; commuteCap?: unknown; layout?: string } | undefined): boolean {
  return !!profile && !!(profile.anchors.length || profile.budget || profile.commuteCap || profile.layout);
}
/** Display-only vocabulary cleanup, including model replies; no numbers or underlying data change. */
export function friendlyText(text: string): string {
  return text.replace(/effective sample|\bESS\b/gi,"sample size").replace(/\bregret\b/gi,"cost if I’ve misread you").replace(/\bpBest\b/gi,"match strength").replace(/\blambda(?:_b)?\b/gi,"budget importance").replace(/\bgamma\b/gi,"commute limit importance").replace(/\bfeasible\b/gi,"matching").replace(/\bevidence\b/gi,"preferences").replace(/\banchors?\b/gi,"destination").replace(/\blocality id\b/gi,"area").replace(/\bprice points?\b/gi,"listing prices").replace(/\bterms?\b/gi,"factors").replace(/firm limit/gi,"hard limit");
}

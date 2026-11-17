// Grounding check: every unit-bearing figure in the reply must match a number
// from this turn's tool results or the profile, after result-shape rounding
// (rent to 1,000 yen, whole minutes, whole percents).

export type FigureUnit = "yen" | "minutes" | "hours" | "percent" | "count";

export interface Figure {
  raw: string;
  value: number;
  unit: FigureUnit;
}

export interface CollectedNumbers {
  values: number[];
  /** Array lengths, usable only as area counts. */
  counts: number[];
}

export type GroundingResult = { pass: true } | { pass: false; unmatched: Figure[] };

const NUMBER_IN_STRING = /\d[\d,]*(?:\.\d+)?/g;

function parseNumber(token: string): number {
  return Number(token.replace(/,/g, ""));
}

export function collectNumbers(sources: readonly unknown[]): CollectedNumbers {
  const values = new Set<number>();
  const counts = new Set<number>();
  const seen = new Set<object>();
  const walk = (node: unknown): void => {
    if (typeof node === "number") {
      if (Number.isFinite(node)) values.add(node);
    } else if (typeof node === "string") {
      for (const token of node.normalize("NFKC").match(NUMBER_IN_STRING) ?? []) {
        const parsed = parseNumber(token);
        if (Number.isFinite(parsed)) values.add(parsed);
      }
    } else if (node !== null && typeof node === "object") {
      if (seen.has(node)) return;
      seen.add(node);
      if (Array.isArray(node)) {
        counts.add(node.length);
        node.forEach(walk);
      } else {
        Object.values(node).forEach(walk);
      }
    }
  };
  sources.forEach(walk);
  return { values: [...values], counts: [...counts] };
}

const FIGURE =
  /(¥\s*)?(\d[\d,]*(?:\.\d+)?)\s*(万|千|k\b)?\s*(円|yen\b|jpy\b|minutes?\b|mins?\b|分|hours?\b|hrs?\b|h\b|時間|%|percent\b|パーセント|(?:areas?|neighbou?rhoods?|options|candidates)\b|エリア)?/gi;

const MULTIPLIER: Record<string, number> = { 万: 10_000, 千: 1_000, k: 1_000 };

function unitOf(suffix: string | undefined): FigureUnit | undefined {
  if (!suffix) return undefined;
  const s = suffix.toLowerCase();
  if (s === "円" || s === "yen" || s === "jpy") return "yen";
  if (s === "分" || s.startsWith("min")) return "minutes";
  if (s === "時間" || s.startsWith("h")) return "hours";
  if (s === "%" || s === "percent" || s === "パーセント") return "percent";
  return "count";
}

export function extractFigures(reply: string): Figure[] {
  const figures: Figure[] = [];
  for (const match of reply.normalize("NFKC").matchAll(FIGURE)) {
    const [whole, yenPrefix, digits = "", multiplier, suffix] = match;
    const scale = multiplier ? MULTIPLIER[multiplier.toLowerCase()] ?? 1 : 1;
    let unit = unitOf(suffix);
    // "¥82,000", "8.2万" and "8.2万円" are yen; a bare "82k" is not a figure.
    if (yenPrefix || multiplier === "万" || multiplier === "千") unit = unit === undefined || unit === "yen" ? "yen" : unit;
    if (unit === undefined) continue;
    if (unit !== "yen" && multiplier && !yenPrefix) continue;
    const base = parseNumber(digits);
    if (!Number.isFinite(base)) continue;
    const value = unit === "yen" ? Math.round(base * scale) : base;
    figures.push({ raw: whole.trim(), value, unit });
  }
  return figures;
}

const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-9;

function matches(figure: Figure, collected: CollectedNumbers): boolean {
  const { value } = figure;
  const any = (test: (candidate: number) => boolean): boolean => collected.values.some(test);
  switch (figure.unit) {
    case "yen":
      return any((c) => near(c, value) || near(Math.round(c / 1000) * 1000, value));
    case "minutes":
      return any((c) => near(c, value) || near(Math.round(c), value));
    case "hours":
      // An hours figure may restate a minutes value ("1.5 hours" for 90).
      return any((c) => near(c, value) || near(Math.round(c), value * 60));
    case "percent":
      return any(
        (c) => near(c, value) || near(Math.round(c), value) || (c >= 0 && c <= 1 && near(Math.round(c * 100), value)),
      );
    case "count":
      return any((c) => near(c, value)) || collected.counts.some((c) => c === value);
  }
}

export function checkGrounding(input: {
  reply: string;
  toolResults: readonly unknown[];
  profile?: unknown;
}): GroundingResult {
  const collected = collectNumbers([...input.toolResults, input.profile]);
  const unmatched = extractFigures(input.reply).filter((figure) => !matches(figure, collected));
  return unmatched.length === 0 ? { pass: true } : { pass: false, unmatched };
}

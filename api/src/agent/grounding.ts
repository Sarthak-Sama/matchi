// Grounding check: every unit-bearing figure in the reply must match a number
// from this turn's tool results or the profile, after result-shape rounding
// (rent to 1,000 yen, whole minutes, whole percents). A line that names areas
// may only quote figures of those areas (or figures that belong to no area).

export type FigureUnit = "yen" | "minutes" | "hours" | "percent" | "count";

export interface Figure {
  raw: string;
  value: number;
  unit: FigureUnit;
}

/** A number from a tool result, with the closest enclosing area_id if there was one. */
export interface Fact {
  value: number;
  areaId?: string;
}

export interface AreaName {
  name: string;
  areaId: string;
}

export interface CollectedNumbers {
  facts: Fact[];
  /** Array lengths, usable only as area counts. */
  counts: number[];
  /** name_en / name_ja of the areas in the results. */
  areaNames: AreaName[];
}

export type GroundingResult =
  | { pass: true; markup: boolean }
  | { pass: false; unmatched: Figure[]; markup: boolean };

const NUMBER_IN_STRING = /\d[\d,]*(?:\.\d+)?/g;
const ID_KEY = /(^|_)id$/;
const NAME_KEY = /^name_(en|ja)$/;

function parseNumber(token: string): number {
  return Number(token.replace(/,/g, ""));
}

export function collectNumbers(sources: readonly unknown[]): CollectedNumbers {
  const facts = new Map<string, Fact>();
  const counts = new Set<number>();
  const names = new Map<string, AreaName>();
  const seen = new Set<object>();
  const addFact = (value: number, areaId: string | undefined): void => {
    if (Number.isFinite(value)) facts.set(`${areaId ?? ""}|${String(value)}`, areaId === undefined ? { value } : { value, areaId });
  };
  const walk = (node: unknown, key: string, areaId: string | undefined): void => {
    if (typeof node === "number") {
      addFact(node, areaId);
    } else if (typeof node === "string") {
      if (areaId !== undefined && NAME_KEY.test(key) && node !== "") {
        names.set(`${areaId}|${node}`, { name: node, areaId });
      }
      // Digits inside an id ("anchor_2", "poi:123") are not figures.
      if (ID_KEY.test(key)) return;
      for (const token of node.normalize("NFKC").match(NUMBER_IN_STRING) ?? []) addFact(parseNumber(token), areaId);
    } else if (node !== null && typeof node === "object") {
      if (seen.has(node)) return;
      seen.add(node);
      if (Array.isArray(node)) {
        counts.add(node.length);
        for (const item of node) walk(item, key, areaId);
      } else {
        const own = (node as Record<string, unknown>)["area_id"];
        const scope = typeof own === "string" ? own : areaId;
        for (const [k, v] of Object.entries(node)) walk(v, k, scope);
      }
    }
  };
  for (const source of sources) walk(source, "", undefined);
  return { facts: [...facts.values()], counts: [...counts], areaNames: [...names.values()] };
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

function matches(figure: Figure, values: readonly number[], counts: readonly number[]): boolean {
  const { value } = figure;
  const any = (test: (candidate: number) => boolean): boolean => values.some(test);
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
      return any((c) => near(c, value)) || counts.includes(value);
  }
}

// Sentences end at . ! ? followed by a space, or at 。！？; table rows are lines.
const SENTENCE_END = /(?<=[.!?])\s+|(?<=[。！？])/;

function splitLines(reply: string): string[] {
  return reply
    .split("\n")
    .flatMap((row) => row.split(SENTENCE_END))
    .filter((line) => line.trim() !== "");
}

function mentions(line: string, name: string): boolean {
  const text = line.toLowerCase();
  const needle = name.normalize("NFKC").toLowerCase();
  if (!/^[\x20-\x7e]+$/.test(needle)) return text.includes(needle);
  // A short English name must not match inside another word ("ota" in "total").
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`).test(text);
}

function areasNamedIn(line: string, areaNames: readonly AreaName[]): Set<string> {
  return new Set(areaNames.filter((n) => mentions(line, n.name)).map((n) => n.areaId));
}

function unmatchedFigures(line: string, collected: CollectedNumbers): Figure[] {
  const named = areasNamedIn(line, collected.areaNames);
  const pool = collected.facts.filter((f) => named.size === 0 || f.areaId === undefined || named.has(f.areaId));
  const values = pool.map((f) => f.value);
  return extractFigures(line).filter((figure) => !matches(figure, values, collected.counts));
}

// Model tool-call markup written as plain text (DeepSeek DSML and similar):
// "<｜DSML｜ ...", fullwidth "＜", zero-width characters or spaces in between,
// "<tool_call>", "<function_calls>", "<｜tool▁calls▁begin｜>".
export const TOOL_MARKUP =
  /[<＜][\s\u200B-\u200D\uFEFF]*[｜|]|[｜|][\s\u200B-\u200D\uFEFF]*DSML|<[\s\u200B-\u200D\uFEFF]*\/?[\s\u200B-\u200D\uFEFF]*(?:tool_?calls?|function_?calls?|invoke)\b|tool[▁_ ]calls?[▁_ ]begin/i;

export const hasToolMarkup = (text: string): boolean => TOOL_MARKUP.test(text);

export function checkGrounding(input: {
  reply: string;
  toolResults: readonly unknown[];
  profile?: unknown;
}): GroundingResult {
  const collected = collectNumbers([...input.toolResults, input.profile]);
  const markup = hasToolMarkup(input.reply);
  const unmatched = splitLines(input.reply.normalize("NFKC")).flatMap((line) => unmatchedFigures(line, collected));
  return unmatched.length === 0 ? { pass: true, markup } : { pass: false, unmatched, markup };
}

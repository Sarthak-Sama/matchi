// A small, safe Markdown subset for guide replies. No HTML passes through:
// the output is a tree the renderer maps to React elements.
//
// Blocks: # / ## / ### headings, paragraphs, - / * / 1. lists, > quotes,
// --- rules and pipe tables. Inline: **strong**, *em* / _em_, `code`.

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "strong"; children: Inline[] }
  | { kind: "em"; children: Inline[] }
  | { kind: "code"; text: string };

export type Align = "left" | "right" | "center" | null;

export type Block =
  | { kind: "heading"; level: 1 | 2 | 3; children: Inline[] }
  | { kind: "paragraph"; children: Inline[]; raw: string }
  | { kind: "list"; ordered: boolean; items: Inline[][] }
  | { kind: "quote"; children: Inline[] }
  | { kind: "rule" }
  | { kind: "table"; header: string[]; align: Align[]; rows: string[][] };

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const BULLET = /^\s*[-*•]\s+(.*)$/;
const ORDERED = /^\s*\d+[.)]\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;
const RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const TABLE_DIVIDER = /^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((c) => c.trim());
}

function alignOf(cell: string): Align {
  const c = cell.trim();
  const left = c.startsWith(":");
  const right = c.endsWith(":");
  if (left && right) return "center";
  if (right) return "right";
  if (left) return "left";
  return null;
}

export function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;

  const isBlockStart = (line: string, next: string | undefined): boolean =>
    HEADING.test(line) ||
    BULLET.test(line) ||
    ORDERED.test(line) ||
    QUOTE.test(line) ||
    RULE.test(line) ||
    (line.includes("|") && next !== undefined && TABLE_DIVIDER.test(next));

  while (i < lines.length) {
    const line = lines[i]!;
    if (line.trim() === "") {
      i++;
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      const level = Math.min(heading[1]!.length, 3) as 1 | 2 | 3;
      blocks.push({ kind: "heading", level, children: parseInline(heading[2]!) });
      i++;
      continue;
    }

    if (RULE.test(line)) {
      blocks.push({ kind: "rule" });
      i++;
      continue;
    }

    if (line.includes("|") && lines[i + 1] !== undefined && TABLE_DIVIDER.test(lines[i + 1]!)) {
      const header = splitRow(line);
      const align = splitRow(lines[i + 1]!).map(alignOf);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.includes("|") && lines[i]!.trim() !== "") {
        const cells = splitRow(lines[i]!);
        rows.push(header.map((_, c) => cells[c] ?? ""));
        i++;
      }
      blocks.push({ kind: "table", header, align, rows });
      continue;
    }

    if (BULLET.test(line) || ORDERED.test(line)) {
      const ordered = !BULLET.test(line);
      const pattern = ordered ? ORDERED : BULLET;
      const items: Inline[][] = [];
      while (i < lines.length) {
        const m = pattern.exec(lines[i]!);
        if (m) {
          items.push(parseInline(m[1]!));
          i++;
        } else if (lines[i]!.trim() !== "" && /^\s{2,}\S/.test(lines[i]!) && items.length > 0) {
          // Continuation line of the previous item.
          items[items.length - 1]!.push({ kind: "text", text: " " }, ...parseInline(lines[i]!.trim()));
          i++;
        } else break;
      }
      blocks.push({ kind: "list", ordered, items });
      continue;
    }

    if (QUOTE.test(line)) {
      const parts: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i]!)) {
        parts.push(QUOTE.exec(lines[i]!)![1]!);
        i++;
      }
      blocks.push({ kind: "quote", children: parseInline(parts.join(" ")) });
      continue;
    }

    const parts: string[] = [line.trim()];
    i++;
    while (i < lines.length && lines[i]!.trim() !== "" && !isBlockStart(lines[i]!, lines[i + 1])) {
      parts.push(lines[i]!.trim());
      i++;
    }
    const raw = parts.join(" ");
    blocks.push({ kind: "paragraph", children: parseInline(raw), raw });
  }
  return blocks;
}

/** Inline parse: code spans first, then ** strong, then * / _ em. Unclosed markers stay literal. */
export function parseInline(source: string): Inline[] {
  const out: Inline[] = [];
  let buffer = "";
  const flush = () => {
    if (buffer !== "") out.push({ kind: "text", text: buffer });
    buffer = "";
  };
  let i = 0;
  while (i < source.length) {
    const ch = source[i]!;
    if (ch === "`") {
      const end = source.indexOf("`", i + 1);
      if (end > i + 1) {
        flush();
        out.push({ kind: "code", text: source.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    if (source.startsWith("**", i) || source.startsWith("__", i)) {
      const marker = source.slice(i, i + 2);
      const end = source.indexOf(marker, i + 2);
      if (end > i + 2) {
        flush();
        out.push({ kind: "strong", children: parseInline(source.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    }
    if ((ch === "*" || ch === "_") && source[i + 1] !== " " && source[i + 1] !== ch) {
      // "_" only counts at a word boundary, so snake_case stays literal.
      const boundary = ch === "*" || i === 0 || /[\s(]/.test(source[i - 1]!);
      const end = source.indexOf(ch, i + 1);
      if (boundary && end > i + 1 && source[end - 1] !== " ") {
        flush();
        out.push({ kind: "em", children: parseInline(source.slice(i + 1, end)) });
        i = end + 1;
        continue;
      }
    }
    buffer += ch;
    i++;
  }
  flush();
  return out;
}

export function plainText(nodes: readonly Inline[]): string {
  return nodes.map((n) => (n.kind === "text" || n.kind === "code" ? n.text : plainText(n.children))).join("");
}

// ---------- Figures inside table cells ----------

export type CellUnit = "yen" | "minutes" | "percent" | "hours";

export interface CellFigure {
  value: number;
  unit: CellUnit;
}

const CELL_FIGURE = /^[~≈]?\s*(¥\s*)?(\d[\d,]*(?:\.\d+)?)\s*(万)?\s*(円|yen|jpy|min(?:ute)?s?|分|%|percent|h(?:ou)?rs?|hours?|時間)?/i;

/** The figure a table cell leads with ("63,000 yen", "¥63,000", "24 min", "46%"), if any. */
export function cellFigure(cell: string): CellFigure | null {
  const m = CELL_FIGURE.exec(cell.replace(/\*\*/g, "").normalize("NFKC").trim());
  if (!m) return null;
  const [, yen, digits, man, suffix] = m;
  const base = Number(digits!.replace(/,/g, ""));
  if (!Number.isFinite(base)) return null;
  const s = suffix?.toLowerCase();
  if (yen || man || s === "円" || s === "yen" || s === "jpy") return { value: man ? base * 10_000 : base, unit: "yen" };
  if (s === "%" || s === "percent") return { value: base, unit: "percent" };
  if (s === "分" || s?.startsWith("min")) return { value: base, unit: "minutes" };
  if (s === "時間" || s?.startsWith("h")) return { value: base, unit: "hours" };
  return null;
}

export interface NumericColumn {
  index: number;
  unit: CellUnit;
  values: (number | null)[];
  min: number;
  max: number;
  /** Lower is better for costs and times; higher for percents. */
  best: number;
}

/** Columns where at least two cells share one unit and no cell has another. */
export function numericColumns(table: { header: string[]; rows: string[][] }): NumericColumn[] {
  const out: NumericColumn[] = [];
  table.header.forEach((_, index) => {
    if (index === 0) return;
    const figures = table.rows.map((r) => cellFigure(r[index] ?? ""));
    const units = new Set(figures.filter((f): f is CellFigure => f !== null).map((f) => f.unit));
    const present = figures.filter((f) => f !== null).length;
    if (units.size !== 1 || present < 2) return;
    const unit = [...units][0]!;
    const values = figures.map((f) => f?.value ?? null);
    const nums = values.filter((v): v is number => v !== null);
    const min = Math.min(...nums);
    const max = Math.max(...nums);
    out.push({ index, unit, values, min, max, best: unit === "percent" ? max : min });
  });
  return out;
}

/** "北沢 (Setagaya)" -> ["北沢", "Setagaya"]. */
export function splitName(cell: string): [string, string | null] {
  const clean = cell.replace(/\*\*/g, "").trim();
  const m = /^(.+?)\s*[(（]([^()（）]+)[)）]\s*$/.exec(clean);
  return m ? [m[1]!, m[2]!] : [clean, null];
}

/** The closing question: the last paragraph, when it ends in a question mark. */
export function splitQuestion(blocks: readonly Block[]): { body: Block[]; question: Block | null } {
  const last = blocks[blocks.length - 1];
  if (!last || (last.kind !== "paragraph" && last.kind !== "quote")) return { body: [...blocks], question: null };
  if (!/[?？]\s*\**\s*$/.test(plainText(last.children))) return { body: [...blocks], question: null };
  if (last.kind === "paragraph") {
    // Prose that ends in a question: only the final sentence is the question.
    const cut = lastSentenceStart(last.raw);
    if (cut > 0) {
      const lead = last.raw.slice(0, cut).trim();
      const ask = last.raw.slice(cut).trim();
      return {
        body: [...blocks.slice(0, -1), { kind: "paragraph", children: parseInline(lead), raw: lead }],
        question: { kind: "paragraph", children: parseInline(ask), raw: ask },
      };
    }
  }
  return { body: blocks.slice(0, -1), question: last };
}

/** Index where the last sentence starts (after ". " / "! " / "。"), or 0 for a single sentence. */
function lastSentenceStart(raw: string): number {
  let at = 0;
  for (const m of raw.matchAll(/[.!。！](?:\*\*)?\s+|[。！]/g)) {
    const end = m.index + m[0].length;
    if (end < raw.length) at = end;
  }
  return at;
}

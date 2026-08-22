/**
 * Small, dependency-free CSV parser. Originally built for Task 12's
 * `import-rent/estat.ts` and `import-rent/reins.ts`; lives in `lib/`
 * (rather than under `import-rent/`) because Task 14's `import:transit`
 * reads GTFS, which is also CSV (`stops.txt`, `routes.txt`, `trips.txt`,
 * `stop_times.txt`) — a second task needing the same primitives is exactly
 * what this shared-harness directory is for, matching `lib/source-file.ts`
 * and `lib/validate.ts`'s own reuse-by-every-import-script design.
 *
 * Handles RFC 4180-style quoting (`"..."` fields, `""` as an escaped quote
 * inside one, commas and newlines inside quotes) because e-Stat's own CSV
 * exports quote any field containing a comma — including numeric values
 * that carry a thousands separator, e.g. `"4,200"` for a plain 4200.
 * `parseNumericCell` below strips those commas before parsing so a quoted
 * thousands-separated number round-trips correctly either way.
 *
 * Deliberately not a general-purpose library: no dialect options, no
 * streaming. Every caller passes an already-fully-decoded, in-memory
 * string (post Shift-JIS/BOM handling for e-Stat, already-UTF-8 for REINS
 * and GTFS).
 */

/** Parses `text` into rows of raw (still-quoted-stripped) string cells. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let sawAnyFieldThisRow = false;

  const n = text.length;
  let i = 0;
  while (i < n) {
    const ch = text[i] ?? "";
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      sawAnyFieldThisRow = true;
      i++;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      sawAnyFieldThisRow = true;
      i++;
      continue;
    }
    if (ch === "\r") {
      i++;
      continue;
    }
    if (ch === "\n") {
      if (sawAnyFieldThisRow || field.length > 0) {
        row.push(field);
        rows.push(row);
      }
      row = [];
      field = "";
      sawAnyFieldThisRow = false;
      i++;
      continue;
    }
    field += ch;
    sawAnyFieldThisRow = true;
    i++;
  }

  if (sawAnyFieldThisRow || field.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

/**
 * Parses `text` as CSV with a header row and returns one object per
 * remaining row, keyed by the (trimmed) header cell. A short row (fewer
 * cells than the header) leaves the missing trailing keys unset rather
 * than throwing — `expectColumns` at the call site turns that into a
 * clear, row-specific error.
 */
export function parseCsvRecords(text: string): Record<string, string>[] {
  const rows = parseCsv(text);
  const header = rows[0];
  if (header === undefined) return [];

  const keys = header.map((cell) => cell.trim());
  return rows.slice(1).map((row) => {
    const record: Record<string, string> = {};
    keys.forEach((key, index) => {
      const value = row[index];
      if (value !== undefined) {
        record[key] = value.trim();
      }
    });
    return record;
  });
}

/**
 * Returns the first non-empty value found under any of `candidates` in
 * `record`. Mirrors `import-mlit/geojson.ts`'s `pickProperty` so every
 * import script accepts both the source's real header text and a
 * friendlier alias without the caller pre-renaming columns.
 */
export function pickColumn(
  record: Readonly<Record<string, string>>,
  candidates: readonly string[],
): string | undefined {
  for (const key of candidates) {
    const value = record[key];
    if (value !== undefined && value !== "") return value;
  }
  return undefined;
}

/**
 * Parses a numeric CSV cell, stripping comma thousands-separators (e.g.
 * `"4,200"` -> `4200`) and surrounding whitespace. Returns `undefined` for
 * an empty/missing cell (a genuinely absent optional column, e.g. sample
 * count) rather than `NaN`, so callers can tell "not provided" apart from
 * "provided but unparseable".
 */
export function parseNumericCell(raw: string | undefined, context: string): number | undefined {
  if (raw === undefined) return undefined;
  const cleaned = raw.replace(/,/g, "").trim();
  if (cleaned === "") return undefined;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) {
    throw new Error(`${context}: "${raw}" is not a valid number`);
  }
  return value;
}

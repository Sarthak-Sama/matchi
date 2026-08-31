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

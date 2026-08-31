export function expectColumns(
  row: Readonly<Record<string, unknown>>,
  required: readonly string[],
  context: string,
): void {
  const missing = required.filter((key) => {
    const value = row[key];
    return value === undefined || value === null || value === "";
  });
  if (missing.length > 0) {
    throw new Error(`${context}: missing required column(s): ${missing.join(", ")}`);
  }
}

export interface ExpectRowCountOptions {
  readonly min?: number;
  readonly max?: number;

  readonly label: string;
}

export function expectRowCount(n: number, options: ExpectRowCountOptions): void {
  const { min, max, label } = options;
  if (min !== undefined && n < min) {
    throw new Error(`${label}: expected at least ${min} row(s), got ${n}`);
  }
  if (max !== undefined && n > max) {
    throw new Error(`${label}: expected at most ${max} row(s), got ${n}`);
  }
}

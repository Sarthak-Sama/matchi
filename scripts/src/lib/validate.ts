/**
 * Small, dependency-free validation helpers shared by every import script
 * (Task 11's `import:mlit`, and Tasks 12-14's `import:rent` / `import:osm` /
 * `import:transit`). Both throw plain `Error`s with messages specific
 * enough to act on directly — which column is missing, which row failed,
 * how many rows were expected — rather than a generic "invalid input".
 */

/**
 * Throws unless every key in `required` is present on `row` with a
 * non-empty value (`undefined`, `null`, and `""` all count as missing —
 * a CSV/GeoJSON source that leaves a cell blank should fail the same way
 * as one that omits the column entirely).
 *
 * `context` is prepended to the error message so a caller processing many
 * rows can name which one failed (e.g. `"wards feature #3"` or
 * `"rent_stats row for 渋谷区"`).
 */
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
  /** Name of the dataset being validated, used in the error message. */
  readonly label: string;
}

/**
 * Throws unless `n` falls within `[min, max]` (either bound optional).
 * Used both to abort on an implausibly small extract (a truncated
 * download, a wrong file) and, where relevant, an implausibly large one.
 */
export function expectRowCount(n: number, options: ExpectRowCountOptions): void {
  const { min, max, label } = options;
  if (min !== undefined && n < min) {
    throw new Error(`${label}: expected at least ${min} row(s), got ${n}`);
  }
  if (max !== undefined && n > max) {
    throw new Error(`${label}: expected at most ${max} row(s), got ${n}`);
  }
}

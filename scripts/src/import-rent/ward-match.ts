/**
 * Ward matching shared by both the e-Stat and REINS parsers: "by the
 * 5-digit municipality code where available, otherwise by normalized
 * Japanese ward name" (task-12-brief.md).
 *
 * ASSUMPTION (stated per task-12-brief.md's "Before You Begin" — verify
 * against a real download): the CSV passed via `--file`/`--reins` is
 * already scoped to Tokyo's ward-level rows (e.g. e-Stat's own regional
 * drill-down to Tokyo-to, not an unfiltered all-Japan export). Every
 * surviving row is therefore expected to match a ward this database
 * already knows about — whether that's all 23 special wards in production
 * (once `import:mlit` has run) or a smaller subset in a partially-seeded
 * environment (e.g. this repo's 4-ward vertical slice). A row that matches
 * neither by code nor by name is a hard error naming the unmatched value,
 * never a silent skip — see this file's callers and task-12-report.md for
 * why that matters now that `rent_stats.ward_code` is a real FK `import:mlit`
 * checks before dropping a ward.
 *
 * If the real e-Stat export turns out to be nationwide (every prefecture,
 * not just Tokyo), this assumption is wrong and a pre-filter step (e.g. by
 * prefecture-code prefix `13`) would need to be added before this module
 * ever sees a row — flagged explicitly in task-12-report.md for the user
 * to confirm against a live download.
 */

export interface WardLookupEntry {
  readonly wardCode: string;
  readonly nameJa: string;
}

/**
 * Normalizes a Japanese ward name for comparison: Unicode NFKC
 * normalization (folds full-width alphanumerics/punctuation to
 * half-width, among other compatibility mappings) plus stripping all
 * whitespace (including the full-width ideographic space, U+3000).
 */
export function normalizeWardName(raw: string): string {
  return raw.normalize("NFKC").replace(/[\s\u3000]/g, "");
}

/**
 * Resolves `rawCode`/`rawName` (whichever the source row carries) to one
 * of `wards`' real `ward_code` values. Tries the 5-digit code first, then
 * falls back to a normalized-name match; throws naming the raw value(s)
 * when neither resolves.
 */
export function matchWard(
  rawCode: string | undefined,
  rawName: string | undefined,
  wards: readonly WardLookupEntry[],
  context: string,
): string {
  const trimmedCode = rawCode?.trim();
  if (trimmedCode) {
    const byCode = wards.find((w) => w.wardCode === trimmedCode);
    if (byCode) return byCode.wardCode;
  }

  const trimmedName = rawName?.trim();
  if (trimmedName) {
    const normalized = normalizeWardName(trimmedName);
    const byName = wards.find((w) => normalizeWardName(w.nameJa) === normalized);
    if (byName) return byName.wardCode;
  }

  const unmatchedValue = trimmedCode || trimmedName || "(no code or name given)";
  throw new Error(
    `${context}: no known ward matches "${unmatchedValue}" (checked the 5-digit municipality ` +
      `code, then the normalized Japanese ward name, against every ward currently in the ` +
      `database).`,
  );
}

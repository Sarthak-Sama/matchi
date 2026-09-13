import iconv from "iconv-lite";

import { ROMANIZATION_OVERRIDES } from "./romanization-overrides.js";
import type { RomanizationOverride } from "./romanization-overrides.js";

// The "no town listed" catch-all Japan Post emits for wards with no further
// breakdown — never a real town name.
const NO_TOWN_LISTED_MARKER = "以下に掲載がない場合";

/**
 * Matching key only — never stored. Normalizes an e-Stat or Japan Post Japanese
 * locality name so the two sources can be joined despite chome-suffix, katakana-KE
 * and whitespace differences.
 */
export function normalizeForMatch(name: string): string {
  return name
    .normalize("NFKC")
    .replace(/[一二三四五六七八九十]+丁目$/u, "")
    .replace(/[0-9]+丁目$/u, "")
    .replace(/丁目$/u, "")
    .replace(/ケ/gu, "ヶ")
    .replace(/\s+/gu, "")
    .trim();
}

/**
 * Title-cases an all-caps romanization for display: split on whitespace runs, title
 * case each word, rejoin with a single space. "HATSUDAI" -> "Hatsudai";
 * "SENJU AKEBONOCHO" -> "Senju Akebonocho".
 */
export function toDisplayRomanization(upper: string): string {
  return upper
    .trim()
    .split(/\s+/u)
    .filter((w) => w.length > 0)
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(" ");
}

export interface JapanPostRow {
  readonly wardNameJa: string;
  readonly matchKey: string;
  readonly nameEn: string;
}

/** Strips one leading and one trailing '"' from a field, if present. */
function stripQuotes(field: string): string {
  let result = field;
  if (result.startsWith('"')) result = result.slice(1);
  if (result.endsWith('"')) result = result.slice(0, -1);
  return result;
}

/**
 * Strips a parenthesized annotation from a town name column. Handles Japan Post's
 * truncated fields, which can leave the closing bracket missing.
 *
 * `openPattern`/`closePattern` are single-character regex fragments (not sets) for
 * the open/close bracket characters to match.
 */
function stripAnnotation(value: string, open: string, close: string): string {
  const escapedOpen = open.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const escapedClose = close.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const pattern = new RegExp(`${escapedOpen}[^${escapedClose}]*${escapedClose}?`, "gu");
  return value.replace(pattern, "");
}

/**
 * Parses the Japan Post romanized-address CSV (Shift-JIS encoded, no header row) into
 * rows scoped to Tokyo's 23 wards, with annotations stripped and the ideographic-space
 * sub-town separator preserved.
 */
export function parseJapanPostCsv(bytes: Buffer): readonly JapanPostRow[] {
  const text = iconv.decode(bytes, "Shift_JIS");
  const rows: JapanPostRow[] = [];

  for (const line of text.split(/\r?\n/u)) {
    if (line.trim() === "") continue;
    const fields = line.split(",").map(stripQuotes);
    if (fields.length < 7) continue;

    // Columns: [postalCode, prefJa, cityJa, townJa, prefRo, cityRo, townRo]. `fields`
    // may have more than 7 elements; indexed access (not a 7-tuple cast, which would
    // overclaim the exact length) keeps this honest while still relying on the
    // length check above to guarantee these four are defined.
    const prefJa = fields[1] ?? "";
    const cityJa = fields[2] ?? "";
    const townJaRaw = fields[3] ?? "";
    const townRoRaw = fields[6] ?? "";
    if (prefJa !== "東京都") continue;
    if (!cityJa.endsWith("区")) continue;
    if (townJaRaw.includes(NO_TOWN_LISTED_MARKER)) continue;

    // Full-width annotation, e.g. "恵比寿(U+3000)（次のビルを除く）" -> "恵比寿". The
    // U+3000 ideographic space here is a sub-town separator, not part of the
    // annotation, so it survives this strip and is only removed later by
    // normalizeForMatch.
    const townJa = stripAnnotation(townJaRaw, "（", "）");
    // ASCII annotation, e.g. EBISU (TSUGINOBIRUONOZOKU) -> EBISU.
    const townRo = stripAnnotation(townRoRaw, "(", ")");

    const matchKey = normalizeForMatch(townJa);
    const nameEn = toDisplayRomanization(townRo.trim());
    if (matchKey === "" || nameEn === "") continue;

    rows.push({ wardNameJa: cityJa, matchKey, nameEn });
  }

  return rows;
}

/**
 * Builds a wardNameJa -> matchKey -> {distinct display romanizations} index from
 * parsed Japan Post rows. The value is a Set so callers can detect ambiguity (more
 * than one distinct romanization for the same ward + key) rather than silently
 * picking one.
 */
export function buildRomanizationIndex(
  rows: readonly JapanPostRow[],
): Map<string, Map<string, Set<string>>> {
  const index = new Map<string, Map<string, Set<string>>>();
  for (const row of rows) {
    let byKey = index.get(row.wardNameJa);
    if (!byKey) {
      byKey = new Map<string, Set<string>>();
      index.set(row.wardNameJa, byKey);
    }
    let names = byKey.get(row.matchKey);
    if (!names) {
      names = new Set<string>();
      byKey.set(row.matchKey, names);
    }
    names.add(row.nameEn);
  }
  return index;
}

export interface ResolvedRomanization {
  readonly nameEnByKey: Map<string, string>;
}

interface ResolveLocalityNamesInput {
  readonly localities: readonly { wardCode: string; wardNameJa: string; nameJa: string }[];
  readonly index: ReturnType<typeof buildRomanizationIndex>;
  readonly overrides?: readonly RomanizationOverride[];
}

// NUL-joined, matching the grouping-map key convention already used by
// import-localities.ts for wardCode + nameJa, so the later importer task can look
// up nameEnByKey with the same key it groups localities by.
function localityKey(wardCode: string, nameJa: string): string {
  return `${wardCode}\u0000${nameJa}`;
}

/**
 * The whole e-Stat <-> Japan Post join: for each locality, an override matching
 * wardCode + exact nameJa wins; otherwise the index is looked up by wardNameJa and
 * normalizeForMatch(nameJa). Throws a single error listing every offender when any
 * locality is unresolved, ambiguous, has an unused override, or resolves to an
 * empty/unchanged name.
 */
export function resolveLocalityNames(input: ResolveLocalityNamesInput): ResolvedRomanization {
  const overrides = input.overrides ?? ROMANIZATION_OVERRIDES;
  const overrideByKey = new Map<string, RomanizationOverride>();
  for (const override of overrides) {
    overrideByKey.set(localityKey(override.wardCode, override.nameJa), override);
  }
  const usedOverrideKeys = new Set<string>();

  const nameEnByKey = new Map<string, string>();
  const missing: string[] = [];
  const ambiguous: string[] = [];
  const invalid: string[] = [];

  for (const locality of input.localities) {
    const key = localityKey(locality.wardCode, locality.nameJa);
    const override = overrideByKey.get(key);
    if (override) {
      usedOverrideKeys.add(key);
      nameEnByKey.set(key, override.nameEn);
      if (override.nameEn === "" || override.nameEn === locality.nameJa) {
        invalid.push(`${locality.wardCode} ${locality.nameJa}`);
      }
      continue;
    }

    const byKey = input.index.get(locality.wardNameJa);
    const names = byKey?.get(normalizeForMatch(locality.nameJa));
    if (!names || names.size === 0) {
      missing.push(`${locality.wardCode} ${locality.nameJa}`);
      continue;
    }
    if (names.size > 1) {
      ambiguous.push(`${locality.wardCode} ${locality.nameJa}`);
      continue;
    }
    const [nameEn] = names;
    if (nameEn === undefined || nameEn === "" || nameEn === locality.nameJa) {
      invalid.push(`${locality.wardCode} ${locality.nameJa}`);
      continue;
    }
    nameEnByKey.set(key, nameEn);
  }

  const unused = overrides
    .filter((override) => !usedOverrideKeys.has(localityKey(override.wardCode, override.nameJa)))
    .map((override) => `${override.wardCode} ${override.nameJa}`);

  const problems: string[] = [];
  if (missing.length > 0) problems.push(`no romanization found for: ${missing.join(", ")}`);
  if (ambiguous.length > 0)
    problems.push(`ambiguous romanization (more than one candidate) for: ${ambiguous.join(", ")}`);
  if (unused.length > 0)
    problems.push(`unused overrides (stale, must be deleted): ${unused.join(", ")}`);
  if (invalid.length > 0)
    problems.push(`resolved to an empty or unchanged name for: ${invalid.join(", ")}`);

  if (problems.length > 0) {
    throw new Error(`resolveLocalityNames: ${problems.join("; ")}`);
  }

  return { nameEnByKey };
}

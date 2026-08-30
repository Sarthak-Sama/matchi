import type { NeighborhoodResult } from "@tokyo/shared";

/**
 * Display helpers for the Field Guide frontend. Everything here either
 * formats an existing API value or derives copy strictly from values the
 * API already returned — nothing invents data.
 */

/** "Meguro" → "Meguro-ku" (kept from the previous frontend's convention). */
export function wardDisplayName(nameEn: string): string {
  const base = nameEn.replace(/\s+(?:City|Ward)$/iu, "");
  return /-ku$/iu.test(base) ? base : `${base}-ku`;
}

/** "五本木" alone, or "Yutenji (祐天寺)" when a distinct romanization exists. */
export function localityDisplayName(nameEn: string, nameJa: string): string {
  return nameEn && nameEn !== nameJa ? `${nameEn} (${nameJa})` : nameJa;
}

/** ¥168,000 → "¥168k" — compact comparable figures for scan columns. */
export function formatYenCompact(yen: number): string {
  if (yen >= 1_000_000) {
    const millions = yen / 1_000_000;
    return `¥${millions.toFixed(millions >= 10 ? 0 : 1)}M`;
  }
  return `¥${Math.round(yen / 1000)}k`;
}

export function formatYenFull(yen: number): string {
  return `¥${yen.toLocaleString("en-US")}`;
}

/** "35.6347° N / 139.6878° E" — folio-style coordinate metadata. */
export function formatCoordinates(lat: number, lon: number): string {
  const latHemisphere = lat >= 0 ? "N" : "S";
  const lonHemisphere = lon >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(4)}° ${latHemisphere} / ${Math.abs(lon).toFixed(4)}° ${lonHemisphere}`;
}

/** "2026-08-26T00:42:05.533Z" → "26 Aug 2026"; "2023" → "2023". */
export function formatSourceDate(value: string | null): string {
  if (!value) return "date unknown";
  if (/^\d{4}$/.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/**
 * A one-line editorial descriptor for a result, derived ONLY from factors
 * the API returned: the lifestyle axes (never affordability/commute, which
 * have their own columns) that scored as clear strengths, plus the commute.
 * Returns null when nothing stands out — the UI then simply omits the line
 * rather than inventing praise.
 */
export function deriveDescriptor(result: NeighborhoodResult): string | null {
  const strengths = result.factors
    .filter(
      (factor) =>
        factor.direction === "positive" &&
        factor.key !== "affordability" &&
        factor.key !== "commute" &&
        factor.componentScore >= 66,
    )
    .sort((a, b) => b.componentScore - a.componentScore)
    .slice(0, 2)
    .map((factor) => factor.label.toLowerCase());
  if (strengths.length === 0) return null;
  return `${strengths.join(" and ")} stand out here`;
}

/**
 * The dominant pattern across the shortlist, in one honest sentence.
 * Derived from the top results' wards and commute range; returns null when
 * the matches are too scattered to characterize without inventing.
 */
export function deriveResultsSummary(
  results: NeighborhoodResult[],
  destinationLabel: string | null,
): string | null {
  const top = results.slice(0, 8);
  if (top.length < 3) return null;

  const wardCounts = new Map<string, number>();
  for (const result of top) {
    const ward = wardDisplayName(result.wardNameEn);
    wardCounts.set(ward, (wardCounts.get(ward) ?? 0) + 1);
  }
  const rankedWards = [...wardCounts.entries()].sort((a, b) => b[1] - a[1]);
  const [leadWard, leadCount] = rankedWards[0] ?? [null, 0];

  const minutes = top.map((r) => Math.round(r.commute.totalMinutes));
  const minCommute = Math.min(...minutes);
  const maxCommute = Math.max(...minutes);
  const destination = destinationLabel ?? "your destination";
  const commutePhrase =
    minCommute === maxCommute
      ? `each about ${minCommute} minutes from ${destination}`
      : `all within ${minCommute}–${maxCommute} minutes of ${destination}`;

  if (leadWard && leadCount >= Math.ceil(top.length / 2)) {
    return `Your strongest matches cluster in ${leadWard}, ${commutePhrase}.`;
  }
  if (rankedWards.length >= 2) {
    const second = rankedWards[1];
    if (leadWard && second && leadCount + second[1] >= Math.ceil((top.length * 3) / 4)) {
      return `Your strongest matches sit across ${leadWard} and ${second[0]}, ${commutePhrase}.`;
    }
  }
  return `Your strongest matches are spread across ${rankedWards.length} wards, ${commutePhrase}.`;
}

/** The commute's rounded display terms, with `wait` absorbing rounding
 *  residuals so the parts always sum to the displayed total (logic kept
 *  from the previous frontend). */
export function commuteDisplayTerms(commute: NeighborhoodResult["commute"]): {
  total: number;
  accessWalk: number;
  rail: number;
  wait: number;
  destinationWalk: number;
} {
  const total = Math.round(commute.totalMinutes);
  const accessWalk = Math.round(commute.accessWalkMinutes);
  const rail = Math.round(commute.railMinutes + commute.transferPenaltyMinutes);
  const destinationWalk = Math.round(commute.destinationWalkMinutes);
  const wait = total - accessWalk - rail - destinationWalk;
  return { total, accessWalk, rail, wait, destinationWalk };
}

/**
 * "渋谷" and "渋谷" → "渋谷"; "Yutenji" and "祐天寺" → "Yutenji (祐天寺)".
 * Much of the MLIT dataset carries the same string in both name columns,
 * and repeating it reads as a rendering bug rather than as bilingual
 * identity.
 */
export function bilingualLabel(nameEn: string, nameJa: string | null): string {
  if (!nameJa || nameJa === nameEn) return nameEn;
  if (!nameEn) return nameJa;
  return `${nameEn} (${nameJa})`;
}

/** Factors that already have a dedicated row or column of their own —
 *  showing them again as a component score reads as a duplicate. */
const CHARTED_SEPARATELY = new Set(["affordability", "commute"]);

/** True for the lifestyle axes, i.e. everything not already charted. */
export function isLifestyleFactor(key: string): boolean {
  return !CHARTED_SEPARATELY.has(key);
}

/**
 * The one reason worth putting in a shortlist row. Rent and commute
 * already occupy their own columns, so a row whose only stated strength
 * is "Affordability is a strength: ¥129,786" tells the reader nothing the
 * row does not already show. Prefer the strongest LIFESTYLE factor, which
 * is what actually separates one candidate from the next, and fall back to
 * the API's own ordering only when no lifestyle factor was scored.
 */
export interface Strength {
  /** The full sentence, including how it was weighted. */
  readonly text: string;
  /** Just the measurement — "14 supermarkets within 800 m". */
  readonly short: string;
}

export function pickStrength(result: NeighborhoodResult): Strength | null {
  const lifestyle = result.factors
    .filter((factor) => !CHARTED_SEPARATELY.has(factor.key) && factor.direction === "positive")
    .sort((a, b) => b.componentScore - a.componentScore)[0];
  // `rawValueLabel` is the concrete half of the API's explanation without
  // the "weighted at 13.3% of your overall score" tail — that clause is
  // methodology, and repeating it down twenty rows buries the measurement
  // it is attached to.
  if (lifestyle) {
    return { text: lifestyle.explanation, short: sentenceCase(lifestyle.rawValueLabel) };
  }
  const stated = result.reasonsFor[0];
  return stated ? { text: stated, short: stated } : null;
}

/**
 * The compromise for a row or entry. The API only fills `reasonsAgainst`
 * when a factor scores badly in absolute terms, so a strong shortlist
 * routinely comes back with none at all — and silently showing nothing
 * would hide the trade-off the reader most needs. When that happens, name
 * the lowest-scoring component instead, stated as what it is: the weakest
 * part of an otherwise good fit, not a defect.
 */
export interface Compromise {
  /** The full sentence, for the neighborhood entry. */
  readonly text: string;
  /** A column-width phrasing, for a shortlist row. */
  readonly short: string;
  /** True when this was derived from the weakest factor rather than
   *  stated by the API — the UI labels the two differently. */
  readonly derived: boolean;
}

export function pickCompromise(result: NeighborhoodResult): Compromise | null {
  const stated = result.reasonsAgainst[0];
  if (stated) return { text: stated, short: stated, derived: false };

  const weakest = [...result.factors].sort((a, b) => a.componentScore - b.componentScore)[0];
  if (!weakest) return null;
  const score = Math.round(weakest.componentScore);
  return {
    text: `Nothing here scores badly, but ${weakest.label.toLowerCase()} is the weakest part of the fit at ${score} out of 100.`,
    short: `${weakest.label} is the weakest component (${score}/100)`,
    derived: true,
  };
}

/** Sentence-cases a derived fragment without touching Japanese or acronyms. */
export function sentenceCase(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

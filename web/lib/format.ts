import type { NeighborhoodResult } from "@tokyo/shared";

export function wardDisplayName(nameEn: string): string {
  const base = nameEn.replace(/\s+(?:City|Ward)$/iu, "");
  return /-ku$/iu.test(base) ? base : `${base}-ku`;
}

export function localityDisplayName(nameEn: string, nameJa: string): string {
  return nameEn && nameEn !== nameJa ? `${nameEn} (${nameJa})` : nameJa;
}

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

export function formatCoordinates(lat: number, lon: number): string {
  const latHemisphere = lat >= 0 ? "N" : "S";
  const lonHemisphere = lon >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(4)}° ${latHemisphere} / ${Math.abs(lon).toFixed(4)}° ${lonHemisphere}`;
}

export function formatSourceDate(value: string | null): string {
  if (!value) return "date unknown";
  if (/^\d{4}$/.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

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

export function bilingualLabel(nameEn: string, nameJa: string | null): string {
  if (!nameJa || nameJa === nameEn) return nameEn;
  if (!nameEn) return nameJa;
  return `${nameEn} (${nameJa})`;
}

const CHARTED_SEPARATELY = new Set(["affordability", "commute"]);

export function isLifestyleFactor(key: string): boolean {
  return !CHARTED_SEPARATELY.has(key);
}

export interface Strength {
  readonly text: string;

  readonly short: string;
}

export function pickStrength(result: NeighborhoodResult): Strength | null {
  const lifestyle = result.factors
    .filter((factor) => !CHARTED_SEPARATELY.has(factor.key) && factor.direction === "positive")
    .sort((a, b) => b.componentScore - a.componentScore)[0];

  if (lifestyle) {
    return { text: lifestyle.explanation, short: sentenceCase(lifestyle.rawValueLabel) };
  }
  const stated = result.reasonsFor[0];
  return stated ? { text: stated, short: stated } : null;
}

export interface Compromise {
  readonly text: string;

  readonly short: string;

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

export function sentenceCase(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

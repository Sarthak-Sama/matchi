import type { Evidence, FeatureKey, LoggedEvidence, NextQuestion, ShortlistItem, Strength } from "./types";
import { FEATURE_LABELS } from "./types";

// Engine-only controls. Each returns an Evidence exactly as the contract's union
// defines it; the engine assigns the id.

/** "quieter": more residential calm. */
export function quieter(strength: Strength = "normal"): Evidence {
  return { type: "direction", feature: "residential_calm", sign: 1, strength, quote: "quieter" };
}

// The evidence union has no direct "rent" term. "cheaper" and "closer" are the two
// answers to the same time-for-money trade, so they use time_tradeoff. The 10,000 yen
// and 10 minutes are the question put to the person, shown in the quote.
const TRADE_YEN = 10_000;
const TRADE_MINUTES = 10;

/** "cheaper": would not pay 10,000 yen a month to save 10 minutes each way. */
export function cheaper(strength: Strength = "normal"): Evidence {
  return {
    type: "time_tradeoff",
    yen: TRADE_YEN,
    minutes: TRADE_MINUTES,
    accept: false,
    strength,
    quote: "cheaper rather than faster",
  };
}

/** "closer": would pay 10,000 yen a month to save 10 minutes each way. */
export function closer(strength: Strength = "normal"): Evidence {
  return {
    type: "time_tradeoff",
    yen: TRADE_YEN,
    minutes: TRADE_MINUTES,
    accept: true,
    strength,
    quote: "closer rather than cheaper",
  };
}

export function featureDirection(feature: FeatureKey, sign: 1 | -1, strength: Strength = "normal"): Evidence {
  const label = FEATURE_LABELS[feature].toLowerCase();
  return {
    type: "direction",
    feature,
    sign,
    strength,
    quote: sign === 1 ? `more ${label}` : `less ${label}`,
  };
}

export function likeArea(item: ShortlistItem): Evidence {
  return { type: "like_area", area: item.localityId, strength: "normal", quote: `like ${areaName(item)}` };
}

export function dislikeArea(item: ShortlistItem): Evidence {
  return { type: "dislike_area", area: item.localityId, strength: "normal", quote: `not ${areaName(item)}` };
}

/** Tapping a card: prefer it over the neighbouring card (the next one down; the last prefers over the one above). */
export function preferOverNeighbour(list: readonly ShortlistItem[], index: number): Evidence | null {
  const item = list[index];
  const other = list[index + 1] ?? list[index - 1];
  if (!item || !other) return null;
  return {
    type: "prefer_area",
    a: item.localityId,
    b: other.localityId,
    strength: "normal",
    quote: `${areaName(item)} over ${areaName(other)}`,
  };
}

export function preferPair(a: ShortlistItem | string, b: ShortlistItem | string, names: NameOf): Evidence {
  const idA = typeof a === "string" ? a : a.localityId;
  const idB = typeof b === "string" ? b : b.localityId;
  return {
    type: "prefer_area",
    a: idA,
    b: idB,
    strength: "normal",
    quote: `${names(idA)} over ${names(idB)}`,
  };
}

export function pickFromSet(chosen: string, set: readonly string[], names: NameOf): Evidence {
  return {
    type: "pick_from_set",
    chosen,
    set: [...set],
    strength: "normal",
    quote: `${names(chosen)} out of ${set.map(names).join(", ")}`,
  };
}

export type NameOf = (localityId: string) => string;

export function areaName(item: Pick<ShortlistItem, "nameEn" | "nameJa">): string {
  return item.nameEn && item.nameEn !== item.nameJa ? item.nameEn : item.nameJa;
}

export function makeNameOf(list: readonly ShortlistItem[]): NameOf {
  const byId = new Map(list.map((s) => [s.localityId, areaName(s)]));
  return (id) => byId.get(id) ?? id;
}

/** A chip's wording. The person's own quote is shown separately and wins on the chip. */
export function describeEvidence(e: Evidence, names: NameOf): string {
  switch (e.type) {
    case "prefer_area":
      return `Prefers ${names(e.a)} to ${names(e.b)}`;
    case "pick_from_set":
      return `Chose ${names(e.chosen)} from ${e.set.length} areas`;
    case "reject_area":
      return `Rejected ${names(e.rejected)} from ${e.set.length} areas`;
    case "direction":
      return `${e.sign === 1 ? "More" : "Less"} ${FEATURE_LABELS[e.feature].toLowerCase()}`;
    case "magnitude":
      return `${FEATURE_LABELS[e.feature]}: ${e.tier}`;
    case "compare_importance":
      return `${FEATURE_LABELS[e.more]} matters more than ${FEATURE_LABELS[e.less].toLowerCase()}`;
    case "time_tradeoff":
      return `${e.accept ? "Would" : "Would not"} pay ¥${e.yen.toLocaleString("en-US")} a month to save ${e.minutes} min each way`;
    case "like_area":
      return `Likes ${names(e.area)}`;
    case "dislike_area":
      return `Dislikes ${names(e.area)}`;
  }
}

/** Re-adding a removed chip: the same evidence, without the old id (the engine assigns a new one). */
export function withoutId(e: LoggedEvidence): Evidence {
  const copy: LoggedEvidence = { ...e };
  delete (copy as { id?: string }).id;
  return copy as Evidence;
}

/** Engine-only answers to the next question, where one is posed. */
export function answersFor(q: NextQuestion, names: NameOf): { label: string; evidence: Evidence }[] {
  if (q.kind === "pair") {
    return [
      { label: names(q.a), evidence: preferPair(q.a, q.b, names) },
      { label: names(q.b), evidence: preferPair(q.b, q.a, names) },
    ];
  }
  if (q.kind === "pick_from_shortlist") {
    return q.set.map((id) => ({ label: names(id), evidence: pickFromSet(id, q.set, names) }));
  }
  return [];
}

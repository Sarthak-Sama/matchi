import { googleMapsUrl } from "../../../lib/format";
import { whyLine } from "./derive";
import { areaName } from "./evidence";
import { aboutYen } from "./format";
import type { ShortlistItem } from "./types";

function describe(item: ShortlistItem, index: number, list: readonly ShortlistItem[]): string {
  const name = item.nameJa === areaName(item) ? item.nameJa : `${areaName(item)} (${item.nameJa})`;
  const commute =
    item.commuteMinutes === null ? "" : `, ${Math.round(item.commuteMinutes)} min one way`;
  return [
    `${index + 1}. ${name}: ${aboutYen(item.rentYen)} a month (modelled, not a listing)${commute}`,
    `   ${whyLine(item, list)}`.trimEnd(),
    `   ${googleMapsUrl(item.lat, item.lon)}`,
  ]
    .filter((line) => line.trim() !== "")
    .join("\n");
}

/** The shortlist as plain text for a message or a note. */
export function shortlistText(list: readonly ShortlistItem[]): string {
  return list.map((item, i) => describe(item, i, list)).join("\n\n");
}

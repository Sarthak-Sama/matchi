import type { Importance, Layout, LifestyleAxisId } from "@tokyo/shared";
import { IMPORTANCE_OPTIONS, LAYOUT_IDS, LIFESTYLE_AXIS_IDS } from "@tokyo/shared";

import type { SelectedDestination } from "./useOptimizeSearch";

const QUERY_KEYS = {
  dest: "dest",
  destLabel: "destLabel",
  destLat: "destLat",
  destLon: "destLon",
  arrival: "arrival",
  maxCommute: "maxCommute",
  budget: "budget",
  layout: "layout",
} as const;

export interface ParsedSearchParams {
  readonly destination: SelectedDestination | null;
  readonly arrivalTime: string | null;
  readonly maxCommuteMinutes: number | null;
  readonly monthlyBudgetYen: number | null;
  readonly layout: Layout | null;
  readonly preferenceOverrides: Partial<Record<LifestyleAxisId, Importance>>;
}

/**
 * Parses a deep-link query string into the shape `useOptimizeSearch`'s
 * hydration effect applies to state. Preserves the current site's quirks
 * exactly, including that `maxCommute`/`budget` skip finiteness checking
 * (an invalid value like `?maxCommute=abc` yields `NaN`, matching today's
 * behavior) — that's a separate, behavior-changing fix if ever wanted.
 */
export function parseSearchParams(search: string): ParsedSearchParams {
  const params = new URLSearchParams(search);
  const stationId = params.get(QUERY_KEYS.dest);
  const lat = params.get(QUERY_KEYS.destLat);
  const lon = params.get(QUERY_KEYS.destLon);
  const label = params.get(QUERY_KEYS.destLabel);
  const parsedLat = lat === null ? null : Number(lat);
  const parsedLon = lon === null ? null : Number(lon);

  let destination: SelectedDestination | null = null;
  if (
    parsedLat !== null &&
    parsedLon !== null &&
    Number.isFinite(parsedLat) &&
    Number.isFinite(parsedLon)
  ) {
    destination = {
      kind: "point",
      lat: parsedLat,
      lon: parsedLon,
      label: label ?? "Destination point",
    };
  } else if (stationId) {
    destination = { kind: "station", stationGroupId: stationId, label: label ?? stationId };
  }

  const arrival = params.get(QUERY_KEYS.arrival);
  const maxCommute = params.get(QUERY_KEYS.maxCommute);
  const budget = params.get(QUERY_KEYS.budget);
  const layoutParam = params.get(QUERY_KEYS.layout);

  const preferenceOverrides: Partial<Record<LifestyleAxisId, Importance>> = {};
  for (const id of LIFESTYLE_AXIS_IDS) {
    const value = params.get(id);
    if (value && IMPORTANCE_OPTIONS.includes(value as Importance)) {
      preferenceOverrides[id] = value as Importance;
    }
  }

  return {
    destination,
    arrivalTime: arrival ? arrival : null,
    maxCommuteMinutes: maxCommute ? Number(maxCommute) : null,
    monthlyBudgetYen: budget ? Number(budget) : null,
    layout:
      layoutParam && (LAYOUT_IDS as readonly string[]).includes(layoutParam)
        ? (layoutParam as Layout)
        : null,
    preferenceOverrides,
  };
}

export interface SearchQueryStringInputs {
  readonly selectedDestination: SelectedDestination;
  readonly arrivalTime: string;
  readonly maxCommuteMinutes: number;
  readonly monthlyBudgetYen: number;
  readonly layout: Layout;
  readonly preferences: Record<LifestyleAxisId, Importance | undefined>;
}

export function buildSearchQueryString(inputs: SearchQueryStringInputs): string {
  const {
    selectedDestination,
    arrivalTime,
    maxCommuteMinutes,
    monthlyBudgetYen,
    layout,
    preferences,
  } = inputs;

  const params = new URLSearchParams({
    [QUERY_KEYS.destLabel]: selectedDestination.label,
    [QUERY_KEYS.arrival]: arrivalTime,
    [QUERY_KEYS.maxCommute]: String(maxCommuteMinutes),
    [QUERY_KEYS.budget]: String(monthlyBudgetYen),
    [QUERY_KEYS.layout]: layout,
  });
  if (selectedDestination.kind === "station") {
    params.set(QUERY_KEYS.dest, selectedDestination.stationGroupId);
  } else {
    params.set(QUERY_KEYS.destLat, String(selectedDestination.lat));
    params.set(QUERY_KEYS.destLon, String(selectedDestination.lon));
  }
  for (const id of LIFESTYLE_AXIS_IDS) {
    const importance = preferences[id];
    if (importance !== undefined) params.set(id, importance);
  }
  return params.toString();
}

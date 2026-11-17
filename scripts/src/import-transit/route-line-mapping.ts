import type { GtfsRoute } from "./gtfs-static.js";

export interface RailLineCandidate {
  readonly railLineId: string;
  readonly nameJa: string;
  readonly nameEn: string | null;
}

export interface RouteLineMapping {
  readonly mapped: ReadonlyMap<string, string>;
  readonly unmapped: readonly string[];
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

export function mapRoutesToLines(
  routes: readonly GtfsRoute[],
  lines: readonly RailLineCandidate[],
): RouteLineMapping {
  const lineIds = new Set(lines.map((l) => l.railLineId));
  const namesByLine = lines.map((l) => ({
    railLineId: l.railLineId,
    names: [normalize(l.nameJa), l.nameEn ? normalize(l.nameEn) : undefined].filter(
      (n): n is string => n !== undefined,
    ),
  }));

  const mapped = new Map<string, string>();
  const unmapped: string[] = [];

  for (const route of routes) {
    if (lineIds.has(route.routeId)) {
      mapped.set(route.routeId, route.routeId);
      continue;
    }

    const routeNames = [route.shortName, route.longName]
      .filter((n): n is string => n !== undefined)
      .map(normalize);

    const match = namesByLine.find((line) => line.names.some((n) => routeNames.includes(n)));
    if (match) {
      mapped.set(route.routeId, match.railLineId);
    } else {
      unmapped.push(route.routeId);
    }
  }

  return { mapped, unmapped };
}

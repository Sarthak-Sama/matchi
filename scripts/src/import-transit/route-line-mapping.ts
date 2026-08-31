/**
 * Maps a GTFS `route_id` to an existing `rail_lines.rail_line_id`. Pure —
 * takes plain arrays (the caller fetches `rail_lines` itself), so it's
 * directly unit-testable with no `DATABASE_URL`.
 *
 * `buildGraph` THROWS on a `ride` edge with a null
 * `rail_line_id` — a real modeling hazard, not a defensive nicety, since a
 * null-line ride edge would silently be treated as "same line" as any
 * other null-line ride, charging no boarding wait and hiding an implicit
 * transfer. So a route this module cannot map is never force-mapped to
 * `null`: the caller skips writing ride edges for that route entirely and
 * warns loudly (see `import-transit.ts`), and this module's `unmapped`
 * list is exactly what drives that warning.
 *
 * Matching order:
 *   1. `route_id` equals an existing `rail_line_id` exactly. This is the
 *      expected common case: an ODPT/operator GTFS feed's `route_id`
 *      values are typically already stable per-operator-per-line
 *      identifiers, and this codebase's own `rail_line_id`s (see
 *      `import-mlit/rail-lines.ts`) are deliberately built the same way
 *      when the source lacks its own id. ASSUMPTION, not a guarantee —
 *      documented in this file.
 *   2. Otherwise, a case-insensitive, whitespace-trimmed match of the
 *      route's `route_short_name`/`route_long_name` against the line's
 *      `name_ja`/`name_en` (any combination).
 *   3. Otherwise: unmapped.
 */

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

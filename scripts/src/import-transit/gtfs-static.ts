/**
 * Parsing for GTFS's small "static" tables — `stops.txt`, `routes.txt`,
 * `trips.txt`, `calendar.txt`, `calendar_dates.txt` — all comfortably
 * small enough to load fully into memory (unlike `stop_times.txt`, which
 * `gtfs-stop-times.ts` streams instead). Reuses `lib/csv.ts`'s
 * `parseCsvRecords`/`pickColumn`/`expectColumns` rather than a new parser.
 *
 * ASSUMED GTFS column names follow the GTFS reference exactly (`stop_id`,
 * `route_id`, `service_id`, etc.) — this is a standardized public format,
 * unlike MLIT's ad hoc field codes, so no alias list is needed here.
 */

import { expectColumns } from "../lib/validate.js";
import { parseCsvRecords, parseNumericCell } from "../lib/csv.js";

export interface GtfsStop {
  readonly stopId: string;
  readonly name: string;
  readonly lat: number;
  readonly lon: number;
  /** Set only for a child (platform-level) stop; references another stop's `stopId`. */
  readonly parentStation: string | undefined;
}

export function parseGtfsStops(text: string): GtfsStop[] {
  const records = parseCsvRecords(text);
  return records.map((record, index) => {
    const context = `stops.txt row #${index + 1}`;
    expectColumns(record, ["stop_id", "stop_name", "stop_lat", "stop_lon"], context);
    const lat = parseNumericCell(record["stop_lat"], `${context} stop_lat`);
    const lon = parseNumericCell(record["stop_lon"], `${context} stop_lon`);
    if (lat === undefined || lon === undefined) {
      throw new Error(`${context}: stop_lat/stop_lon must be numeric`);
    }
    const parentStation = record["parent_station"];
    return {
      stopId: String(record["stop_id"]),
      name: String(record["stop_name"]),
      lat,
      lon,
      parentStation:
        parentStation !== undefined && parentStation !== "" ? parentStation : undefined,
    };
  });
}

export interface GtfsRoute {
  readonly routeId: string;
  readonly shortName: string | undefined;
  readonly longName: string | undefined;
}

export function parseGtfsRoutes(text: string): GtfsRoute[] {
  const records = parseCsvRecords(text);
  return records.map((record, index) => {
    const context = `routes.txt row #${index + 1}`;
    expectColumns(record, ["route_id"], context);
    return {
      routeId: String(record["route_id"]),
      shortName: record["route_short_name"] || undefined,
      longName: record["route_long_name"] || undefined,
    };
  });
}

export interface GtfsTrip {
  readonly tripId: string;
  readonly routeId: string;
  readonly serviceId: string;
}

export function parseGtfsTrips(text: string): GtfsTrip[] {
  const records = parseCsvRecords(text);
  return records.map((record, index) => {
    const context = `trips.txt row #${index + 1}`;
    expectColumns(record, ["trip_id", "route_id", "service_id"], context);
    return {
      tripId: String(record["trip_id"]),
      routeId: String(record["route_id"]),
      serviceId: String(record["service_id"]),
    };
  });
}

export interface GtfsCalendar {
  readonly serviceId: string;
  readonly monday: boolean;
  readonly tuesday: boolean;
  readonly wednesday: boolean;
  readonly thursday: boolean;
  readonly friday: boolean;
  readonly saturday: boolean;
  readonly sunday: boolean;
}

function toBool(raw: string | undefined, context: string): boolean {
  if (raw === "1") return true;
  if (raw === "0" || raw === undefined || raw === "") return false;
  throw new Error(`${context}: expected "0" or "1", got "${raw}"`);
}

export function parseGtfsCalendar(text: string): GtfsCalendar[] {
  const records = parseCsvRecords(text);
  return records.map((record, index) => {
    const context = `calendar.txt row #${index + 1}`;
    expectColumns(record, ["service_id"], context);
    return {
      serviceId: String(record["service_id"]),
      monday: toBool(record["monday"], `${context} monday`),
      tuesday: toBool(record["tuesday"], `${context} tuesday`),
      wednesday: toBool(record["wednesday"], `${context} wednesday`),
      thursday: toBool(record["thursday"], `${context} thursday`),
      friday: toBool(record["friday"], `${context} friday`),
      saturday: toBool(record["saturday"], `${context} saturday`),
      sunday: toBool(record["sunday"], `${context} sunday`),
    };
  });
}

/** GTFS `exception_type`: `1` = service added on this date, `2` = removed. */
export interface GtfsCalendarDate {
  readonly serviceId: string;
  readonly date: string;
  readonly exceptionType: 1 | 2;
}

export function parseGtfsCalendarDates(text: string): GtfsCalendarDate[] {
  const records = parseCsvRecords(text);
  return records.map((record, index) => {
    const context = `calendar_dates.txt row #${index + 1}`;
    expectColumns(record, ["service_id", "date", "exception_type"], context);
    const exceptionType = record["exception_type"];
    if (exceptionType !== "1" && exceptionType !== "2") {
      throw new Error(`${context}: exception_type must be "1" or "2", got "${exceptionType}"`);
    }
    return {
      serviceId: String(record["service_id"]),
      date: String(record["date"]),
      exceptionType: exceptionType === "1" ? 1 : 2,
    };
  });
}

/** `date` is `YYYYMMDD`. Returns true for Monday-Friday (JS `Date#getDay` 1-5). */
function isWeekdayDate(date: string): boolean {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(4, 6));
  const day = Number(date.slice(6, 8));
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return weekday >= 1 && weekday <= 5;
}

/**
 * Selects `service_id`s that count as "a typical weekday" for this
 * import's median/headway computations.
 *
 * ASSUMPTION: a `calendar.txt` row
 * counts as a weekday service iff `monday` THROUGH `friday` are ALL `1`
 * — the standard "runs every weekday" pattern GTFS feeds use, distinct
 * from a weekend-only (`saturday`/`sunday` = 1, weekdays = 0) or
 * every-day-of-the-week service. `saturday`/`sunday` on that row are NOT
 * required to be `0` — a genuine every-day service still legitimately
 * "runs on weekdays" and should be included.
 *
 * `calendar_dates.txt` is consulted only as a fallback for a
 * `service_id` that has NO `calendar.txt` row at all (a "calendar_dates
 * only" feed, increasingly common) — such a service counts as a weekday
 * service if AT LEAST ONE of its `exception_type = 1` (added) dates falls
 * on a Monday-Friday. This is an approximation for a service defined by
 * many individual added dates (some of which may be weekend specials);
 * documented as a known limitation, not exercised by any single-date
 * fixture row today. `exception_type = 2` (removed) dates and dates
 * layered on TOP of a `calendar.txt` row are not applied at all — this
 * importer picks a service in or out for the whole run, it does not
 * resolve exceptions against one specific reference date.
 */
export function selectWeekdayServiceIds(
  calendars: readonly GtfsCalendar[],
  calendarDates: readonly GtfsCalendarDate[],
): Set<string> {
  const weekday = new Set<string>();
  const seenInCalendar = new Set<string>();

  for (const cal of calendars) {
    seenInCalendar.add(cal.serviceId);
    if (cal.monday && cal.tuesday && cal.wednesday && cal.thursday && cal.friday) {
      weekday.add(cal.serviceId);
    }
  }

  const addedDatesByService = new Map<string, string[]>();
  for (const cd of calendarDates) {
    if (cd.exceptionType !== 1) continue;
    if (seenInCalendar.has(cd.serviceId)) continue;
    const dates = addedDatesByService.get(cd.serviceId) ?? [];
    dates.push(cd.date);
    addedDatesByService.set(cd.serviceId, dates);
  }
  for (const [serviceId, dates] of addedDatesByService) {
    if (dates.some((d) => isWeekdayDate(d))) {
      weekday.add(serviceId);
    }
  }

  return weekday;
}

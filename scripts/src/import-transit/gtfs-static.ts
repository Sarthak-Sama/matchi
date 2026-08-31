import { expectColumns } from "../lib/validate.js";
import { parseCsvRecords, parseNumericCell } from "../lib/csv.js";

export interface GtfsStop {
  readonly stopId: string;
  readonly name: string;
  readonly lat: number;
  readonly lon: number;

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

function isWeekdayDate(date: string): boolean {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(4, 6));
  const day = Number(date.slice(6, 8));
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return weekday >= 1 && weekday <= 5;
}

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

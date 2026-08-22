/**
 * GTFS `HH:MM:SS` time parsing.
 *
 * GTFS explicitly allows an hour component >= 24 for a trip that departs
 * after midnight but still belongs to the PREVIOUS service day (e.g.
 * `25:10:00` for a 01:10 departure on a late-night run) — see the GTFS
 * reference for `stop_times.arrival_time`/`departure_time`. `parseGtfsTime`
 * preserves that rollover as minutes >= 1440 rather than wrapping, because
 * headway/travel-time arithmetic between two stop_times rows of the SAME
 * trip must stay monotonic (a `25:10:00` departure must sort after a
 * `23:50:00` one, which wrapping to `01:10` would break).
 *
 * `minutesOfDay` is the separate, deliberately lossy operation used only
 * to classify a timestamp against `PEAK_WINDOW` (which is itself expressed
 * in a plain 0-1439 minutes-from-midnight range) — see its own doc comment.
 */

const TIME_PATTERN = /^(\d{1,3}):([0-5]\d):([0-5]\d)$/;

/** Parses `HH:MM:SS` (hour may exceed 23) into total minutes since midnight. */
export function parseGtfsTime(raw: string, context: string): number {
  const trimmed = raw.trim();
  const match = TIME_PATTERN.exec(trimmed);
  if (!match) {
    throw new Error(`${context}: "${raw}" is not a valid GTFS HH:MM:SS time`);
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  return hours * 60 + minutes + seconds / 60;
}

/**
 * Reduces a `parseGtfsTime` result (which may be >= 1440 for a post-
 * midnight rollover trip) to a plain 0-1439 minutes-of-day value, for
 * comparison against `PEAK_WINDOW`. A trip's peak/off-peak classification
 * is about real clock time of day, not which service day GTFS nominally
 * attributes the trip to.
 */
export function minutesOfDay(totalMinutes: number): number {
  const wrapped = totalMinutes % 1440;
  return wrapped < 0 ? wrapped + 1440 : wrapped;
}

/**
 * Maps a request's `arrivalTime` to the peak/off-peak period used to pick
 * which weight column (`peak_*` vs `offpeak_*`) a graph is built from.
 */

import { PEAK_WINDOW } from "@tokyo/shared";

/** Which weight set a `TransitGraph` was built from. */
export type Period = "peak" | "offpeak";

/**
 * `arrivalTime` is 24-hour `HH:MM` (matches
 * `optimizationRequestSchema.arrivalTime`'s regex — the caller is
 * responsible for validating the format before calling this).
 *
 * Peak iff `PEAK_WINDOW.startMinutes <= minutes < PEAK_WINDOW.endMinutes`
 * (07:30 inclusive, 10:00 exclusive).
 */
export function resolvePeriod(arrivalTime: string): Period {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(arrivalTime);
  if (!match) {
    throw new Error(`resolvePeriod: "${arrivalTime}" is not a valid HH:MM 24-hour time`);
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const totalMinutes = hours * 60 + minutes;

  const isPeak = totalMinutes >= PEAK_WINDOW.startMinutes && totalMinutes < PEAK_WINDOW.endMinutes;
  return isPeak ? "peak" : "offpeak";
}

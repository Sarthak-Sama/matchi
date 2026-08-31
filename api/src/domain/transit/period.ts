import { PEAK_WINDOW } from "@tokyo/shared";

export type Period = "peak" | "offpeak";

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

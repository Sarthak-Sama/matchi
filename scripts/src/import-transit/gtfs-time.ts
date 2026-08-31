const TIME_PATTERN = /^(\d{1,3}):([0-5]\d):([0-5]\d)$/;

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

export function minutesOfDay(totalMinutes: number): number {
  const wrapped = totalMinutes % 1440;
  return wrapped < 0 ? wrapped + 1440 : wrapped;
}

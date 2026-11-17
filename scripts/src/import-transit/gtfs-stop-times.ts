import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

import { parseCsv } from "../lib/csv.js";
import { parseGtfsTime } from "./gtfs-time.js";

export interface StopTimeRow {
  readonly tripId: string;
  readonly stopId: string;
  readonly stopSequence: number;
  readonly arrivalMinutes: number;
  readonly departureMinutes: number;
}

export async function streamRelevantStopTimes(
  filePath: string,
  relevantTripIds: ReadonlySet<string>,
): Promise<Map<string, StopTimeRow[]>> {
  const byTrip = new Map<string, StopTimeRow[]>();

  const rl = createInterface({
    input: createReadStream(filePath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  let header: string[] | undefined;
  let lineNumber = 0;
  let tripIdIdx = -1;
  let stopIdIdx = -1;
  let stopSequenceIdx = -1;
  let arrivalTimeIdx = -1;
  let departureTimeIdx = -1;

  for await (const line of rl) {
    lineNumber++;
    if (line.trim() === "") continue;

    const cells = parseCsv(line)[0];
    if (cells === undefined) continue;

    if (header === undefined) {
      header = cells.map((c) => c.trim());
      tripIdIdx = header.indexOf("trip_id");
      stopIdIdx = header.indexOf("stop_id");
      stopSequenceIdx = header.indexOf("stop_sequence");
      arrivalTimeIdx = header.indexOf("arrival_time");
      departureTimeIdx = header.indexOf("departure_time");
      const missing = [
        ["trip_id", tripIdIdx],
        ["stop_id", stopIdIdx],
        ["stop_sequence", stopSequenceIdx],
        ["arrival_time", arrivalTimeIdx],
        ["departure_time", departureTimeIdx],
      ]
        .filter(([, idx]) => idx === -1)
        .map(([name]) => name);
      if (missing.length > 0) {
        throw new Error(`stop_times.txt: missing required column(s): ${missing.join(", ")}`);
      }
      continue;
    }

    const tripId = cells[tripIdIdx];
    if (tripId === undefined || !relevantTripIds.has(tripId)) continue;

    const context = `stop_times.txt line ${String(lineNumber)}`;
    const stopId = cells[stopIdIdx];
    const stopSequenceRaw = cells[stopSequenceIdx];
    const arrivalTimeRaw = cells[arrivalTimeIdx];
    const departureTimeRaw = cells[departureTimeIdx];
    if (
      stopId === undefined ||
      stopSequenceRaw === undefined ||
      arrivalTimeRaw === undefined ||
      departureTimeRaw === undefined
    ) {
      throw new Error(`${context}: row has fewer cells than the header`);
    }

    const stopSequence = Number(stopSequenceRaw);
    if (!Number.isFinite(stopSequence)) {
      throw new Error(`${context}: stop_sequence "${stopSequenceRaw}" is not a number`);
    }

    const row: StopTimeRow = {
      tripId,
      stopId,
      stopSequence,
      arrivalMinutes: parseGtfsTime(arrivalTimeRaw, `${context} arrival_time`),
      departureMinutes: parseGtfsTime(departureTimeRaw, `${context} departure_time`),
    };

    const rows = byTrip.get(tripId);
    if (rows) {
      rows.push(row);
    } else {
      byTrip.set(tripId, [row]);
    }
  }

  for (const rows of byTrip.values()) {
    rows.sort((a, b) => a.stopSequence - b.stopSequence);
  }

  return byTrip;
}

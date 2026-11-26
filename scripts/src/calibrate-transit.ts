import type { PoolClient } from "pg";

import {
  buildGraph,
  DWELL_SECONDS_PER_INTERMEDIATE_STATION,
  FALLBACK_SPEEDS_KMH,
  haversineMeters,
  PEAK_WINDOW,
  reverseDijkstra,
  TRANSFER_PENALTY_MINUTES,
} from "@tokyo/shared";
import type { RailEdgeRow, TransitPeriod } from "@tokyo/shared";

import { runImportCliIfMain } from "./lib/cli.js";
import type { ImportResult } from "./lib/import-run.js";

type Mode = keyof typeof FALLBACK_SPEEDS_KMH;

// Edges written by `import:transit --from-topology`; only these have a speed to
// fit. GTFS edges carry real timetable minutes and stay fixed.
const FALLBACK_SOURCE = "mlit-topology";

// Must match the detour factor fallback-topology.ts applies to straight-line
// distance, or the refitted minutes will not reproduce what the import writes.
const DETOUR_FACTOR = 1.15;

const MIN_REFERENCES = 10;
const SPEED_SCALES = Array.from({ length: 21 }, (_, i) => 0.6 + i * 0.05);
const PENALTY_GRID_MINUTES = Array.from({ length: 25 }, (_, i) => i * 0.5);
const MAX_ROUNDS = 5;

interface RideEdge {
  readonly row: RailEdgeRow;
  // Present only for fallback edges, whose minutes are rebuilt per candidate.
  readonly fallback?: { readonly mode: Mode; readonly distanceM: number };
}

interface Reference {
  readonly label: string;
  readonly period: TransitPeriod;
  readonly originIds: readonly string[];
  readonly destinationName: string;
  readonly destinationIds: readonly string[];
  readonly referenceMinutes: number;
}

interface Params {
  readonly speeds: Readonly<Partial<Record<Mode, number>>>;
  readonly transferPenaltyMinutes: number;
}

interface Score {
  readonly medianAbsError: number;
  readonly meanAbsError: number;
}

function periodOf(arrivalTime: string): TransitPeriod {
  const [hours = 0, minutes = 0] = arrivalTime.split(":").map(Number);
  const minuteOfDay = hours * 60 + minutes;
  return minuteOfDay >= PEAK_WINDOW.startMinutes && minuteOfDay < PEAK_WINDOW.endMinutes
    ? "peak"
    : "offpeak";
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle] ?? 0;
  return sorted.length % 2 === 1 ? upper : ((sorted[middle - 1] ?? 0) + upper) / 2;
}

async function loadEdges(client: PoolClient): Promise<RideEdge[]> {
  const { rows } = await client.query<{
    from_id: string;
    to_id: string;
    rail_line_id: string | null;
    edge_type: "ride" | "transfer";
    peak_travel: number;
    offpeak_travel: number;
    peak_wait: number;
    offpeak_wait: number;
    confidence: RailEdgeRow["confidence"];
    source: string;
    mode: Mode | null;
    from_lat: number;
    from_lon: number;
    to_lat: number;
    to_lon: number;
  }>(
    `SELECT re.from_station_group_id AS from_id, re.to_station_group_id AS to_id,
            re.rail_line_id, re.edge_type,
            re.peak_travel_minutes AS peak_travel, re.offpeak_travel_minutes AS offpeak_travel,
            re.peak_wait_minutes AS peak_wait, re.offpeak_wait_minutes AS offpeak_wait,
            re.confidence, re.source, rl.mode,
            ST_Y(a.point) AS from_lat, ST_X(a.point) AS from_lon,
            ST_Y(b.point) AS to_lat, ST_X(b.point) AS to_lon
     FROM rail_edges re
     LEFT JOIN rail_lines rl ON rl.rail_line_id = re.rail_line_id
     JOIN station_groups a ON a.station_group_id = re.from_station_group_id
     JOIN station_groups b ON b.station_group_id = re.to_station_group_id`,
  );
  return rows.map((r) => ({
    row: {
      fromStationGroupId: r.from_id,
      toStationGroupId: r.to_id,
      railLineId: r.rail_line_id,
      railLineName: null,
      edgeType: r.edge_type,
      peakTravelMinutes: r.peak_travel,
      offpeakTravelMinutes: r.offpeak_travel,
      peakWaitMinutes: r.peak_wait,
      offpeakWaitMinutes: r.offpeak_wait,
      confidence: r.confidence,
    },
    fallback:
      r.edge_type === "ride" && r.source === FALLBACK_SOURCE && r.mode !== null
        ? {
            mode: r.mode,
            distanceM: haversineMeters(r.from_lat, r.from_lon, r.to_lat, r.to_lon) * DETOUR_FACTOR,
          }
        : undefined,
  }));
}

async function loadReferences(client: PoolClient): Promise<Reference[]> {
  const { rows: stations } = await client.query<{ station_group_id: string; name_ja: string }>(
    `SELECT station_group_id, name_ja FROM station_groups`,
  );
  const idsByName = new Map<string, string[]>();
  for (const s of stations) {
    idsByName.set(s.name_ja, [...(idsByName.get(s.name_ja) ?? []), s.station_group_id]);
  }

  const { rows } = await client.query<{
    origin_name_ja: string;
    destination_name_ja: string;
    arrival_time: string;
    reference_minutes: number;
  }>(
    `SELECT origin_name_ja, destination_name_ja, arrival_time, reference_minutes
     FROM commute_reference`,
  );
  if (rows.length === 0) {
    throw new Error(
      "calibrate:transit — commute_reference is empty. Create data/commute-reference.csv " +
        "(see migration 0018 for the columns) and run `pnpm import:commute-reference` first.",
    );
  }

  const references: Reference[] = [];
  for (const r of rows) {
    const label = `${r.origin_name_ja} -> ${r.destination_name_ja} ${r.arrival_time}`;
    const originIds = idsByName.get(r.origin_name_ja);
    const destinationIds = idsByName.get(r.destination_name_ja);
    if (!originIds || !destinationIds) {
      console.warn(`calibrate:transit — skipping "${label}": no station_group with that name`);
      continue;
    }
    references.push({
      label,
      period: periodOf(r.arrival_time),
      originIds,
      destinationName: r.destination_name_ja,
      destinationIds,
      referenceMinutes: r.reference_minutes,
    });
  }
  return references;
}

function fallbackMinutes(distanceM: number, speedKmh: number): number {
  const dwellMinutes = DWELL_SECONDS_PER_INTERMEDIATE_STATION / 60;
  return (distanceM / 1000 / speedKmh) * 60 + dwellMinutes;
}

function candidateRows(edges: readonly RideEdge[], speeds: Params["speeds"]): RailEdgeRow[] {
  return edges.map(({ row, fallback }) => {
    const speed = fallback ? speeds[fallback.mode] : undefined;
    if (!fallback || speed === undefined) return row;
    const minutes = fallbackMinutes(fallback.distanceM, speed);
    return { ...row, peakTravelMinutes: minutes, offpeakTravelMinutes: minutes };
  });
}

// Modelled minutes per reference (undefined when no path exists), taking the
// fastest origin/destination pair among stations that share a name, exactly as
// derive/commute-error does against station_travel_times.
function predict(
  edges: readonly RideEdge[],
  references: readonly Reference[],
  params: Params,
): (number | undefined)[] {
  const rows = candidateRows(edges, params.speeds);
  const graphs = { peak: buildGraph(rows, "peak"), offpeak: buildGraph(rows, "offpeak") };
  const searches = new Map<string, ReturnType<typeof reverseDijkstra>>();

  return references.map((reference) => {
    const key = `${reference.period}|${reference.destinationName}`;
    let search = searches.get(key);
    if (!search) {
      search = reverseDijkstra(
        graphs[reference.period],
        reference.destinationIds.map((node) => ({ node, walkMinutes: 0 })),
        params.transferPenaltyMinutes,
      );
      searches.set(key, search);
    }
    const reached = reference.originIds
      .map((id) => search.get(id)?.totalMinutes)
      .filter((m): m is number => m !== undefined);
    return reached.length > 0 ? Math.min(...reached) : undefined;
  });
}

function score(
  edges: readonly RideEdge[],
  references: readonly Reference[],
  params: Params,
): Score {
  const predicted = predict(edges, references, params);
  const errors = references.map((r, i) =>
    Math.abs((predicted[i] ?? Infinity) - r.referenceMinutes),
  );
  return {
    medianAbsError: median(errors),
    meanAbsError: errors.reduce((sum, e) => sum + e, 0) / errors.length,
  };
}

// The median is flat across many candidates, so the mean breaks ties.
function isBetter(candidate: Score, best: Score): boolean {
  if (candidate.medianAbsError !== best.medianAbsError) {
    return candidate.medianAbsError < best.medianAbsError;
  }
  return candidate.meanAbsError < best.meanAbsError;
}

type Sweep = (current: Params) => Params[];

function speedSweep(mode: Mode): Sweep {
  return (current) =>
    SPEED_SCALES.map((scale) => ({
      ...current,
      speeds: {
        ...current.speeds,
        [mode]: Math.round(FALLBACK_SPEEDS_KMH[mode] * scale * 10) / 10,
      },
    }));
}

const penaltySweep: Sweep = (current) =>
  PENALTY_GRID_MINUTES.map((transferPenaltyMinutes) => ({ ...current, transferPenaltyMinutes }));

// Coordinate descent: sweep each parameter's grid with the others held fixed,
// and repeat until a full round improves nothing. A full grid over every
// parameter at once would be thousands of routing runs for little gain.
function fit(
  edges: readonly RideEdge[],
  references: readonly Reference[],
  modes: readonly Mode[],
): { params: Params; score: Score } {
  let params: Params = {
    speeds: Object.fromEntries(modes.map((mode) => [mode, FALLBACK_SPEEDS_KMH[mode]])),
    transferPenaltyMinutes: TRANSFER_PENALTY_MINUTES,
  };
  let best = score(edges, references, params);
  const sweeps = [...modes.map(speedSweep), penaltySweep];

  for (let round = 0; round < MAX_ROUNDS; round++) {
    let improved = false;
    for (const sweep of sweeps) {
      for (const candidate of sweep(params)) {
        const candidateScore = score(edges, references, candidate);
        if (isBetter(candidateScore, best)) {
          best = candidateScore;
          params = candidate;
          improved = true;
        }
      }
    }
    if (!improved) break;
  }
  return { params, score: best };
}

function describe(label: string, s: Score): string {
  return `${label}: median abs error ${s.medianAbsError.toFixed(2)} min, mean ${s.meanAbsError.toFixed(2)} min`;
}

async function writeParams(client: PoolClient, params: Params): Promise<number> {
  const entries: [string, number][] = [
    ...Object.entries(params.speeds).map(([mode, speed]): [string, number] => [
      `speed_kmh.${mode}`,
      speed,
    ]),
    ["transfer_penalty_minutes", params.transferPenaltyMinutes],
  ];
  for (const [key, value] of entries) {
    await client.query(
      `INSERT INTO transit_params (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, fitted_at = now()`,
      [key, value],
    );
  }
  return entries.length;
}

export async function runTransitCalibration(client: PoolClient): Promise<ImportResult> {
  const edges = await loadEdges(client);
  if (edges.length === 0) {
    throw new Error("calibrate:transit — rail_edges is empty. Run `pnpm import:transit` first.");
  }
  const modes = [...new Set(edges.flatMap((e) => (e.fallback ? [e.fallback.mode] : [])))];
  if (modes.length === 0) {
    throw new Error(
      `calibrate:transit — no ride edges with source='${FALLBACK_SOURCE}', so there is no speed to ` +
        "fit. Run `pnpm import:transit --from-topology` first.",
    );
  }

  const defaults: Params = {
    speeds: FALLBACK_SPEEDS_KMH,
    transferPenaltyMinutes: TRANSFER_PENALTY_MINUTES,
  };
  const resolved = await loadReferences(client);
  const baseline = predict(edges, resolved, defaults);
  const references = resolved.filter((r, i) => {
    if (baseline[i] !== undefined) return true;
    console.warn(`calibrate:transit — skipping "${r.label}": no rail path between the stations`);
    return false;
  });
  if (references.length < MIN_REFERENCES) {
    throw new Error(
      `calibrate:transit — only ${String(references.length)} usable reference journeys; need at ` +
        `least ${String(MIN_REFERENCES)} to fit ${String(modes.length + 1)} parameters.`,
    );
  }

  const result = fit(edges, references, modes);
  console.log(describe("before", score(edges, references, defaults)));
  console.log(describe("after", result.score));
  console.log(
    `calibrate:transit — fitted ${JSON.stringify(result.params)}. Re-run ` +
      "`pnpm import:transit --from-topology` and then `pnpm derive` to apply them.",
  );

  return { rowsImported: await writeParams(client, result.params) };
}

runImportCliIfMain(import.meta.url, {
  commandName: "calibrate:transit",
  commandExample: "pnpm calibrate:transit",
  parseArgs: () => undefined,
  source: () => "transit-calibration",
  run: (client) => runTransitCalibration(client),
});

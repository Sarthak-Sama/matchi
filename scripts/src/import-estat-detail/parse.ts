import { bandedMedian } from "../derive/fit.js";
import type { CountBand } from "../derive/fit.js";
import { TOKYO_WARD_CODES } from "../import-rent/estat-api.js";

type JsonRecord = Record<string, unknown>;

export interface EstatCell {
  readonly dims: Readonly<Record<string, string>>;
  readonly value: number;
}

function rec(value: unknown, label: string): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error(`e-Stat: ${label} is missing or malformed`);
  return value as JsonRecord;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : value === undefined ? [] : [value];
}

// Parses a getStatsData response into cells. "-" is the survey's zero; any
// other non-numeric cell (X, …, ***) is a suppressed value and fails loudly.
export function parseStatsData(raw: unknown, tableId: string): EstatCell[] {
  const get = rec(rec(raw, "root")["GET_STATS_DATA"], "GET_STATS_DATA");
  const result = rec(get["RESULT"], "RESULT");
  if (String(result["STATUS"]) !== "0")
    throw new Error(`e-Stat ${tableId}: ${String(result["ERROR_MSG"] ?? result["STATUS"])}`);
  const data = rec(rec(get["STATISTICAL_DATA"], "STATISTICAL_DATA")["DATA_INF"], "DATA_INF");
  return list(data["VALUE"]).map((entry, index) => {
    const cell = rec(entry, `VALUE #${index}`);
    const dims: Record<string, string> = {};
    for (const [key, v] of Object.entries(cell)) {
      if (key.startsWith("@") && key !== "@unit") dims[key.slice(1)] = String(v);
    }
    const text = String(cell["$"]);
    const value = text === "-" ? 0 : Number(text);
    if (!/^-$|^\d+(\.\d+)?$/.test(text) || !Number.isFinite(value))
      throw new Error(`e-Stat ${tableId}: VALUE #${index} is suppressed or malformed ("${text}")`);
    return { dims, value };
  });
}

// Class codes and labels as published. The importer checks the live
// metadata against these labels so a re-coded table fails instead of
// silently shifting bands.
export const RENT_BANDS = [
  { code: "01", label: "0円", low: 0, high: 1 },
  { code: "02", label: "1～10,000円未満", low: 1, high: 10_000 },
  { code: "03", label: "10,000～20,000円未満", low: 10_000, high: 20_000 },
  { code: "04", label: "20,000～40,000円未満", low: 20_000, high: 40_000 },
  { code: "05", label: "40,000～60,000円未満", low: 40_000, high: 60_000 },
  { code: "06", label: "60,000～80,000円未満", low: 60_000, high: 80_000 },
  { code: "07", label: "80,000～100,000円未満", low: 80_000, high: 100_000 },
  { code: "08", label: "100,000～150,000円未満", low: 100_000, high: 150_000 },
  { code: "09", label: "150,000～200,000円未満", low: 150_000, high: 200_000 },
  { code: "10", label: "200,000円以上", low: 200_000, high: null },
  { code: "99", label: "不詳", low: null, high: null },
] as const;

export const SIZE_CLASSES = [
  { code: "0", label: "総数", min: null, max: null },
  { code: "1", label: "5.9畳以下", min: 0, max: 6 },
  { code: "2", label: "6.0～11.9畳", min: 6, max: 12 },
  { code: "3", label: "12.0～17.9畳", min: 12, max: 18 },
  { code: "4", label: "18.0～23.9畳", min: 18, max: 24 },
  { code: "5", label: "24.0～29.9畳", min: 24, max: 30 },
  { code: "6", label: "30.0畳以上", min: 30, max: null },
] as const;

// 01 (0 yen) and 99 (not stated) are left out of the medians.
export const PER_TATAMI_BANDS = [
  { code: "02", label: "1～500円未満", low: 1, high: 500 },
  { code: "03", label: "500～750円未満", low: 500, high: 750 },
  { code: "04", label: "750～1,000円未満", low: 750, high: 1000 },
  { code: "05", label: "1,000～1,250円未満", low: 1000, high: 1250 },
  { code: "06", label: "1,250～1,500円未満", low: 1250, high: 1500 },
  { code: "07", label: "1,500～1,750円未満", low: 1500, high: 1750 },
  { code: "08", label: "1,750～2,000円未満", low: 1750, high: 2000 },
  { code: "09", label: "2,000～2,250円未満", low: 2000, high: 2250 },
  { code: "10", label: "2,250～2,500円未満", low: 2250, high: 2500 },
  { code: "11", label: "2,500～2,750円未満", low: 2500, high: 2750 },
  { code: "12", label: "2,750～3,000円未満", low: 2750, high: 3000 },
  { code: "13", label: "3,000～3,500円未満", low: 3000, high: 3500 },
  { code: "14", label: "3,500～4,000円未満", low: 3500, high: 4000 },
  { code: "15", label: "4,000～5,000円未満", low: 4000, high: 5000 },
  { code: "16", label: "5,000～6,000円未満", low: 5000, high: 6000 },
  { code: "17", label: "6,000～8,000円未満", low: 6000, high: 8000 },
  { code: "18", label: "8,000円以上", low: 8000, high: null },
] as const;

export function classLabels(raw: unknown, classId: string): Map<string, string> {
  const get = rec(rec(raw, "root")["GET_STATS_DATA"], "GET_STATS_DATA");
  const stat = rec(get["STATISTICAL_DATA"], "STATISTICAL_DATA");
  const classInf = rec(stat["CLASS_INF"], "CLASS_INF (request metaGetFlg=Y)");
  for (const obj of list(classInf["CLASS_OBJ"])) {
    const o = rec(obj, "CLASS_OBJ");
    if (o["@id"] !== classId) continue;
    return new Map(
      list(o["CLASS"]).map((c) => {
        const r = rec(c, "CLASS");
        return [String(r["@code"]), String(r["@name"])];
      }),
    );
  }
  throw new Error(`e-Stat: class ${classId} not in metadata`);
}

export function assertLabels(
  labels: Map<string, string>,
  expected: readonly { code: string; label: string }[],
  context: string,
): void {
  for (const { code, label } of expected) {
    const actual = labels.get(code);
    if (actual !== label)
      throw new Error(`${context}: class ${code} is "${actual ?? "missing"}", expected "${label}"`);
  }
}

export interface RentBandRow {
  readonly wardCode: string;
  readonly bandCode: string;
  readonly low: number | null;
  readonly high: number | null;
  readonly dwellings: number;
  readonly wardTotal: number;
}

export function buildRentBands(cells: readonly EstatCell[]): RentBandRow[] {
  const byWard = new Map<string, Map<string, number>>();
  for (const cell of cells) {
    if (cell.dims["cat01"] !== "0") continue;
    const ward = cell.dims["area"] ?? "";
    const m = byWard.get(ward) ?? new Map<string, number>();
    m.set(cell.dims["cat02"] ?? "", cell.value);
    byWard.set(ward, m);
  }
  const rows: RentBandRow[] = [];
  for (const ward of TOKYO_WARD_CODES) {
    const m = byWard.get(ward);
    const total = m?.get("00");
    if (!m || total === undefined) throw new Error(`rent bands: no total for ward ${ward}`);
    let sum = 0;
    for (const band of RENT_BANDS) {
      const dwellings = m.get(band.code);
      if (dwellings === undefined) throw new Error(`rent bands: ward ${ward} lacks band ${band.code}`);
      sum += dwellings;
      rows.push({ wardCode: ward, bandCode: band.code, low: band.low, high: band.high, dwellings, wardTotal: total });
    }
    // Survey counts are rounded independently, so allow a small residual.
    if (Math.abs(sum - total) > Math.max(50, total * 0.005))
      throw new Error(`rent bands: ward ${ward} bands sum to ${sum}, total is ${total}`);
  }
  return rows;
}

export interface SizeCurveRow {
  readonly sizeClassCode: string;
  readonly tatamiMin: number | null;
  readonly tatamiMax: number | null;
  readonly dwellings: number;
  readonly medianRentPerTatami: number | null;
  readonly relativeToAll: number | null;
}

export function buildSizeCurve(cells: readonly EstatCell[], area = "13100", tenure = "13"): SizeCurveRow[] {
  const counts = new Map<string, Map<string, number>>();
  for (const cell of cells) {
    if (cell.dims["area"] !== area || cell.dims["cat01"] !== tenure) continue;
    const size = cell.dims["cat02"] ?? "";
    const m = counts.get(size) ?? new Map<string, number>();
    m.set(cell.dims["cat03"] ?? "", cell.value);
    counts.set(size, m);
  }
  const rows = SIZE_CLASSES.map((size) => {
    const m = counts.get(size.code);
    if (!m) throw new Error(`size curve: no cells for size class ${size.code}`);
    const bands: CountBand[] = PER_TATAMI_BANDS.map((b) => ({
      low: b.low,
      high: b.high,
      count: m.get(b.code) ?? 0,
    }));
    return {
      sizeClassCode: size.code,
      tatamiMin: size.min,
      tatamiMax: size.max,
      dwellings: bands.reduce((s, b) => s + b.count, 0),
      medianRentPerTatami: bandedMedian(bands),
    };
  });
  const all = rows.find((r) => r.sizeClassCode === "0")?.medianRentPerTatami ?? null;
  return rows.map((r) => ({
    ...r,
    relativeToAll: all && r.medianRentPerTatami !== null ? r.medianRentPerTatami / all : null,
  }));
}

export function buildWardPopulation(cells: readonly EstatCell[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const cell of cells) {
    const area = cell.dims["area"] ?? "";
    if (cell.dims["cat01"] === "0" && TOKYO_WARD_CODES.includes(area)) out.set(area, cell.value);
  }
  const missing = TOKYO_WARD_CODES.filter((w) => !out.has(w));
  if (missing.length) throw new Error(`census totals: missing ward(s) ${missing.join(", ")}`);
  return out;
}

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { DATA_DIR } from "../data-catalog.js";

export const ESTAT_API_BASE = "https://api.e-stat.go.jp/rest/3.0/app/json/getStatsData";
export const ESTAT_RENT_TABLE_ID = "0004021492";
export const ESTAT_FEE_TABLE_ID = "0004021437";
export const ESTAT_TIME = "2023000000";
export const ESTAT_SOURCE_UPDATED_AT = new Date("2025-03-27T00:00:00.000Z");
export const TOKYO_WARD_CODES = Array.from(
  { length: 23 },
  (_, index) => `131${String(index + 1).padStart(2, "0")}`,
);

type JsonRecord = Record<string, unknown>;
export interface EstatValue {
  readonly area: string;
  readonly cat01: string;
  readonly cat02: string;
  readonly time: string;
  readonly value: number;
  readonly unit: string;
}
export interface EstatApiResponse {
  readonly tableId: string;
  readonly values: readonly EstatValue[];
  readonly raw: unknown;
}

function record(value: unknown, label: string): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error(`e-Stat API: ${label} is missing or malformed`);
  return value as JsonRecord;
}
function asArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : value === undefined ? [] : [value];
}
function text(value: unknown): string | undefined {
  return typeof value === "string" || typeof value === "number" ? String(value) : undefined;
}

function statusError(json: JsonRecord): string | null {
  const result = json["GET_STATS_DATA"];
  if (!result || typeof result !== "object") return "missing GET_STATS_DATA";
  const status = (result as JsonRecord)["RESULT"];
  const code = text(
    typeof status === "object" && status !== null ? (status as JsonRecord)["STATUS"] : undefined,
  );
  if (code !== undefined && code !== "0")
    return text((status as JsonRecord)["ERROR_MSG"]) ?? `status ${code}`;
  return null;
}

/** Parses only the e-Stat v3 shape this importer requests. Validation is
 * deliberately before database work: incorrect dimensions are never
 * interpreted positionally as a rent number. */
export function parseEstatApiResponse(
  raw: unknown,
  expected: { tableId: string; cat01: string; cat02: string },
): EstatApiResponse {
  const root = record(raw, "root");
  const error = statusError(root);
  if (error) throw new Error(`e-Stat API ${expected.tableId}: ${error}`);
  const get = record(root["GET_STATS_DATA"], "GET_STATS_DATA");
  const statistical = record(get["STATISTICAL_DATA"], "STATISTICAL_DATA");
  const table = record(statistical["TABLE_INF"], "TABLE_INF");
  const statisticsName =
    typeof table["STATISTICS_NAME"] === "object" && table["STATISTICS_NAME"] !== null
      ? (table["STATISTICS_NAME"] as JsonRecord)
      : undefined;
  const actualTable = text(table["@id"] ?? statisticsName?.["@id"]);
  if (actualTable !== undefined && actualTable !== expected.tableId) {
    throw new Error(`e-Stat API: expected table ${expected.tableId}, received ${actualTable}`);
  }
  const values = asArray(record(statistical["DATA_INF"], "DATA_INF")["VALUE"]).map(
    (entry, index) => {
      const value = record(entry, `VALUE #${index}`);
      const area = text(value["@area"]);
      const cat01 = text(value["@cat01"]);
      const cat02 = text(value["@cat02"]);
      const time = text(value["@time"]);
      const number = Number(text(value["$"] ?? value["value"]));
      const unit = text(value["@unit"]) ?? "";
      if (!area || !cat01 || !cat02 || !time || !Number.isFinite(number))
        throw new Error(`e-Stat API ${expected.tableId}: malformed VALUE #${index}`);
      if (cat01 !== expected.cat01 || cat02 !== expected.cat02 || time !== ESTAT_TIME) {
        throw new Error(`e-Stat API ${expected.tableId}: unexpected dimensions in VALUE #${index}`);
      }
      return { area, cat01, cat02, time, value: number, unit };
    },
  );
  const seen = new Set<string>();
  for (const value of values) {
    if (!TOKYO_WARD_CODES.includes(value.area))
      throw new Error(`e-Stat API ${expected.tableId}: unexpected area ${value.area}`);
    if (seen.has(value.area))
      throw new Error(`e-Stat API ${expected.tableId}: duplicate ward ${value.area}`);
    seen.add(value.area);
  }
  const missing = TOKYO_WARD_CODES.filter((code) => !seen.has(code));
  if (missing.length)
    throw new Error(`e-Stat API ${expected.tableId}: missing ward(s) ${missing.join(", ")}`);
  if (values.length !== 23)
    throw new Error(`e-Stat API ${expected.tableId}: expected exactly 23 ward values`);
  return { tableId: expected.tableId, values, raw };
}

export function assertEstatUnits(values: readonly EstatValue[], kind: "rent" | "fee"): void {
  const permitted = kind === "rent" ? /円/ : /^円(?:$|\()/;
  for (const value of values) {
    if (!permitted.test(value.unit))
      throw new Error(`e-Stat API ${kind}: unexpected unit "${value.unit}" for ward ${value.area}`);
  }
}

async function fetchTable(
  appId: string,
  tableId: string,
  cat01: string,
  cat02: string,
  fetchFn: typeof fetch,
): Promise<unknown> {
  const url = new URL(ESTAT_API_BASE);
  url.searchParams.set("appId", appId);
  url.searchParams.set("statsDataId", tableId);
  url.searchParams.set("cdCat01", cat01);
  url.searchParams.set("cdCat02", cat02);
  url.searchParams.set("cdTime", ESTAT_TIME);
  url.searchParams.set("cdArea", TOKYO_WARD_CODES.join(","));
  url.searchParams.set("metaGetFlg", "Y");
  const response = await fetchFn(url);
  if (!response.ok) throw new Error(`e-Stat API ${tableId}: HTTP ${response.status}`);
  return response.json();
}

async function cacheResponse(tableId: string, raw: unknown): Promise<void> {
  const dir = path.join(DATA_DIR, "raw", "estat");
  await mkdir(dir, { recursive: true });
  // The body contains statistical data only. The application ID appears in
  // the request URL and is never interpolated into this file or a log line.
  await writeFile(path.join(dir, `${tableId}-${ESTAT_TIME}.json`), JSON.stringify(raw));
}

export async function fetchLiveEstat(
  appId: string,
  fetchFn: typeof fetch = fetch,
): Promise<{ rent: EstatApiResponse; fee: EstatApiResponse }> {
  if (!appId) throw new Error("ESTAT_APP_ID is required when import:rent runs without --file");
  const [rentRaw, feeRaw] = await Promise.all([
    fetchTable(appId, ESTAT_RENT_TABLE_ID, "3", "2", fetchFn),
    fetchTable(appId, ESTAT_FEE_TABLE_ID, "13", "1", fetchFn),
  ]);
  const rent = parseEstatApiResponse(rentRaw, {
    tableId: ESTAT_RENT_TABLE_ID,
    cat01: "3",
    cat02: "2",
  });
  const fee = parseEstatApiResponse(feeRaw, {
    tableId: ESTAT_FEE_TABLE_ID,
    cat01: "13",
    cat02: "1",
  });
  assertEstatUnits(rent.values, "rent");
  assertEstatUnits(fee.values, "fee");
  await Promise.all([cacheResponse(rent.tableId, rent.raw), cacheResponse(fee.tableId, fee.raw)]);
  return { rent, fee };
}

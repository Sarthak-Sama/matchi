"use client";

import type { FormEvent } from "react";
import { useEffect, useState } from "react";

import type {
  Importance,
  Layout,
  LifestyleAxisId,
  OptimizationRequest,
  OptimizeResponse,
  StationsResponse,
  StationSuggestion,
} from "@tokyo/shared";
import {
  COMMUTE_LABEL,
  IMPORTANCE_VALUES,
  LAYOUT_IDS,
  LAYOUTS,
  LIFESTYLE_AXES,
  LIFESTYLE_AXIS_IDS,
  mapLifestyleAxes,
  OSM_ATTRIBUTION,
  OVERALL_WEIGHTS,
  RENT_LABEL,
} from "@tokyo/shared";

import { ApiClientError, getJson, postJson } from "../lib/api";

const IMPORTANCE_OPTIONS = Object.keys(IMPORTANCE_VALUES) as Importance[];

/**
 * Non-lifestyle query-string keys. Each lifestyle axis uses its own
 * `LifestyleAxisId` as its query key, so there is no second set of names to
 * keep in sync with the registry.
 */
const QUERY_KEYS = {
  dest: "dest",
  destLabel: "destLabel",
  arrival: "arrival",
  maxCommute: "maxCommute",
  budget: "budget",
  layout: "layout",
} as const;

export default function Home() {
  // Step 1: destination + arrival + max commute.
  const [destQuery, setDestQuery] = useState("");
  const [destId, setDestId] = useState<string | null>(null);
  const [destLabel, setDestLabel] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<StationSuggestion[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  // The `destQuery` value that was just SET alongside a real selection
  // (from hydration or from picking a suggestion), so the autocomplete
  // effect below can tell "this text already represents a committed
  // choice, don't search for it" apart from "the user is typing." This is
  // plain state (not a ref) specifically so it updates in the SAME render
  // pass as `destQuery` itself — a ref flipped synchronously inside the
  // hydration effect gets consumed one render too early, during the stale
  // pass where `destQuery` is still `""`, letting a real autocomplete
  // request slip through 300ms after a shared link loads.
  const [committedQuery, setCommittedQuery] = useState<string | null>(null);

  const [arrivalTime, setArrivalTime] = useState("08:30");
  const [maxCommuteMinutes, setMaxCommuteMinutes] = useState(45);

  // Step 2: budget + layout.
  const [monthlyBudgetYen, setMonthlyBudgetYen] = useState(200_000);
  const [layout, setLayout] = useState<Layout>("1LDK");

  // Step 3: lifestyle importance — one entry per registered axis.
  // `undefined` means "axis not rated", which the request contract treats as
  // "leave it out of scoring entirely". Every axis starts unselected: with
  // nine registered axes but MAX_SELECTED_LIFESTYLE_AXES capped at 5,
  // defaulting every axis to a value (as this used to) would submit all
  // nine and the request would 400 against the app's own untouched initial
  // state. The user opts in per axis instead (the plan's own "pick 4-5 from
  // a menu" design); a picker UI is a later task, this just prevents the
  // self-inflicted 400.
  const [preferences, setPreferences] = useState<Record<LifestyleAxisId, Importance | undefined>>(
    () => mapLifestyleAxes(() => undefined),
  );

  // Request lifecycle.
  const [hydrated, setHydrated] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [response, setResponse] = useState<OptimizeResponse | null>(null);

  // Hydrate the form from the query string on load (shareable links).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get(QUERY_KEYS.dest);
    if (id) {
      const label = params.get(QUERY_KEYS.destLabel);
      const query = label ?? id;
      setDestId(id);
      setDestLabel(label);
      setDestQuery(query);
      setCommittedQuery(query);
    }
    const arrival = params.get(QUERY_KEYS.arrival);
    if (arrival) setArrivalTime(arrival);
    const maxCommute = params.get(QUERY_KEYS.maxCommute);
    if (maxCommute) setMaxCommuteMinutes(Number(maxCommute));
    const budget = params.get(QUERY_KEYS.budget);
    if (budget) setMonthlyBudgetYen(Number(budget));
    const layoutParam = params.get(QUERY_KEYS.layout);
    if (layoutParam && (LAYOUT_IDS as readonly string[]).includes(layoutParam)) {
      setLayout(layoutParam as Layout);
    }
    setPreferences((current) =>
      mapLifestyleAxes((id) => {
        const value = params.get(id);
        return value && IMPORTANCE_OPTIONS.includes(value as Importance)
          ? (value as Importance)
          : current[id];
      }),
    );
    setHydrated(true);
  }, []);

  // Auto-run once, right after hydration, if the URL already named a
  // destination — otherwise a "shareable" link would just reopen a blank
  // form.
  useEffect(() => {
    if (hydrated && destId) {
      void runOptimize();
    }
    // Deliberately depends on `hydrated` alone: this must run exactly once,
    // right after the hydration effect above has populated form state from
    // the query string, not on every subsequent field change.
  }, [hydrated]);

  // Debounced station autocomplete. Skipped entirely while `destQuery`
  // still equals `committedQuery` — i.e. the text on screen already came
  // from a real selection (hydration or picking a suggestion) and the user
  // hasn't edited it since. This guarantees zero `/v1/stations` requests
  // when a shared link loads with a destination pre-filled.
  useEffect(() => {
    if (committedQuery !== null && destQuery === committedQuery) {
      return;
    }
    const trimmed = destQuery.trim();
    if (trimmed.length === 0) {
      setSuggestions([]);
      return;
    }
    const handle = setTimeout(() => {
      setSuggestionsLoading(true);
      getJson<StationsResponse>(`/v1/stations?query=${encodeURIComponent(trimmed)}&limit=8`)
        .then((data) => setSuggestions(data.results))
        .catch(() => setSuggestions([]))
        .finally(() => setSuggestionsLoading(false));
    }, 300);
    return () => clearTimeout(handle);
  }, [destQuery, committedQuery]);

  function selectStation(station: StationSuggestion): void {
    setDestId(station.stationGroupId);
    setDestLabel(`${station.nameEn} (${station.nameJa})`);
    setDestQuery(station.nameEn);
    setCommittedQuery(station.nameEn);
    setSuggestions([]);
  }

  async function runOptimize(): Promise<void> {
    if (!destId) {
      setError(new Error("Choose a destination station from the suggestions list first."));
      return;
    }

    const request: OptimizationRequest = {
      destinationStationGroupId: destId,
      arrivalTime,
      monthlyBudgetYen,
      layout,
      maxCommuteMinutes,
      preferences,
    };

    const params = new URLSearchParams({
      [QUERY_KEYS.dest]: destId,
      [QUERY_KEYS.destLabel]: destLabel ?? destQuery,
      [QUERY_KEYS.arrival]: arrivalTime,
      [QUERY_KEYS.maxCommute]: String(maxCommuteMinutes),
      [QUERY_KEYS.budget]: String(monthlyBudgetYen),
      [QUERY_KEYS.layout]: layout,
    });
    for (const id of LIFESTYLE_AXIS_IDS) {
      const importance = preferences[id];
      if (importance !== undefined) params.set(id, importance);
    }
    window.history.replaceState(null, "", `?${params.toString()}`);

    setIsLoading(true);
    setError(null);
    setResponse(null);
    try {
      const data = await postJson<OptimizeResponse>("/v1/optimize", request);
      setResponse(data);
    } catch (err) {
      setError(err instanceof Error ? err : new Error("Unknown error"));
    } finally {
      setIsLoading(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void runOptimize();
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-bold">Tokyo Neighborhood Optimizer</h1>
      <p className="mt-1 text-sm text-neutral-600">
        Ranks candidate neighborhoods by modeled affordability, commute, and lifestyle fit. All rent
        and commute figures below are estimates, not real listings or timetables.
      </p>

      <form onSubmit={handleSubmit} className="mt-6 space-y-8">
        <fieldset className="space-y-3">
          <legend className="text-lg font-semibold">1. Destination &amp; commute</legend>

          <div className="relative">
            <label htmlFor="destination" className="block text-sm font-medium">
              Destination station
            </label>
            <input
              id="destination"
              type="text"
              autoComplete="off"
              value={destQuery}
              onChange={(event) => {
                setDestQuery(event.target.value);
                setDestId(null);
                setDestLabel(null);
                setCommittedQuery(null);
              }}
              placeholder="e.g. Shibuya"
              required
              className="mt-1 w-full rounded border border-neutral-400 px-3 py-2"
            />
            {suggestionsLoading && <p className="mt-1 text-sm text-neutral-500">Searching…</p>}
            {suggestions.length > 0 && (
              <ul className="absolute z-10 mt-1 w-full rounded border border-neutral-300 bg-white shadow">
                {suggestions.map((station) => (
                  <li key={station.stationGroupId}>
                    <button
                      type="button"
                      onClick={() => selectStation(station)}
                      className="block w-full px-3 py-2 text-left hover:bg-neutral-100"
                    >
                      {station.nameEn} ({station.nameJa})
                      {station.lines.length > 0 ? ` — ${station.lines.join(", ")}` : ""}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {destId && <p className="mt-1 text-sm text-green-700">Selected: {destLabel}</p>}
          </div>

          <div>
            <label htmlFor="arrivalTime" className="block text-sm font-medium">
              Arrival time
            </label>
            <input
              id="arrivalTime"
              type="time"
              value={arrivalTime}
              onChange={(event) => setArrivalTime(event.target.value)}
              required
              className="mt-1 rounded border border-neutral-400 px-3 py-2"
            />
          </div>

          <div>
            <label htmlFor="maxCommuteMinutes" className="block text-sm font-medium">
              Max commute (minutes)
            </label>
            <input
              id="maxCommuteMinutes"
              type="number"
              min={5}
              max={180}
              step={5}
              value={maxCommuteMinutes}
              onChange={(event) => setMaxCommuteMinutes(Number(event.target.value))}
              required
              className="mt-1 rounded border border-neutral-400 px-3 py-2"
            />
          </div>
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="text-lg font-semibold">2. Budget &amp; layout</legend>

          <div>
            <label htmlFor="monthlyBudgetYen" className="block text-sm font-medium">
              Monthly all-in budget (¥)
            </label>
            <input
              id="monthlyBudgetYen"
              type="number"
              min={1}
              max={10_000_000}
              step={1000}
              value={monthlyBudgetYen}
              onChange={(event) => setMonthlyBudgetYen(Number(event.target.value))}
              required
              className="mt-1 rounded border border-neutral-400 px-3 py-2"
            />
          </div>

          <div>
            <label htmlFor="layout" className="block text-sm font-medium">
              Layout
            </label>
            <select
              id="layout"
              value={layout}
              onChange={(event) => setLayout(event.target.value as Layout)}
              className="mt-1 rounded border border-neutral-400 px-3 py-2"
            >
              {LAYOUT_IDS.map((id) => {
                const def = LAYOUTS[id];
                return (
                  <option key={id} value={id}>
                    {def.label} (assumed {def.minSqm}–{def.maxSqm} m²)
                  </option>
                );
              })}
            </select>
          </div>
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="text-lg font-semibold">3. Lifestyle priorities</legend>

          {LIFESTYLE_AXIS_IDS.map((id) => (
            <div key={id}>
              <label htmlFor={id} className="block text-sm font-medium">
                {LIFESTYLE_AXES[id].label}
              </label>
              <select
                id={id}
                // "" stands for "not rated" (an omitted axis) — distinct
                // from any real Importance value, so the control never
                // silently claims a rating the request doesn't actually
                // submit.
                value={preferences[id] ?? ""}
                onChange={(event) =>
                  setPreferences((current) => ({
                    ...current,
                    [id]:
                      event.target.value === "" ? undefined : (event.target.value as Importance),
                  }))
                }
                className="mt-1 rounded border border-neutral-400 px-3 py-2"
              >
                <option value="">Not rated</option>
                {IMPORTANCE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </fieldset>

        <button
          type="submit"
          disabled={isLoading}
          className="rounded bg-neutral-900 px-4 py-2 font-medium text-white disabled:opacity-50"
        >
          {isLoading ? "Searching…" : "Find neighborhoods"}
        </button>
      </form>

      {isLoading && (
        <p role="status" className="mt-6">
          Loading…
        </p>
      )}

      {error && (
        <p role="alert" className="mt-6 rounded border border-red-400 bg-red-50 p-3 text-red-800">
          {error instanceof ApiClientError ? `${error.code}: ${error.message}` : error.message}
        </p>
      )}

      {response && response.results.length === 0 && (
        <div className="mt-6 rounded border border-amber-400 bg-amber-50 p-4">
          <p className="font-semibold">No neighborhoods matched your criteria.</p>
          {response.diagnostics.suggestion && (
            <p className="mt-1">{response.diagnostics.suggestion}</p>
          )}
          <p className="mt-2 text-sm text-neutral-600">
            Considered {response.diagnostics.candidatesConsidered} candidates — excluded{" "}
            {response.diagnostics.excludedByRent} by rent, {response.diagnostics.excludedByCommute}{" "}
            by commute, {response.diagnostics.excludedByDisconnected} as disconnected from the
            destination.
          </p>
        </div>
      )}

      {response && response.results.length > 0 && (
        <ol className="mt-8 space-y-6">
          {response.results.map((result) => (
            <li key={result.stationGroupId} className="rounded border border-neutral-300 p-4">
              <h3 className="text-lg font-semibold">
                #{result.rank} {result.nameEn} ({result.nameJa}) — {result.wardNameEn} /{" "}
                {result.wardNameJa}
              </h3>
              <p>Overall score: {result.overallScore.toFixed(1)} / 100</p>
              <p className="text-sm text-neutral-500">{result.catchmentLabel}</p>

              <div className="mt-2">
                <p className="font-medium">
                  Rent — {RENT_LABEL} ({result.rent.confidence} confidence)
                </p>
                <p>
                  ¥{result.rent.lowYen.toLocaleString()} – ¥{result.rent.highYen.toLocaleString()} /
                  month (median ¥{result.rent.medianYen.toLocaleString()}), assuming a{" "}
                  {result.rent.assumedSizeSqmMin}–{result.rent.assumedSizeSqmMax} m²{" "}
                  {result.rent.layout}
                </p>
              </div>

              <div className="mt-2">
                <p className="font-medium">
                  Commute — {COMMUTE_LABEL} ({result.commute.confidence} confidence)
                </p>
                <p>
                  Total {Math.round(result.commute.totalMinutes)} min —{" "}
                  {result.commute.accessWalkMinutes} min access walk,{" "}
                  {Math.round(result.commute.railMinutes)} min rail,{" "}
                  {Math.round(result.commute.waitMinutes)} min wait, {result.commute.transferCount}{" "}
                  transfer(s)
                </p>
              </div>

              <div className="mt-2">
                <p className="font-medium">Lifestyle factors</p>
                <ul className="list-inside list-disc">
                  {result.factors.map((factor) => (
                    <li key={factor.key}>
                      {factor.label}: {factor.rawValueLabel} — {factor.componentScore.toFixed(0)}
                      /100 ({factor.confidence} confidence, as of{" "}
                      {factor.sourceDate ?? "unknown date"})
                    </li>
                  ))}
                </ul>
              </div>

              {(result.reasonsFor.length > 0 || result.reasonsAgainst.length > 0) && (
                <div className="mt-2 grid gap-3 sm:grid-cols-2">
                  {result.reasonsFor.length > 0 && (
                    <div>
                      <p className="font-medium">Reasons for</p>
                      <ul className="list-inside list-disc">
                        {result.reasonsFor.map((reason) => (
                          <li key={reason}>{reason}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {result.reasonsAgainst.length > 0 && (
                    <div>
                      <p className="font-medium">Reasons against</p>
                      <ul className="list-inside list-disc">
                        {result.reasonsAgainst.map((reason) => (
                          <li key={reason}>{reason}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </li>
          ))}
        </ol>
      )}

      {response && (
        <section className="mt-8 text-sm text-neutral-600">
          <h2 className="font-medium">Data vintages</h2>
          <ul className="list-inside list-disc">
            {response.dataVintages.map((vintage) => (
              <li key={vintage.source}>
                {vintage.source}: source updated {vintage.sourceUpdatedAt ?? "unknown"}, imported{" "}
                {vintage.importedAt ?? "unknown"}
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer className="mt-12 border-t border-neutral-300 pt-4 text-sm text-neutral-600">
        <p>
          Overall score weights: affordability {OVERALL_WEIGHTS.affordability * 100}%, commute{" "}
          {OVERALL_WEIGHTS.commute * 100}%, lifestyle {OVERALL_WEIGHTS.lifestyle * 100}%. Lifestyle
          importance multipliers: low {IMPORTANCE_VALUES.low}×, medium {IMPORTANCE_VALUES.medium}×,
          high {IMPORTANCE_VALUES.high}×, essential {IMPORTANCE_VALUES.essential}×.
        </p>
        <p className="mt-1">{OSM_ATTRIBUTION}</p>
      </footer>
    </main>
  );
}

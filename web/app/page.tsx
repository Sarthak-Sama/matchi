"use client";

import type { FormEvent } from "react";
import { useEffect, useState } from "react";

import type {
  Importance,
  Layout,
  LifestyleAxisId,
  OptimizationRequest,
  OptimizeResponse,
  PlaceSuggestion,
  PlacesResponse,
  StationsResponse,
  StationSuggestion,
} from "@tokyo/shared";
import {
  COMMUTE_LABEL,
  IMPORTANCE_OPTIONS,
  IMPORTANCE_VALUES,
  LAYOUT_IDS,
  LAYOUTS,
  LIFESTYLE_AXIS_IDS,
  mapLifestyleAxes,
  MAX_SELECTED_LIFESTYLE_AXES,
  MIN_SELECTED_LIFESTYLE_AXES,
  OSM_ATTRIBUTION,
  OVERALL_WEIGHTS,
  RENT_LABEL,
} from "@tokyo/shared";

import { ApiClientError, getJson, postJson } from "../lib/api";
import { LifestylePicker } from "./components/LifestylePicker";

/**
 * A destination the user has actually committed to, in whichever of the two
 * mutually-exclusive forms `POST /v1/optimize` accepts. Kept as one
 * discriminated union (rather than the old `destId`/`destLabel` pair) so a
 * selection can never end up half station, half point.
 */
type SelectedDestination =
  | { readonly kind: "station"; readonly stationGroupId: string; readonly label: string }
  | { readonly kind: "point"; readonly lat: number; readonly lon: number; readonly label: string };

/**
 * Non-lifestyle query-string keys. Each lifestyle axis uses its own
 * `LifestyleAxisId` as its query key, so there is no second set of names to
 * keep in sync with the registry.
 */
const QUERY_KEYS = {
  dest: "dest",
  destLabel: "destLabel",
  destLat: "destLat",
  destLon: "destLon",
  arrival: "arrival",
  maxCommute: "maxCommute",
  budget: "budget",
  layout: "layout",
} as const;

export default function Home() {
  // Step 1: destination + arrival + max commute.
  const [destQuery, setDestQuery] = useState("");
  const [selectedDestination, setSelectedDestination] = useState<SelectedDestination | null>(null);
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

  // `/v1/places` results — named POIs and stations, ranked together. This
  // is the primary destination search: a user thinks "where am I going"
  // (an office, a campus), not "which station serves it".
  const [placeSuggestions, setPlaceSuggestions] = useState<PlaceSuggestion[]>([]);
  const [placesLoading, setPlacesLoading] = useState(false);
  // Fallback station-only search, populated ONLY when `/v1/places` comes
  // back empty for the current query. Not optional garnish: it is what
  // keeps the form usable when a destination has no named POI and doesn't
  // match a station well enough to rank (e.g. an unusual station spelling).
  const [stationFallback, setStationFallback] = useState<StationSuggestion[]>([]);
  const [stationFallbackLoading, setStationFallbackLoading] = useState(false);

  const [arrivalTime, setArrivalTime] = useState("08:30");
  const [maxCommuteMinutes, setMaxCommuteMinutes] = useState(45);

  // Step 2: budget + layout.
  const [monthlyBudgetYen, setMonthlyBudgetYen] = useState(200_000);
  const [layout, setLayout] = useState<Layout>("1LDK");

  // Step 3: lifestyle importance — one entry per registered axis.
  // `undefined` means "axis not selected", which the request contract
  // treats as "leave it out of scoring entirely". Every axis starts
  // unselected: with nine registered axes but MAX_SELECTED_LIFESTYLE_AXES
  // capped at 5, defaulting every axis to a value would submit all nine and
  // the request would 400 against the app's own untouched initial state.
  const [preferences, setPreferences] = useState<Record<LifestyleAxisId, Importance | undefined>>(
    () => mapLifestyleAxes(() => undefined),
  );

  // Request lifecycle.
  const [hydrated, setHydrated] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [response, setResponse] = useState<OptimizeResponse | null>(null);
  // The destination label as of the request that PRODUCED `response` —
  // captured at submit time rather than read live off `selectedDestination`,
  // so editing the destination field after results have loaded (which
  // clears `selectedDestination`) can't blank out the "walk to X" wording
  // on results that are still on screen.
  const [resultDestinationLabel, setResultDestinationLabel] = useState<string | null>(null);

  // Hydrate the form from the query string on load (shareable links).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const stationId = params.get(QUERY_KEYS.dest);
    const lat = params.get(QUERY_KEYS.destLat);
    const lon = params.get(QUERY_KEYS.destLon);
    const label = params.get(QUERY_KEYS.destLabel);
    const parsedLat = lat === null ? null : Number(lat);
    const parsedLon = lon === null ? null : Number(lon);
    if (
      parsedLat !== null &&
      parsedLon !== null &&
      Number.isFinite(parsedLat) &&
      Number.isFinite(parsedLon)
    ) {
      const resolvedLabel = label ?? "Destination point";
      setSelectedDestination({
        kind: "point",
        lat: parsedLat,
        lon: parsedLon,
        label: resolvedLabel,
      });
      setDestQuery(resolvedLabel);
      setCommittedQuery(resolvedLabel);
    } else if (stationId) {
      const resolvedLabel = label ?? stationId;
      setSelectedDestination({ kind: "station", stationGroupId: stationId, label: resolvedLabel });
      setDestQuery(resolvedLabel);
      setCommittedQuery(resolvedLabel);
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
  //
  // Also requires at least one selected lifestyle axis: an OLDER shared
  // link may carry lifestyle params under axis ids that no longer exist in
  // the registry (e.g. a pre-rename `flood=`/`quiet=`), which hydrates
  // `preferences` to all-`undefined` — nothing in the current query string
  // matches a current `LifestyleAxisId`. Auto-running that straight into
  // `runOptimize` would immediately fail client-side with "Select at least
  // one lifestyle priority before searching", so the user's first sight of
  // the page would be an error banner instead of the (blank-preferences,
  // but otherwise usable) form. Skipping the auto-run here just leaves the
  // destination/commute fields pre-filled and lets the user pick priorities
  // and submit normally.
  useEffect(() => {
    const hasSelectedAxis = LIFESTYLE_AXIS_IDS.some((id) => preferences[id] !== undefined);
    if (hydrated && selectedDestination && hasSelectedAxis) {
      void runOptimize();
    }
    // Deliberately depends on `hydrated` alone (not `preferences` or
    // `selectedDestination`): this must run exactly once, right after the
    // hydration effect above has populated form state from the query
    // string, not on every subsequent field change.
  }, [hydrated]);

  // Debounced destination autocomplete against `/v1/places`. Skipped
  // entirely while `destQuery` still equals `committedQuery` — i.e. the
  // text on screen already came from a real selection (hydration or picking
  // a suggestion) and the user hasn't edited it since.
  useEffect(() => {
    if (committedQuery !== null && destQuery === committedQuery) {
      return;
    }
    const trimmed = destQuery.trim();
    if (trimmed.length === 0) {
      setPlaceSuggestions([]);
      setStationFallback([]);
      return;
    }

    function searchStationFallback(): void {
      setStationFallbackLoading(true);
      getJson<StationsResponse>(`/v1/stations?query=${encodeURIComponent(trimmed)}&limit=8`)
        .then((data) => setStationFallback(data.results))
        .catch(() => setStationFallback([]))
        .finally(() => setStationFallbackLoading(false));
    }

    const handle = setTimeout(() => {
      setPlacesLoading(true);
      getJson<PlacesResponse>(`/v1/places?query=${encodeURIComponent(trimmed)}`)
        .then((data) => {
          setPlaceSuggestions(data.results);
          if (data.results.length === 0) {
            searchStationFallback();
          } else {
            setStationFallback([]);
          }
        })
        .catch(() => {
          setPlaceSuggestions([]);
          searchStationFallback();
        })
        .finally(() => setPlacesLoading(false));
    }, 300);
    return () => clearTimeout(handle);
  }, [destQuery, committedQuery]);

  function commitDestination(destination: SelectedDestination, query: string): void {
    setSelectedDestination(destination);
    setDestQuery(query);
    setCommittedQuery(query);
    setPlaceSuggestions([]);
    setStationFallback([]);
  }

  function selectPlace(place: PlaceSuggestion): void {
    const destination: SelectedDestination =
      place.kind === "station"
        ? {
            kind: "station",
            stationGroupId: place.id,
            label: place.nameJa ? `${place.name} (${place.nameJa})` : place.name,
          }
        : { kind: "point", lat: place.lat, lon: place.lon, label: place.name };
    commitDestination(destination, place.name);
  }

  function selectFallbackStation(station: StationSuggestion): void {
    commitDestination(
      {
        kind: "station",
        stationGroupId: station.stationGroupId,
        label: `${station.nameEn} (${station.nameJa})`,
      },
      station.nameEn,
    );
  }

  async function runOptimize(): Promise<void> {
    if (!selectedDestination) {
      setError(new Error("Choose a destination from the suggestions list first."));
      return;
    }

    const selectedAxisCount = LIFESTYLE_AXIS_IDS.filter(
      (id) => preferences[id] !== undefined,
    ).length;
    if (selectedAxisCount < MIN_SELECTED_LIFESTYLE_AXES) {
      setError(new Error("Select at least one lifestyle priority before searching."));
      return;
    }
    if (selectedAxisCount > MAX_SELECTED_LIFESTYLE_AXES) {
      setError(new Error(`Select at most ${MAX_SELECTED_LIFESTYLE_AXES} lifestyle priorities.`));
      return;
    }

    const request: OptimizationRequest = {
      ...(selectedDestination.kind === "station"
        ? { destinationStationGroupId: selectedDestination.stationGroupId }
        : {
            destinationPoint: {
              lat: selectedDestination.lat,
              lon: selectedDestination.lon,
              label: selectedDestination.label,
            },
          }),
      arrivalTime,
      monthlyBudgetYen,
      layout,
      maxCommuteMinutes,
      preferences,
    };

    const params = new URLSearchParams({
      [QUERY_KEYS.destLabel]: selectedDestination.label,
      [QUERY_KEYS.arrival]: arrivalTime,
      [QUERY_KEYS.maxCommute]: String(maxCommuteMinutes),
      [QUERY_KEYS.budget]: String(monthlyBudgetYen),
      [QUERY_KEYS.layout]: layout,
    });
    if (selectedDestination.kind === "station") {
      params.set(QUERY_KEYS.dest, selectedDestination.stationGroupId);
    } else {
      params.set(QUERY_KEYS.destLat, String(selectedDestination.lat));
      params.set(QUERY_KEYS.destLon, String(selectedDestination.lon));
    }
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
      setResultDestinationLabel(selectedDestination.label);
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

  const trimmedDestQuery = destQuery.trim();
  const showStationFallback =
    !placesLoading &&
    !selectedDestination &&
    trimmedDestQuery.length > 0 &&
    placeSuggestions.length === 0;

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
              Destination
            </label>
            <input
              id="destination"
              type="text"
              autoComplete="off"
              value={destQuery}
              onChange={(event) => {
                setDestQuery(event.target.value);
                setSelectedDestination(null);
                setCommittedQuery(null);
              }}
              placeholder="e.g. Shibuya, or an office/campus name"
              required
              className="mt-1 w-full rounded border border-neutral-400 px-3 py-2"
            />
            {placesLoading && <p className="mt-1 text-sm text-neutral-500">Searching…</p>}
            {/*
              `!selectedDestination` guards against a stale `/v1/places`
              response repainting the dropdown over a committed selection:
              nothing cancels the in-flight fetch fired by the debounce
              effect above (no AbortController, no staleness token), so a
              slow request that resolves AFTER `commitDestination` has
              already cleared `placeSuggestions` can still call
              `setPlaceSuggestions` with its stale results. Gating on
              `selectedDestination` here — the same guard `showStationFallback`
              already uses below — means that stale repaint has nothing to
              render into, regardless of when the fetch resolves.
            */}
            {!selectedDestination && placeSuggestions.length > 0 && (
              <ul className="absolute z-10 mt-1 w-full rounded border border-neutral-300 bg-white shadow">
                {placeSuggestions.map((place) => (
                  <li key={place.id}>
                    <button
                      type="button"
                      onClick={() => selectPlace(place)}
                      className="block w-full px-3 py-2 text-left hover:bg-neutral-100"
                    >
                      <span className="text-xs uppercase text-neutral-500">
                        {place.kind === "station" ? "Station" : (place.category ?? "Place")}
                      </span>
                      {" — "}
                      {place.name}
                      {place.nameJa ? ` (${place.nameJa})` : ""}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {showStationFallback && (
              <div className="mt-1 rounded border border-amber-300 bg-amber-50 p-2 text-sm">
                <p>
                  No destination match for &ldquo;{trimmedDestQuery}&rdquo;. Choose a station
                  directly instead:
                </p>
                {stationFallbackLoading && (
                  <p className="mt-1 text-neutral-500">Searching stations…</p>
                )}
                {!stationFallbackLoading && stationFallback.length === 0 && (
                  <p className="mt-1 text-neutral-500">No stations match either.</p>
                )}
                {stationFallback.length > 0 && (
                  <ul className="mt-1 rounded border border-neutral-300 bg-white">
                    {stationFallback.map((station) => (
                      <li key={station.stationGroupId}>
                        <button
                          type="button"
                          onClick={() => selectFallbackStation(station)}
                          className="block w-full px-3 py-2 text-left hover:bg-neutral-100"
                        >
                          {station.nameEn} ({station.nameJa})
                          {station.lines.length > 0 ? ` — ${station.lines.join(", ")}` : ""}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {selectedDestination && (
              <p className="mt-1 text-sm text-green-700">
                Selected: {selectedDestination.label}{" "}
                {selectedDestination.kind === "point" ? "(place)" : "(station)"}
              </p>
            )}
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
          <LifestylePicker preferences={preferences} onChange={setPreferences} />
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

              {result.isDestinationAccessStation && result.commute.railMinutes === 0 && (
                <p className="mt-1 inline-block rounded bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800">
                  Destination area — this is one of your destination&rsquo;s own access stations, so
                  this &ldquo;commute&rdquo; is really just the walk there.
                </p>
              )}

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

              {(() => {
                // `railMinutes`/`waitMinutes` accumulate from `double
                // precision` DB columns and are not guaranteed to be
                // integers (unlike `accessWalkMinutes`/
                // `destinationWalkMinutes`, which are always whole minutes —
                // see `walkMinutesForMetres`'s `Math.ceil` and the fixed
                // `ACCESS_WALK_MINUTES` constant). Rounding all four
                // displayed terms independently can therefore add up to a
                // different number than the independently-rounded total
                // (e.g. rail=6.5 + wait=3.5 rounds to 7 + 4 = 11, a minute
                // more than a total that itself rounds down).
                //
                // Fix: round the total and three of the four terms
                // normally, then derive the fourth — `wait` — as the
                // residual. `wait` absorbs it (not rail) because rail is
                // the number a rider is most likely to mentally check
                // against a known train timetable; wait is already a soft,
                // modeled buffer, so a display shifted by up to a minute
                // there is the least likely to read as "wrong". The two
                // walk terms are untouched because they are always already
                // exact integers — rounding them is a no-op, and diverting
                // the residual onto one of them would make an
                // already-precise figure look adjusted for no reason.
                const totalRounded = Math.round(result.commute.totalMinutes);
                const accessWalkRounded = Math.round(result.commute.accessWalkMinutes);
                const railRounded = Math.round(
                  result.commute.railMinutes + result.commute.transferPenaltyMinutes,
                );
                const destWalkRounded = Math.round(result.commute.destinationWalkMinutes);
                const waitRounded =
                  totalRounded - accessWalkRounded - railRounded - destWalkRounded;
                return (
                  <div className="mt-2">
                    <p className="font-medium">
                      Commute — {COMMUTE_LABEL} ({result.commute.confidence} confidence)
                    </p>
                    <p>
                      Total {totalRounded} min — {accessWalkRounded} min walk + {railRounded} min
                      rail + transfers + {waitRounded} min wait + {destWalkRounded} min walk to{" "}
                      {resultDestinationLabel ?? "destination"}
                      {result.commute.transferCount > 0
                        ? ` (${result.commute.transferCount} transfer${
                            result.commute.transferCount === 1 ? "" : "s"
                          })`
                        : ""}
                    </p>
                  </div>
                );
              })()}

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

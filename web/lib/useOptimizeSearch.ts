"use client";

import type { FormEvent } from "react";
import { useCallback, useEffect, useState } from "react";

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
  IMPORTANCE_OPTIONS,
  LAYOUT_IDS,
  LIFESTYLE_AXIS_IDS,
  mapLifestyleAxes,
  MAX_SELECTED_LIFESTYLE_AXES,
  MIN_SELECTED_LIFESTYLE_AXES,
} from "@tokyo/shared";

import { getJson, postJson } from "./api";
import { bilingualLabel } from "./format";

/**
 * Owns every piece of search state for the Field Guide frontend:
 * destination autocomplete, form fields, query-string hydration, the
 * optimize request lifecycle, and shareable-URL writing. Extracted from
 * the page so components stay presentational; the behavior (debouncing,
 * hydration, auto-run, fallback station search) is unchanged from the
 * previous frontend except where noted.
 */

/** A destination the user has actually committed to, in whichever of the
 *  two mutually-exclusive forms `POST /v1/optimize` accepts. */
export type SelectedDestination =
  | { readonly kind: "station"; readonly stationGroupId: string; readonly label: string }
  | { readonly kind: "point"; readonly lat: number; readonly lon: number; readonly label: string };

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

export function useOptimizeSearch() {
  // Destination + arrival + max commute.
  const [destQuery, setDestQuery] = useState("");
  const [selectedDestination, setSelectedDestination] = useState<SelectedDestination | null>(null);
  // The `destQuery` value that was just SET alongside a real selection
  // (from hydration or from picking a suggestion), so the autocomplete
  // effect below can tell "this text already represents a committed
  // choice, don't search for it" apart from "the user is typing." This is
  // plain state (not a ref) specifically so it updates in the SAME render
  // pass as `destQuery` itself.
  const [committedQuery, setCommittedQuery] = useState<string | null>(null);

  // `/v1/places` results — named POIs and stations, ranked together.
  const [placeSuggestions, setPlaceSuggestions] = useState<PlaceSuggestion[]>([]);
  const [placesLoading, setPlacesLoading] = useState(false);
  // Fallback station-only search, populated ONLY when `/v1/places` comes
  // back empty for the current query.
  const [stationFallback, setStationFallback] = useState<StationSuggestion[]>([]);
  const [stationFallbackLoading, setStationFallbackLoading] = useState(false);
  // True when BOTH the places search and the station fallback failed — the
  // autocomplete then shows a retry action instead of silently giving up.
  const [autocompleteFailed, setAutocompleteFailed] = useState(false);
  // Bumped by the retry action to re-run the debounced search effect.
  const [retryToken, setRetryToken] = useState(0);

  const [arrivalTime, setArrivalTime] = useState("08:30");
  const [maxCommuteMinutes, setMaxCommuteMinutes] = useState(45);

  // Budget + layout.
  const [monthlyBudgetYen, setMonthlyBudgetYen] = useState(200_000);
  const [layout, setLayout] = useState<Layout>("1LDK");

  // Lifestyle importance — one entry per registered axis; `undefined`
  // means "axis not selected" (left out of scoring entirely).
  const [preferences, setPreferences] = useState<Record<LifestyleAxisId, Importance | undefined>>(
    () => mapLifestyleAxes(() => undefined),
  );

  // Request lifecycle.
  const [hydrated, setHydrated] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [response, setResponse] = useState<OptimizeResponse | null>(null);
  // The destination label as of the request that PRODUCED `response` —
  // captured at submit time so editing the destination field afterwards
  // can't blank out the "walk to X" wording on on-screen results.
  const [resultDestinationLabel, setResultDestinationLabel] = useState<string | null>(null);

  // The destination's coordinates, for the results map's marker. Known
  // immediately for point destinations and autocomplete selections (both
  // suggestion types carry lat/lon); for a station hydrated from a shared
  // link, looked up once against `/v1/stations` (see effect below). Null
  // means the map simply renders without the destination nail.
  const [destinationCoords, setDestinationCoords] = useState<{
    readonly lat: number;
    readonly lon: number;
  } | null>(null);

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
      setDestinationCoords({ lat: parsedLat, lon: parsedLon });
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
  // form. Also requires at least one selected lifestyle axis: an older
  // shared link may carry lifestyle params under axis ids that no longer
  // exist, which hydrates to all-`undefined` and would fail client-side
  // validation as the user's first sight of the page.
  useEffect(() => {
    const hasSelectedAxis = LIFESTYLE_AXIS_IDS.some((id) => preferences[id] !== undefined);
    if (hydrated && selectedDestination && hasSelectedAxis) {
      void runOptimize();
    }
    // Deliberately depends on `hydrated` alone: this must run exactly
    // once, right after hydration has populated form state, not on every
    // subsequent field change.
  }, [hydrated]);

  // Debounced destination autocomplete against `/v1/places`. Skipped
  // entirely while `destQuery` still equals `committedQuery` — i.e. the
  // text on screen already came from a real selection and the user hasn't
  // edited it since.
  useEffect(() => {
    if (committedQuery !== null && destQuery === committedQuery) {
      return;
    }
    const trimmed = destQuery.trim();
    if (trimmed.length === 0) {
      setPlaceSuggestions([]);
      setStationFallback([]);
      setAutocompleteFailed(false);
      return;
    }

    function searchStationFallback(): void {
      setStationFallbackLoading(true);
      getJson<StationsResponse>(`/v1/stations?query=${encodeURIComponent(trimmed)}&limit=8`)
        .then((data) => setStationFallback(data.results))
        .catch(() => {
          setStationFallback([]);
          setAutocompleteFailed(true);
        })
        .finally(() => setStationFallbackLoading(false));
    }

    const handle = setTimeout(() => {
      setPlacesLoading(true);
      setAutocompleteFailed(false);
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
  }, [destQuery, committedQuery, retryToken]);

  // Resolve coordinates for a station destination hydrated from a shared
  // link: one lookup by label, matched back to the exact station group id.
  // Failure is silent — the map just renders without the destination nail.
  useEffect(() => {
    if (
      !hydrated ||
      !selectedDestination ||
      selectedDestination.kind !== "station" ||
      destinationCoords !== null
    ) {
      return;
    }
    const stationGroupId = selectedDestination.stationGroupId;
    getJson<StationsResponse>(
      `/v1/stations?query=${encodeURIComponent(selectedDestination.label)}&limit=10`,
    )
      .then((data) => {
        const match = data.results.find((result) => result.stationGroupId === stationGroupId);
        if (match) setDestinationCoords({ lat: match.lat, lon: match.lon });
      })
      .catch(() => {});
    // Runs once per hydrated station destination, not on every edit.
  }, [hydrated]);

  const retryAutocomplete = useCallback(() => {
    setAutocompleteFailed(false);
    setRetryToken((token) => token + 1);
  }, []);

  function editDestinationQuery(value: string): void {
    setDestQuery(value);
    setSelectedDestination(null);
    setCommittedQuery(null);
    setDestinationCoords(null);
  }

  function clearDestination(): void {
    setDestQuery("");
    setSelectedDestination(null);
    setCommittedQuery(null);
    setPlaceSuggestions([]);
    setStationFallback([]);
    setAutocompleteFailed(false);
    setDestinationCoords(null);
  }

  function commitDestination(destination: SelectedDestination, query: string): void {
    setSelectedDestination(destination);
    setDestQuery(query);
    setCommittedQuery(query);
    setPlaceSuggestions([]);
    setStationFallback([]);
    setAutocompleteFailed(false);
  }

  function selectPlace(place: PlaceSuggestion): void {
    const destination: SelectedDestination =
      place.kind === "station"
        ? {
            kind: "station",
            stationGroupId: place.id,
            label: bilingualLabel(place.name, place.nameJa),
          }
        : { kind: "point", lat: place.lat, lon: place.lon, label: place.name };
    commitDestination(destination, place.name);
    setDestinationCoords({ lat: place.lat, lon: place.lon });
  }

  function selectFallbackStation(station: StationSuggestion): void {
    commitDestination(
      {
        kind: "station",
        stationGroupId: station.stationGroupId,
        label: bilingualLabel(station.nameEn, station.nameJa),
      },
      station.nameEn,
    );
    setDestinationCoords({ lat: station.lat, lon: station.lon });
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

  return {
    // Destination field
    destQuery,
    selectedDestination,
    placeSuggestions,
    placesLoading,
    stationFallback,
    stationFallbackLoading,
    showStationFallback,
    autocompleteFailed,
    trimmedDestQuery,
    editDestinationQuery,
    clearDestination,
    selectPlace,
    selectFallbackStation,
    retryAutocomplete,
    // Commute fields
    arrivalTime,
    setArrivalTime,
    maxCommuteMinutes,
    setMaxCommuteMinutes,
    // Budget fields
    monthlyBudgetYen,
    setMonthlyBudgetYen,
    layout,
    setLayout,
    // Lifestyle
    preferences,
    setPreferences,
    // Request lifecycle
    hydrated,
    isLoading,
    error,
    response,
    resultDestinationLabel,
    destinationCoords,
    handleSubmit,
  };
}

export type OptimizeSearch = ReturnType<typeof useOptimizeSearch>;

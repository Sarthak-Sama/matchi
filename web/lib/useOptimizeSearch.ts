"use client";

import type { FormEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

import type {
  Importance,
  Layout,
  LifestyleAxisId,
  OptimizeResponse,
  PlaceSuggestion,
  PlacesResponse,
  StationsResponse,
  StationSuggestion,
} from "@tokyo/shared";
import { LIFESTYLE_AXIS_IDS, mapLifestyleAxes } from "@tokyo/shared";

import { getJson, postJson } from "./api";
import { bilingualLabel } from "./format";
import { buildOptimizationRequest, validateSearchInputs } from "./optimizeRequest";
import { createRequestGeneration } from "./requestGeneration";
import { buildSearchQueryString, parseSearchParams } from "./searchParams";

export type SelectedDestination =
  | { readonly kind: "station"; readonly stationGroupId: string; readonly label: string }
  | { readonly kind: "point"; readonly lat: number; readonly lon: number; readonly label: string };

export function useOptimizeSearch() {
  const autocompleteRequestGeneration = useRef(createRequestGeneration());
  const optimizationRequestGeneration = useRef(createRequestGeneration());

  const [destQuery, setDestQuery] = useState("");
  const [selectedDestination, setSelectedDestination] = useState<SelectedDestination | null>(null);

  const [committedQuery, setCommittedQuery] = useState<string | null>(null);

  const [placeSuggestions, setPlaceSuggestions] = useState<PlaceSuggestion[]>([]);
  const [placesLoading, setPlacesLoading] = useState(false);

  const [stationFallback, setStationFallback] = useState<StationSuggestion[]>([]);
  const [stationFallbackLoading, setStationFallbackLoading] = useState(false);

  const [autocompleteFailed, setAutocompleteFailed] = useState(false);

  const [retryToken, setRetryToken] = useState(0);

  const [arrivalTime, setArrivalTime] = useState("08:30");
  const [maxCommuteMinutes, setMaxCommuteMinutes] = useState(45);

  const [monthlyBudgetYen, setMonthlyBudgetYen] = useState(200_000);
  const [layout, setLayout] = useState<Layout>("1LDK");

  const [preferences, setPreferences] = useState<Record<LifestyleAxisId, Importance | undefined>>(
    () => mapLifestyleAxes(() => undefined),
  );

  const [hydrated, setHydrated] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [response, setResponse] = useState<OptimizeResponse | null>(null);

  const [resultDestinationLabel, setResultDestinationLabel] = useState<string | null>(null);

  const [destinationCoords, setDestinationCoords] = useState<{
    readonly lat: number;
    readonly lon: number;
  } | null>(null);

  useEffect(() => {
    const parsed = parseSearchParams(window.location.search);
    if (parsed.destination) {
      setSelectedDestination(parsed.destination);
      setDestQuery(parsed.destination.label);
      setCommittedQuery(parsed.destination.label);
      if (parsed.destination.kind === "point") {
        setDestinationCoords({ lat: parsed.destination.lat, lon: parsed.destination.lon });
      }
    }
    if (parsed.arrivalTime !== null) setArrivalTime(parsed.arrivalTime);
    if (parsed.maxCommuteMinutes !== null) setMaxCommuteMinutes(parsed.maxCommuteMinutes);
    if (parsed.monthlyBudgetYen !== null) setMonthlyBudgetYen(parsed.monthlyBudgetYen);
    if (parsed.layout !== null) setLayout(parsed.layout);
    setPreferences((current) =>
      mapLifestyleAxes((id) => parsed.preferenceOverrides[id] ?? current[id]),
    );
    setHydrated(true);
  }, []);

  useEffect(() => {
    const hasSelectedAxis = LIFESTYLE_AXIS_IDS.some((id) => preferences[id] !== undefined);
    if (hydrated && selectedDestination && hasSelectedAxis) {
      void runOptimize();
    }
  }, [hydrated]);

  useEffect(() => {
    const generation = autocompleteRequestGeneration.current.begin();
    const isCurrent = () => autocompleteRequestGeneration.current.isCurrent(generation);

    if (committedQuery !== null && destQuery === committedQuery) {
      setPlacesLoading(false);
      setStationFallbackLoading(false);
      return;
    }
    const trimmed = destQuery.trim();
    setPlacesLoading(false);
    setStationFallbackLoading(false);
    if (trimmed.length === 0) {
      setPlaceSuggestions([]);
      setStationFallback([]);
      setAutocompleteFailed(false);
      return;
    }

    function searchStationFallback(): void {
      if (!isCurrent()) return;
      setStationFallbackLoading(true);
      getJson<StationsResponse>(`/v1/stations?query=${encodeURIComponent(trimmed)}&limit=8`)
        .then((data) => {
          if (isCurrent()) setStationFallback(data.results);
        })
        .catch(() => {
          if (!isCurrent()) return;
          setStationFallback([]);
          setAutocompleteFailed(true);
        })
        .finally(() => {
          if (isCurrent()) setStationFallbackLoading(false);
        });
    }

    const handle = setTimeout(() => {
      if (!isCurrent()) return;
      setPlacesLoading(true);
      setAutocompleteFailed(false);
      getJson<PlacesResponse>(`/v1/places?query=${encodeURIComponent(trimmed)}`)
        .then((data) => {
          if (!isCurrent()) return;
          setPlaceSuggestions(data.results);
          if (data.results.length === 0) {
            searchStationFallback();
          } else {
            setStationFallback([]);
          }
        })
        .catch(() => {
          if (!isCurrent()) return;
          setPlaceSuggestions([]);
          searchStationFallback();
        })
        .finally(() => {
          if (isCurrent()) setPlacesLoading(false);
        });
    }, 300);
    return () => {
      clearTimeout(handle);
      if (isCurrent()) autocompleteRequestGeneration.current.begin();
    };
  }, [destQuery, committedQuery, retryToken]);

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
  }, [hydrated]);

  const retryAutocomplete = useCallback(() => {
    setAutocompleteFailed(false);
    setRetryToken((token) => token + 1);
  }, []);

  function editDestinationQuery(value: string): void {
    if (value.trim().length > 0) {
      setPlaceSuggestions([]);
      setStationFallback([]);
    }
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
    const generation = optimizationRequestGeneration.current.begin();
    const isCurrent = () => optimizationRequestGeneration.current.isCurrent(generation);

    const validation = validateSearchInputs(selectedDestination, preferences);
    if (!validation.ok) {
      setIsLoading(false);
      setError(new Error(validation.message));
      return;
    }
    const destination = validation.destination;

    const request = buildOptimizationRequest({
      selectedDestination: destination,
      arrivalTime,
      monthlyBudgetYen,
      layout,
      maxCommuteMinutes,
      preferences,
    });

    const queryString = buildSearchQueryString({
      selectedDestination: destination,
      arrivalTime,
      maxCommuteMinutes,
      monthlyBudgetYen,
      layout,
      preferences,
    });
    window.history.replaceState(null, "", `?${queryString}`);

    setIsLoading(true);
    setError(null);
    setResponse(null);
    try {
      const data = await postJson<OptimizeResponse>("/v1/optimize", request);
      if (!isCurrent()) return;
      setResponse(data);
      setResultDestinationLabel(destination.label);
    } catch (err) {
      if (!isCurrent()) return;
      setError(err instanceof Error ? err : new Error("Unknown error"));
    } finally {
      if (isCurrent()) setIsLoading(false);
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

    arrivalTime,
    setArrivalTime,
    maxCommuteMinutes,
    setMaxCommuteMinutes,

    monthlyBudgetYen,
    setMonthlyBudgetYen,
    layout,
    setLayout,

    preferences,
    setPreferences,

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

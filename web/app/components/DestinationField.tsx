"use client";

import { useId, useRef, useState } from "react";

import type { PlaceSuggestion, StationSuggestion } from "@tokyo/shared";

import { CloseIcon, DestinationMark } from "./icons";

interface DestinationFieldProps {
  readonly query: string;
  readonly selectedLabel: string | null;
  readonly selectedKind: "station" | "point" | null;
  readonly placeSuggestions: readonly PlaceSuggestion[];
  readonly placesLoading: boolean;
  readonly stationFallback: readonly StationSuggestion[];
  readonly stationFallbackLoading: boolean;
  readonly showStationFallback: boolean;
  readonly autocompleteFailed: boolean;
  readonly onEditQuery: (value: string) => void;
  readonly onClear: () => void;
  readonly onSelectPlace: (place: PlaceSuggestion) => void;
  readonly onSelectStation: (station: StationSuggestion) => void;
  readonly onRetry: () => void;
}

type Option =
  | { readonly kind: "place"; readonly place: PlaceSuggestion }
  | { readonly kind: "station"; readonly station: StationSuggestion };

export function DestinationField(props: DestinationFieldProps) {
  const listboxId = useId();
  const inputId = useId();
  const statusId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const hasSelection = props.selectedLabel !== null;
  const options: Option[] = props.showStationFallback
    ? props.stationFallback.map((station) => ({ kind: "station", station }))
    : props.placeSuggestions.map((place) => ({ kind: "place", place }));

  const showDropdown =
    isOpen &&
    !hasSelection &&
    props.query.trim().length > 0 &&
    (options.length > 0 ||
      props.placesLoading ||
      props.stationFallbackLoading ||
      props.autocompleteFailed ||
      props.showStationFallback);

  function optionId(index: number): string {
    return `${listboxId}-option-${index}`;
  }

  function close(): void {
    setIsOpen(false);
    setActiveIndex(-1);
  }

  function choose(option: Option): void {
    if (option.kind === "place") props.onSelectPlace(option.place);
    else props.onSelectStation(option.station);
    close();
    inputRef.current?.focus();
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
        setActiveIndex(event.key === "ArrowDown" ? 0 : options.length - 1);
        return;
      }
      if (options.length === 0) return;
      const delta = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((current) => {
        let next: number;
        if (current < 0) {
          next = delta === 1 ? 0 : options.length - 1;
        } else {
          next = (current + delta + options.length) % options.length;
        }
        document.getElementById(optionId(next))?.scrollIntoView({ block: "nearest" });
        return next;
      });
    } else if (event.key === "Enter") {
      if (isOpen && activeIndex >= 0 && options[activeIndex]) {
        event.preventDefault();
        choose(options[activeIndex]);
      }
    } else if (event.key === "Escape") {
      if (isOpen) {
        event.preventDefault();
        close();
      }
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <label htmlFor={inputId} className="label-utility text-ink">
        Where do you need to be?
      </label>

      {hasSelection ? (
        <div className="mt-2 flex min-h-12 items-center gap-3 border border-moss bg-paper-soft px-4 py-2.5">
          <span className="text-vermilion">
            <DestinationMark />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15px] font-medium">{props.selectedLabel}</span>
            <span className="label-utility mt-0.5 block text-[10px] text-ink-muted">
              {props.selectedKind === "point" ? "Place" : "Station"} — selected
            </span>
          </span>
          <button
            type="button"
            onClick={() => {
              props.onClear();

              requestAnimationFrame(() => inputRef.current?.focus());
            }}
            className="label-utility flex min-h-11 shrink-0 items-center gap-1.5 px-2 text-ink-muted transition-colors hover:text-ink"
          >
            <CloseIcon className="size-3.5" /> Change
          </button>
        </div>
      ) : (
        <div className="relative mt-2">
          <input
            ref={inputRef}
            id={inputId}
            type="text"
            role="combobox"
            aria-expanded={showDropdown}
            aria-controls={listboxId}
            aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
            aria-autocomplete="list"
            aria-describedby={statusId}
            autoComplete="off"
            value={props.query}
            onChange={(event) => {
              props.onEditQuery(event.target.value);
              setIsOpen(true);
              setActiveIndex(-1);
            }}
            onFocus={() => setIsOpen(true)}
            onBlur={(event) => {
              if (!rootRef.current?.contains(event.relatedTarget as Node | null)) close();
            }}
            onKeyDown={handleKeyDown}
            placeholder="Shibuya, 渋谷, or an office or campus name"
            className="min-h-12 w-full border border-line-strong bg-paper-soft px-4 py-3 text-[15px] placeholder:text-stone focus:border-ink focus:outline-none"
          />
          {props.placesLoading && (
            <span className="pointer-events-none absolute top-1/2 right-4 -translate-y-1/2 text-[11px] text-ink-muted">
              Searching…
            </span>
          )}
        </div>
      )}

      {/* Live status for screen readers — suggestion counts and failures. */}
      <span id={statusId} role="status" aria-live="polite" className="sr-only">
        {props.placesLoading
          ? "Searching destinations…"
          : showDropdown && options.length > 0
            ? `${options.length} suggestions available. Use arrow keys to move, Enter to choose.`
            : ""}
      </span>

      {showDropdown && (
        <div className="absolute inset-x-0 top-full z-30 mt-1 border border-line-strong bg-paper-soft shadow-[0_16px_40px_rgba(40,36,31,0.12)]">
          {options.length > 0 && (
            <ul
              role="listbox"
              id={listboxId}
              aria-label="Destination suggestions"
              className="max-h-72 overflow-y-auto"
            >
              {props.showStationFallback && (
                <li
                  aria-hidden="true"
                  className="border-b border-line bg-warning/60 px-4 py-2 text-[11px] text-ink-muted"
                >
                  No place match for &ldquo;{props.query.trim()}&rdquo; — choose a station directly:
                </li>
              )}
              {options.map((option, index) => {
                const isActive = index === activeIndex;
                const key =
                  option.kind === "place" ? option.place.id : option.station.stationGroupId;
                const primary = option.kind === "place" ? option.place.name : option.station.nameEn;
                const nameJa =
                  option.kind === "place" ? option.place.nameJa : option.station.nameJa;

                const secondary = nameJa && nameJa !== primary ? nameJa : null;
                return (
                  <li key={key} role="presentation">
                    <button
                      type="button"
                      id={optionId(index)}
                      role="option"
                      aria-selected={isActive}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => choose(option)}
                      className={`flex min-h-11 w-full items-baseline gap-3 px-4 py-2.5 text-left ${
                        isActive ? "bg-sage" : ""
                      }`}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-medium">
                          {primary}
                          {secondary && (
                            <span lang="ja" className="ml-2 font-normal text-ink-muted">
                              {secondary}
                            </span>
                          )}
                        </span>
                        {option.kind === "station" && option.station.lines.length > 0 && (
                          <span className="mt-0.5 block truncate text-[11px] text-ink-muted">
                            {option.station.lines.join(" · ")}
                          </span>
                        )}
                      </span>
                      <span className="label-utility shrink-0 text-[9px] text-ink-muted">
                        {option.kind === "place"
                          ? option.place.kind === "station"
                            ? "Station"
                            : (option.place.category ?? "Place")
                          : "Station"}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {props.stationFallbackLoading && options.length === 0 && (
            <p className="px-4 py-3 text-[13px] text-ink-muted">Searching stations…</p>
          )}

          {props.showStationFallback &&
            !props.stationFallbackLoading &&
            options.length === 0 &&
            !props.autocompleteFailed && (
              <p className="px-4 py-3 text-[13px] text-ink-muted">
                No destination or station matches &ldquo;{props.query.trim()}&rdquo;. Check the
                spelling, or try a nearby landmark.
              </p>
            )}

          {props.autocompleteFailed && (
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <p className="text-[13px] text-brick">
                Suggestions could not be loaded. Your text is kept.
              </p>
              <button
                type="button"
                onClick={props.onRetry}
                className="label-utility min-h-11 shrink-0 border border-line-strong px-3 text-ink transition-colors hover:border-ink"
              >
                Try again
              </button>
            </div>
          )}
        </div>
      )}

      {/* Committed-selection confirmation for assistive tech. */}
      {hasSelection && (
        <span role="status" className="sr-only">
          Destination selected: {props.selectedLabel}
        </span>
      )}
    </div>
  );
}

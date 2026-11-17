"use client";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { LAYOUT_IDS, LAYOUTS, type PlaceSuggestion, type PlacesResponse } from "@tokyo/shared";
import { getJson } from "../../../lib/api";
import {
  EMPTY_FORM,
  buildProfile,
  formFromProfile,
  type ProfileForm as Form,
} from "../lib/profile";
import type { ProfileResult } from "../lib/types";
import type { AgentController } from "../lib/useAgent";
import { friendlyText } from "../lib/derive";
import { btnPrimary, linkBtn } from "./ui";
const field = "field-control mt-2 min-h-11 w-full px-3 text-base";
export function ProfileForm({
  agent,
  onSaved,
}: {
  agent: AgentController;
  onSaved: (result: ProfileResult) => void;
}) {
  const [form, setForm] = useState<Form>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PlaceSuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const generation = useRef(0);
  const dirty = useRef(false);
  const listId = useId();
  const serverProfile = agent.view?.profile;
  const [pending, setPending] = useState<{ previous: ProfileResult | null } | null>(null);
  function update(patch: Partial<Form>) {
    dirty.current = true;
    setForm((f) => ({ ...f, ...patch }));
  }
  // Hydrate from the server while clean. Closing the sheet keeps both edits and search state mounted.
  useEffect(() => {
    if (serverProfile && !dirty.current) {
      setForm(formFromProfile(serverProfile));
      setQuery("");
    }
  }, [serverProfile]);
  useEffect(() => {
    if (!pending || agent.busy) return;
    const result = agent.profileResult;
    if (result && result !== pending.previous) {
      if (!result.refusedAnchors.length && !result.missing.length) {
        dirty.current = false;
        onSaved(result);
      }
    }
    setPending(null);
  }, [pending, agent.busy, agent.profileResult, onSaved]);
  useEffect(() => {
    const trimmed = query.trim();
    const gen = ++generation.current;
    setActive(-1);
    if (!trimmed) {
      setResults([]);
      setSearchFailed(false);
      setSearching(false);
      return;
    }
    const timer = setTimeout(() => {
      setSearching(true);
      setSearchFailed(false);
      getJson<PlacesResponse>(`/v1/places?query=${encodeURIComponent(trimmed)}`)
        .then((data) => {
          if (gen === generation.current) setResults(data.results);
        })
        .catch(() => {
          if (gen === generation.current) {
            setResults([]);
            setSearchFailed(true);
          }
        })
        .finally(() => {
          if (gen === generation.current) setSearching(false);
        });
    }, 300);
    return () => {
      clearTimeout(timer);
      generation.current++;
    };
  }, [query]);
  function choose(place: PlaceSuggestion) {
    const label =
      place.nameJa && place.nameJa !== place.name ? `${place.name} (${place.nameJa})` : place.name;
    update({
      anchor:
        place.kind === "station"
          ? { label, stationId: place.id }
          : { label, point: { lat: place.lat, lon: place.lon } },
    });
    setQuery("");
    setResults([]);
    setOpen(false);
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    const built = buildProfile(form, agent.view?.profile);
    if (!built.ok) {
      setError(built.error);
      return;
    }
    setError(null);
    setPending({ previous: agent.profileResult });
    void agent.saveProfile(built.profile);
  }
  const pr = agent.profileResult;
  return (
    <section aria-label="Your details form">
      <form onSubmit={submit} className="space-y-6">
        <fieldset className="space-y-4">
          <legend className="font-serif text-xl">Where</legend>
          <div>
            <label htmlFor={`${listId}-destination`} className="text-sm">
              Where do you need to be?
            </label>
            {form.anchor ? (
              <div className="mt-2 flex items-center justify-between gap-3 border border-moss bg-paper-soft px-3 text-sm">
                <span className="min-w-0 break-words">{form.anchor.label}</span>
                <button
                  type="button"
                  className={`${linkBtn} min-h-11 shrink-0`}
                  onClick={() => update({ anchor: null })}
                >
                  Change
                </button>
              </div>
            ) : (
              <div className="relative">
                <input
                  id={`${listId}-destination`}
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setOpen(true);
                  }}
                  onFocus={() => setOpen(true)}
                  onBlur={() => setOpen(false)}
                  placeholder="A station or place"
                  autoComplete="off"
                  role="combobox"
                  aria-autocomplete="list"
                  aria-expanded={open && results.length > 0}
                  aria-controls={listId}
                  aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
                  className={field}
                  onKeyDown={(e) => {
                    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                      e.preventDefault();
                      setOpen(true);
                      setActive((i) =>
                        results.length
                          ? e.key === "ArrowDown"
                            ? (i + 1) % results.length
                            : i <= 0
                              ? results.length - 1
                              : i - 1
                          : -1,
                      );
                    } else if (e.key === "Enter" && open) {
                      e.preventDefault();
                      if (results[active]) choose(results[active]);
                    } else if (e.key === "Escape" && open) {
                      e.preventDefault();
                      e.stopPropagation();
                      setOpen(false);
                    }
                  }}
                />
                {open && (results.length > 0 || searching || searchFailed) && (
                  <div className="absolute z-10 mt-1 max-h-60 w-full overflow-auto border border-line-strong bg-paper-soft">
                    {searching && (
                      <p role="status" className="px-3 py-2 text-xs text-ink-muted">
                        Searching…
                      </p>
                    )}
                    {searchFailed && (
                      <p role="alert" className="px-3 py-2 text-xs text-brick">
                        Place search couldn’t connect. Try again.
                      </p>
                    )}
                    <ul id={listId} role="listbox" aria-label="Places">
                      {results.map((place, i) => (
                        <li
                          key={`${place.kind}-${place.id}`}
                          id={`${listId}-${i}`}
                          role="option"
                          aria-selected={active === i}
                          className={active === i ? "bg-sage" : ""}
                        >
                          <button
                            type="button"
                            tabIndex={-1}
                            onPointerDown={(e) => e.preventDefault()}
                            onClick={() => choose(place)}
                            className="block min-h-11 w-full px-3 py-2 text-left text-sm hover:bg-sage"
                          >
                            {place.name}
                            {place.nameJa && place.nameJa !== place.name
                              ? ` (${place.nameJa})`
                              : ""}
                            <span className="ml-2 text-xs text-ink-muted">
                              {place.kind === "station" ? "station" : (place.category ?? "place")}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
          <label className="block text-sm">
            Trips per week
            <input
              type="number"
              min={0.5}
              step={0.5}
              value={form.tripsPerWeek}
              onChange={(e) => update({ tripsPerWeek: e.target.value })}
              className={field}
            />
          </label>
          <label className="flex min-h-11 items-center gap-3 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-moss"
              checked={form.lateReturn}
              onChange={(e) => update({ lateReturn: e.target.checked })}
            />
            Often home late
          </label>
        </fieldset>
        <fieldset>
          <legend className="font-serif text-xl">Money</legend>
          <label className="mt-3 block text-sm">
            Monthly budget (yen)
            <input
              type="number"
              min={1}
              step="any"
              inputMode="numeric"
              value={form.budget}
              onChange={(e) => update({ budget: e.target.value })}
              className={field}
            />
          </label>
          <label
            className="flex min-h-11 items-center gap-3 text-sm"
            title="Areas over this are left out entirely."
          >
            <input
              type="checkbox"
              className="size-4 accent-moss"
              checked={form.budgetFirm}
              onChange={(e) => update({ budgetFirm: e.target.checked })}
            />
            This is a hard limit
          </label>
        </fieldset>
        <fieldset>
          <legend className="font-serif text-xl">Time</legend>
          <label className="mt-3 block text-sm">
            Commute cap (minutes, one way)
            <input
              type="number"
              min={1}
              step="any"
              inputMode="numeric"
              value={form.commuteCap}
              onChange={(e) => update({ commuteCap: e.target.value })}
              className={field}
            />
          </label>
          <label
            className="flex min-h-11 items-center gap-3 text-sm"
            title="Areas over this are left out entirely."
          >
            <input
              type="checkbox"
              className="size-4 accent-moss"
              checked={form.commuteCapFirm}
              onChange={(e) => update({ commuteCapFirm: e.target.checked })}
            />
            This is a hard limit
          </label>
        </fieldset>
        <fieldset>
          <legend className="font-serif text-xl">Your layout</legend>
          <div className="mt-3 flex flex-wrap gap-2">
            {["", ...LAYOUT_IDS].map((id) => (
              <button
                key={id}
                type="button"
                aria-pressed={form.layout === id}
                className={`min-h-11 border px-3 text-sm ${form.layout === id ? "border-moss bg-sage" : "border-line-strong bg-paper-soft hover:border-ink"}`}
                onClick={() => update({ layout: id })}
              >
                {id ? LAYOUTS[id as (typeof LAYOUT_IDS)[number]].label : "Not set"}
              </button>
            ))}
          </div>
        </fieldset>
        {error && (
          <p role="alert" className="text-sm text-brick">
            {error}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-4">
          <button
            type="submit"
            disabled={agent.busy || agent.streaming || !agent.sessionId}
            className={btnPrimary}
          >
            Update my shortlist
          </button>
          <button
            type="button"
            className={`${linkBtn} min-h-11`}
            onClick={() => {
              dirty.current = true;
              setForm(EMPTY_FORM);
              setQuery("");
              setError(null);
            }}
          >
            Clear
          </button>
        </div>
      </form>
      <div data-testid="profile-result" aria-live="polite" className="mt-4 space-y-2 text-sm">
        {pr && (
          <>
            <p>{pr.feasibleCount} areas fit your limits.</p>
            {pr.refusedAnchors.map((r) => (
              <p key={r.anchorId} className="text-brick">
                Place not accepted: {friendlyText(r.message)}
              </p>
            ))}
            {!!pr.missing.length && (
              <p className="text-ink-muted">
                Still needed:{" "}
                {pr.missing
                  .map((m) =>
                    m === "anchor"
                      ? "where you need to be"
                      : m === "trips_per_week"
                        ? "trips per week"
                        : m,
                  )
                  .join(", ")}
                .
              </p>
            )}
          </>
        )}
      </div>
    </section>
  );
}

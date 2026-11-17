"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";

import type { PlaceSuggestion, PlacesResponse } from "@tokyo/shared";
import { LAYOUT_IDS, LAYOUTS } from "@tokyo/shared";

import { getJson } from "../../../lib/api";
import { EMPTY_FORM, buildProfile, formFromProfile, type ProfileForm as Form } from "../lib/profile";
import type { AgentController } from "../lib/useAgent";
import { btn, btnPrimary, panel } from "./ui";

export function ProfileForm({ agent }: { agent: AgentController }) {
  const [form, setForm] = useState<Form>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PlaceSuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);
  const generation = useRef(0);
  const listId = useId();

  // Pick up a profile the chat set on the server, once (first time one has an anchor/budget).
  const serverProfile = agent.view?.profile;
  const hydrated = useRef(false);
  useEffect(() => {
    if (!serverProfile || hydrated.current) return;
    const has = serverProfile.anchors.length > 0 || serverProfile.budget || serverProfile.commuteCap || serverProfile.layout;
    if (has) {
      hydrated.current = true;
      setForm(formFromProfile(serverProfile));
      setQuery("");
    }
  }, [serverProfile]);

  useEffect(() => {
    const trimmed = query.trim();
    const gen = ++generation.current;
    if (trimmed === "") {
      setResults([]);
      setSearchFailed(false);
      return;
    }
    const handle = setTimeout(() => {
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
    return () => clearTimeout(handle);
  }, [query]);

  function choose(place: PlaceSuggestion) {
    // A station is passed by its id; any other place as a point.
    const label = place.nameJa && place.nameJa !== place.name ? `${place.name} (${place.nameJa})` : place.name;
    setForm((f) => ({
      ...f,
      anchor:
        place.kind === "station"
          ? { label, stationId: place.id }
          : { label, point: { lat: place.lat, lon: place.lon } },
    }));
    setQuery("");
    setResults([]);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const built = buildProfile(form, agent.view?.profile);
    if (!built.ok) {
      setError(built.error);
      return;
    }
    setError(null);
    void agent.saveProfile(built.profile);
  }

  const pr = agent.profileResult;

  return (
    <section aria-label="Profile" className={panel}>
      <h2 className="label-utility text-ink">Your situation</h2>
      <form onSubmit={submit} className="mt-3 space-y-3">
        <div>
          <label htmlFor={`${listId}-anchor`} className="label-utility text-[10px] text-ink">
            Where do you need to be?
          </label>
          {form.anchor ? (
            <div className="mt-1 flex items-center justify-between gap-2 border border-moss bg-paper px-3 py-2 text-[14px]">
              <span className="min-w-0 truncate">
                {form.anchor.label}{" "}
                <span className="text-[11px] text-ink-muted">({form.anchor.stationId ? "station" : "place"})</span>
              </span>
              <button type="button" className="text-[12px] underline underline-offset-2" onClick={() => setForm((f) => ({ ...f, anchor: null }))}>
                Change
              </button>
            </div>
          ) : (
            <div className="relative">
              <input
                id={`${listId}-anchor`}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="A station or a place, e.g. Hongo-sanchome"
                autoComplete="off"
                role="combobox"
                aria-expanded={results.length > 0}
                aria-controls={listId}
                className="field-control mt-1 min-h-10 w-full px-3 text-[14px]"
              />
              {(results.length > 0 || searching || searchFailed) && (
                <ul id={listId} role="listbox" className="absolute z-10 mt-0.5 max-h-60 w-full overflow-auto border border-line-strong bg-white text-[13px]">
                  {searching && <li className="px-3 py-2 text-ink-muted">Searching&hellip;</li>}
                  {searchFailed && <li className="px-3 py-2 text-brick">Search failed. Check the API is running.</li>}
                  {results.map((p) => (
                    <li key={`${p.kind}-${p.id}`} role="option" aria-selected={false}>
                      <button type="button" onClick={() => choose(p)} className="block w-full px-3 py-2 text-left hover:bg-sage/50">
                        {p.name}
                        {p.nameJa && p.nameJa !== p.name ? <span lang="ja"> ({p.nameJa})</span> : null}{" "}
                        <span className="text-[11px] text-ink-muted">{p.kind === "station" ? "station" : (p.category ?? "place")}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="label-utility text-[10px] text-ink">Trips per week</span>
            <input type="number" min={0.5} step={0.5} value={form.tripsPerWeek} onChange={(e) => setForm((f) => ({ ...f, tripsPerWeek: e.target.value }))} className="field-control mt-1 min-h-10 w-full px-3 text-[14px]" />
          </label>
          <label className="flex items-end gap-2 pb-2 text-[13px]">
            <input type="checkbox" checked={form.lateReturn} onChange={(e) => setForm((f) => ({ ...f, lateReturn: e.target.checked }))} />
            Often home late
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block">
              <span className="label-utility text-[10px] text-ink">Monthly budget (yen)</span>
              <input type="number" min={1} step={1000} inputMode="numeric" value={form.budget} onChange={(e) => setForm((f) => ({ ...f, budget: e.target.value }))} className="field-control mt-1 min-h-10 w-full px-3 text-[14px]" />
            </label>
            <label className="mt-1 flex items-center gap-2 text-[12px]">
              <input type="checkbox" checked={form.budgetFirm} onChange={(e) => setForm((f) => ({ ...f, budgetFirm: e.target.checked }))} />
              Firm limit
            </label>
          </div>
          <div>
            <label className="block">
              <span className="label-utility text-[10px] text-ink">Commute cap (min, one way)</span>
              <input type="number" min={1} step={5} inputMode="numeric" value={form.commuteCap} onChange={(e) => setForm((f) => ({ ...f, commuteCap: e.target.value }))} className="field-control mt-1 min-h-10 w-full px-3 text-[14px]" />
            </label>
            <label className="mt-1 flex items-center gap-2 text-[12px]">
              <input type="checkbox" checked={form.commuteCapFirm} onChange={(e) => setForm((f) => ({ ...f, commuteCapFirm: e.target.checked }))} />
              Firm limit
            </label>
          </div>
        </div>

        <label className="block">
          <span className="label-utility text-[10px] text-ink">Layout</span>
          <select value={form.layout} onChange={(e) => setForm((f) => ({ ...f, layout: e.target.value }))} className="field-control mt-1 min-h-10 w-full px-3 text-[14px]">
            <option value="">Not set</option>
            {LAYOUT_IDS.map((id) => (
              <option key={id} value={id}>
                {LAYOUTS[id].label}
              </option>
            ))}
          </select>
        </label>

        {error && (
          <p className="text-[13px] text-brick" role="alert">
            {error}
          </p>
        )}
        <div className="flex items-center gap-3">
          <button type="submit" disabled={agent.busy || !agent.sessionId} className={btnPrimary}>
            Set profile
          </button>
          <button type="button" className={btn} onClick={() => { setForm(EMPTY_FORM); setError(null); }}>
            Clear form
          </button>
        </div>
      </form>

      {pr && (
        <div className="mt-3 space-y-1 text-[13px]" aria-live="polite" data-testid="profile-result">
          <p className="tnum">{pr.feasibleCount} areas pass your firm limits.</p>
          {pr.refusedAnchors.map((r) => (
            <p key={r.anchorId} className="text-brick">
              Anchor refused: {r.message}
            </p>
          ))}
          {pr.missing.length > 0 && <p className="text-ink-muted">Still missing: {pr.missing.map((m) => m.replace("_", " ")).join(", ")}.</p>}
        </div>
      )}
    </section>
  );
}

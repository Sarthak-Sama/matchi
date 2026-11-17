"use client";
import { useState } from "react";
import { areaName, makeNameOf, preferOverNeighbour } from "../lib/evidence";
import { chanceLabel, whyLine } from "../lib/derive";
import { yen, yenSigned } from "../lib/format";
import { FEATURE_KEY_LIST, termLabel, type BreakdownTerm, type ShortlistItem } from "../lib/types";
import type { AgentController } from "../lib/useAgent";
import { AreaMapLink } from "./AreaMapLink";
import { AreaFacts } from "./AreaCard";
import { ExplanationBody } from "./ExplanationTurn";
import { Sheet } from "./Sheet";
import { btn, linkBtn } from "./ui";
export function AreaSheet({
  agent,
  item,
  onClose,
}: {
  agent: AgentController;
  item: ShortlistItem | null;
  onClose: () => void;
}) {
  const [all, setAll] = useState(false);
  const [compareId, setCompareId] = useState("");
  const list = agent.view?.recommendation?.shortlist ?? [];
  const current = list.find((s) => s.localityId === item?.localityId) ?? item;
  const index = list.findIndex((s) => s.localityId === current?.localityId);
  const prefer = preferOverNeighbour(list, index);
  const neighbour = list[index + 1] ?? list[index - 1];
  const disabled = agent.busy || agent.streaming;
  const b = current?.breakdown;
  const rows = b
    ? (
        [
          { term: "rent", value: b.rent },
          { term: "timeCost", value: b.timeCost },
          { term: "budgetPenalty", value: b.budgetPenalty },
          { term: "capPenalty", value: b.capPenalty },
          ...FEATURE_KEY_LIST.map((k) => ({ term: k, value: b.features[k] })),
        ] as { term: BreakdownTerm; value: number }[]
      )
        .filter((r) => Math.round(r.value) !== 0)
        .sort((a, c) => Math.abs(c.value) - Math.abs(a.value))
    : [];
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.value)));
  const c = current?.confidence;
  return (
    <Sheet open={!!item} onClose={onClose} title={current ? areaName(current) : "Area details"}>
      {current && c && (
        <div className="space-y-6">
          <div>
            <div className="flex flex-wrap items-center justify-between gap-x-4">
              <p className="label-utility text-ink-muted">
                {current.wardNameEn}
                {index >= 0 ? ` · Rank ${index + 1}` : ""}
              </p>
              <AreaMapLink item={current} />
            </div>
            <AreaFacts item={current} />
            <p className="mt-3 text-sm leading-relaxed">{whyLine(current, list)}</p>
            <p className="mt-2 text-xs text-ink-muted">
              Chance this is your best fit: {chanceLabel(current.pBest)}
            </p>
          </div>
          <section>
            <h3 className="font-serif text-xl">How this adds up</h3>
            <p className="mt-2 text-xs leading-relaxed text-ink-muted">
              Each bar is what this costs (−) or gives back (+) each month, at what I think you
              value.
            </p>
            <ul className="mt-4 space-y-3">
              {(all ? rows : rows.slice(0, 4)).map((r) => (
                <li
                  key={r.term}
                  className="grid grid-cols-[minmax(0,1fr)_minmax(3rem,1fr)_5rem] items-center gap-2 text-xs"
                >
                  <span>{termLabel(r.term)}</span>
                  <span aria-hidden="true" className="relative h-2 bg-sage">
                    <span
                      className={`absolute h-2 ${r.value < 0 ? "right-1/2 bg-brick/70" : "left-1/2 bg-moss"}`}
                      style={{ width: `${(Math.abs(r.value) / max) * 50}%` }}
                    />
                    <span className="absolute left-1/2 h-2 w-px bg-ink/40" />
                  </span>
                  <span className="tnum text-right">{yenSigned(r.value)}</span>
                </li>
              ))}
            </ul>
            <div className="mt-2 flex items-center justify-between gap-3">
              <button className={`${linkBtn} min-h-11`} onClick={() => setAll(!all)}>
                {all ? "Fewer factors" : `All ${rows.length} factors`}
              </button>
              <span className="tnum text-xs">Total {yenSigned(current.breakdown.total)}</span>
            </div>
          </section>
          <section className="border-t border-line pt-4">
            <h3 className="font-serif text-xl">Cost if I’ve misread you</h3>
            <p className="mt-2 text-sm leading-relaxed">
              If I’m wrong about you, picking this could cost about {yen(current.regretYen)} a
              month.
            </p>
            <p className="mt-2 text-sm text-ink-muted">
              Travel {current.monthlyTravelHours.toFixed(1)} h a month.
            </p>
          </section>
          <section>
            <h3 className="font-serif text-xl">How sure is this?</h3>
            <ul className="mt-3 space-y-2 text-xs leading-relaxed text-ink-muted">
              <li>
                {c.rent === "near_price_point"
                  ? "Rent estimate: based on nearby listings’ prices"
                  : c.rent === "distant_price_point"
                    ? "Rent estimate: based on prices a little further away"
                    : "Rent estimate: rough, from ward-wide averages"}
              </li>
              {c.access && <li>Station access data: {c.access}</li>}
              <li>Commute could be ± {Math.round(c.commuteBandMinutes)} min</li>
              {c.lateReturnNotCovered && <li>Last-train times not checked</li>}
              {!!current.similarNearby?.length && (
                <li>{current.similarNearby.length} similar areas nearby</li>
              )}
            </ul>
          </section>
          <div className="space-y-3 border-t border-line pt-4">
            {prefer && neighbour && (
              <button
                className={`${btn} w-full`}
                disabled={disabled}
                onClick={() => void agent.addEvidence([prefer])}
              >
                Prefer over {areaName(neighbour)}
              </button>
            )}
            {index !== 0 && (
              <button
                className={`${btn} w-full`}
                disabled={disabled}
                onClick={() => void agent.whyNot(current.localityId)}
              >
                Why isn’t this #1?
              </button>
            )}
            <form
              className="flex flex-wrap gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (compareId) void agent.compare(current.localityId, compareId);
              }}
            >
              <label className="sr-only" htmlFor="area-compare">
                Compare with another area
              </label>
              <select
                id="area-compare"
                className="field-control min-h-11 min-w-0 flex-1 px-2 text-sm"
                value={compareId}
                onChange={(e) => setCompareId(e.target.value)}
                onKeyDown={(e) => {
                  if (e.nativeEvent.isComposing) return;
                  const choices = [
                    "",
                    ...list
                      .filter((s) => s.localityId !== current.localityId)
                      .map((s) => s.localityId),
                  ];
                  const position = choices.indexOf(compareId);
                  const next =
                    e.key === "ArrowDown"
                      ? Math.min(position + 1, choices.length - 1)
                      : e.key === "ArrowUp"
                        ? Math.max(position - 1, 0)
                        : e.key === "Home"
                          ? 0
                          : e.key === "End"
                            ? choices.length - 1
                            : null;
                  if (next !== null) {
                    e.preventDefault();
                    setCompareId(choices[next] ?? "");
                  }
                }}
              >
                <option value="">Compare with…</option>
                {list
                  .filter((s) => s.localityId !== current.localityId)
                  .map((s) => (
                    <option key={s.localityId} value={s.localityId}>
                      {areaName(s)}
                    </option>
                  ))}
              </select>
              <button
                className={btn}
                disabled={disabled || !compareId || !list.some((s) => s.localityId === compareId)}
              >
                Compare
              </button>
            </form>
          </div>
          {agent.explanation && (
            <div className="border-t border-line pt-4 text-sm leading-relaxed" aria-live="polite">
              <ExplanationBody ex={agent.explanation} names={makeNameOf([...list, current])} />
            </div>
          )}
        </div>
      )}
    </Sheet>
  );
}

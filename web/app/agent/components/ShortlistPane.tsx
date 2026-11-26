"use client";
import { useEffect, useState } from "react";
import { LayoutGroup, motion, useReducedMotion } from "motion/react";
import type { AgentController } from "../lib/useAgent";
import { confidenceMeter, hasBrief, plainParam } from "../lib/derive";
import { trackAreaOnce } from "../lib/areaEvents";
import { makeNameOf } from "../lib/evidence";
import { AreaCard } from "./AreaCard";
import { YourBrief } from "./YourBrief";
import { DataSources, RelaxList } from "./Shortlist";
import { ShortlistMap } from "./ShortlistMap";
import { btn, linkBtn } from "./ui";
const COLLAPSED_COUNT = 3;

export function ShortlistPane({
  agent,
  onDetails,
  onArea,
  deltas,
  summary,
  busy = false,
}: {
  deltas: Record<string, number | "New">;
  summary: string;
  agent: AgentController;
  onDetails: () => void;
  onArea: (id: string) => void;
  /** A turn is running: the shortlist may change under the reader. */
  busy?: boolean;
}) {
  const reduced = useReducedMotion();
  const [expanded, setExpanded] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const rec = agent.view?.recommendation;
  const profile = agent.view?.profile;
  const ready = hasBrief(profile);
  const meter = rec ? confidenceMeter(rec) : null;
  const names = makeNameOf(rec?.shortlist ?? []);
  const visibleCount = expanded ? (rec?.shortlist.length ?? 0) : COLLAPSED_COUNT;
  const visibleIds = (rec?.shortlist ?? []).slice(0, visibleCount).map((s) => s.localityId);
  const visibleKey = visibleIds.join(",");
  useEffect(() => {
    visibleKey
      .split(",")
      .filter(Boolean)
      .forEach((id, rank) => trackAreaOnce("impression", agent.sessionId, id, { rank: rank + 1 }));
  }, [visibleKey, agent.sessionId]);
  return (
    <div className={`transition-opacity motion-reduce:transition-none ${busy ? "opacity-60" : ""}`} aria-busy={busy}>
      <p className="sr-only" aria-live="polite">
        {summary}
      </p>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-serif text-[1.35rem]">Your shortlist</h2>
        {ready && rec && (
          <p className="tnum text-xs text-ink-muted">{rec.feasibleCount} areas fit</p>
        )}
      </div>
      {ready && meter && (
        <div className="mt-3 text-[11px] text-ink-muted">
          <p>How well I know you</p>
          <div className="mt-1.5 flex items-center gap-2">
            <span role="img" aria-label={`${meter.steps} of 5`} className="flex gap-1">
              {[0, 1, 2, 3, 4].map((i) => (
                <span
                  key={i}
                  className={`h-1 w-2.5 transition-colors duration-300 motion-reduce:transition-none ${i < meter.steps ? "bg-moss" : "bg-line"}`}
                />
              ))}
            </span>
            {meter.caption}
          </div>
        </div>
      )}
      {agent.busy && rec && (
        <div
          role="status"
          aria-label="Updating your shortlist"
          className="skeleton mt-3 h-0.5 w-full"
        />
      )}
      {!agent.sessionId ? (
        <div className="mt-6 space-y-3" role="status" aria-label="Loading shortlist">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton h-40" />
          ))}
        </div>
      ) : !ready ? (
        <div className="mt-12 border-t border-line pt-6">
          <p className="font-serif text-2xl">A little about your week first.</p>
          <ul className="my-5 space-y-4 text-sm text-ink-muted">
            {[
              [!!profile?.anchors.length, "Where you need to be"],
              [!!(profile?.budget || profile?.commuteCap), "A budget or commute limit"],
              [!!profile?.layout, "Your layout"],
            ].map(([done, label]) => (
              <li key={String(label)} className="flex gap-3">
                <span aria-hidden="true">{done ? "✓" : "□"}</span>
                {String(label)}
              </li>
            ))}
          </ul>
          <p className="text-sm leading-relaxed text-ink-muted">
            Your shortlist appears here once I know these.
          </p>
          <button className={`${linkBtn} mt-3 min-h-11`} onClick={onDetails}>
            Fill in the basics
          </button>
        </div>
      ) : (
        <>
          <YourBrief agent={agent} onDetails={onDetails} />
          {rec && rec.shortlist.length > 0 && (
            <>
              <LayoutGroup>
                <ul
                  aria-busy={agent.busy}
                  className={`space-y-3 ${agent.busy ? "opacity-60" : ""}`}
                >
                  {rec.shortlist.map((item, i) => (
                    <motion.li
                      layout={reduced ? false : "position"}
                      transition={{ duration: reduced ? 0 : 0.36, ease: [0.22, 0.61, 0.36, 1] }}
                      hidden={!expanded && i >= COLLAPSED_COUNT}
                      key={item.localityId}
                      data-testid="shortlist-card"
                      className={`border border-line bg-paper-soft p-4 ${i === 0 ? "border-t-2 border-t-ink" : ""}`}
                    >
                      <AreaCard
                        item={item}
                        index={i}
                        list={rec.shortlist}
                        agent={agent}
                        onDetails={() => onArea(item.localityId)}
                        delta={deltas[item.localityId]}
                      />
                    </motion.li>
                  ))}
                </ul>
              </LayoutGroup>
              <div className="flex flex-wrap items-center justify-between gap-x-4">
                {rec.shortlist.length > COLLAPSED_COUNT ? (
                  <button className={`${linkBtn} min-h-11`} onClick={() => setExpanded(!expanded)}>
                    {expanded
                      ? "Show fewer"
                      : `Show ${rec.shortlist.length - COLLAPSED_COUNT} more`}
                  </button>
                ) : (
                  <span />
                )}
                <button className={`${linkBtn} min-h-11`} onClick={() => setShowMap(!showMap)}>
                  {showMap ? "Hide map" : "Show on map"}
                </button>
              </div>
              {showMap && (
                <ShortlistMap
                  shortlist={rec.shortlist}
                  anchor={profile?.anchors[0]}
                  onSelect={onArea}
                />
              )}
            </>
          )}
          {rec?.alternative && (
            <p className="mt-4 text-xs leading-relaxed text-ink-muted">
              Not sure?{" "}
              <strong className="font-medium text-ink">{names(rec.alternative.localityId)}</strong>{" "}
              can come out on top if your priorities around {plainParam(rec.alternative.param)}{" "}
              change.
            </p>
          )}
          {rec && (rec.shortlist.length === 0 || !!rec.relax?.length) && (
            <div className="mt-5 border border-line bg-warning/40 p-4">
              <p className="font-serif text-xl">Nothing fits every limit yet.</p>
              <RelaxList
                options={rec.relax ?? []}
                disabled={agent.busy || agent.streaming}
                onApply={(option) => {
                  if (!profile) return;
                  const updated =
                    option.limit === "budget"
                      ? {
                          ...profile,
                          budget: { value: option.newValue, firm: profile.budget?.firm ?? true },
                        }
                      : {
                          ...profile,
                          commuteCap: {
                            value: option.newValue,
                            firm: profile.commuteCap?.firm ?? true,
                          },
                        };
                  void agent.saveProfile(updated);
                }}
              />
              {rec.shortlist.length === 0 && (
                <p className="mt-3 text-xs text-ink-muted">
                  {rec.excluded.nullRent + rec.excluded.nullLifestyle + rec.excluded.missingAccess}{" "}
                  areas have missing data.
                </p>
              )}
              <button className={`${btn} mt-3`} onClick={onDetails}>
                Edit details
              </button>
            </div>
          )}
        </>
      )}
      <DataSources />
    </div>
  );
}

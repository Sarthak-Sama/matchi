"use client";
import { areaName, dislikeArea, likeArea } from "../lib/evidence";
import { chanceLabel, matchStrength, whyLine } from "../lib/derive";
import { aboutYen, percent } from "../lib/format";
import type { AreaSafety, ShortlistItem } from "../lib/types";
import type { AgentController } from "../lib/useAgent";
import { AreaMapLink } from "./AreaMapLink";
import { btn, linkBtn } from "./ui";
export function AreaFacts({ item }: { item: ShortlistItem }) {
  return (
    <dl className="tnum mt-3 flex flex-wrap gap-x-6 gap-y-2">
      <div>
        <dt className="sr-only">Estimated monthly rent</dt>
        <dd className="text-lg font-medium">
          {aboutYen(item.rentYen)} <span className="text-xs font-normal text-ink-muted">/mo</span>
          <span className="block text-[11px] font-normal text-ink-muted">
            Modelled, not a listing
          </span>
        </dd>
      </div>
      <div>
        <dt className="sr-only">One-way commute</dt>
        <dd className="text-lg font-medium">
          {item.commuteMinutes === null ? (
            <>
              — <span className="text-xs font-normal text-ink-muted">add a destination</span>
            </>
          ) : (
            <>
              {Math.round(item.commuteMinutes)}{" "}
              <span className="text-xs font-normal text-ink-muted">min</span>
            </>
          )}
        </dd>
      </div>
    </dl>
  );
}
export function SafetyChips({ safety }: { safety: AreaSafety | null }) {
  if (!safety) return null;
  const chips = [
    safety.quakeRank !== null && {
      label: `Quake ${safety.quakeRank}/5`,
      hint: "Earthquake risk rank, 1 (safest) to 5",
    },
    safety.floodShare !== null && {
      label: `Flood ${percent(safety.floodShare)}`,
      hint: "Share of the area in deep flood zones",
    },
    safety.crimeBand !== null && {
      label: `Crime ${safety.crimeBand}`,
      hint: "Reported crime compared with other areas",
    },
  ].filter((chip) => chip !== false);
  return (
    <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Safety">
      {chips.map((chip) => (
        <li
          key={chip.label}
          title={chip.hint}
          className="border border-line px-1.5 py-0.5 text-[11px] text-ink-muted"
        >
          {chip.label}
        </li>
      ))}
    </ul>
  );
}

export function AreaCard({
  item,
  index,
  list,
  agent,
  onDetails,
  delta,
}: {
  item: ShortlistItem;
  index: number;
  list: readonly ShortlistItem[];
  agent: AgentController;
  onDetails: () => void;
  delta?: number | "New";
}) {
  const strength = matchStrength(item.pBest);
  return (
    <>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="label-utility mb-2 text-[10px] text-ink-muted">
            <span className="font-mono">{index + 1}</span>
            {index === 0 ? " · Top pick" : ""}
          </p>
          <h3 className="font-serif text-[1.35rem] leading-tight">{areaName(item)}</h3>
          <p className="mt-1 text-xs text-ink-muted">
            {item.nameJa !== areaName(item) ? `${item.nameJa} · ` : ""}
            {item.wardNameEn}
          </p>
        </div>
        {delta !== undefined && delta !== 0 && (
          <span
            className={`font-mono text-xs ${delta === "New" ? "text-vermilion-deep" : delta > 0 ? "text-moss" : "text-brick"}`}
          >
            {delta === "New" ? "New" : `${delta > 0 ? "▲" : "▼"}${Math.abs(delta)}`}
          </span>
        )}
      </div>
      <AreaFacts item={item} />
      <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3">
        {item.nearestStation && (
          <p className="text-xs text-ink-muted">
            Near {item.nearestStation.nameEn ?? item.nearestStation.nameJa}
          </p>
        )}
        <AreaMapLink item={item} sessionId={agent.sessionId} />
      </div>
      <SafetyChips safety={item.safety} />
      <p className="mt-3 text-[13px] leading-relaxed">{whyLine(item, list)}</p>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <div
          className="flex items-center gap-2 text-[11px] text-moss"
          title={`Chance this is your best fit: ${chanceLabel(item.pBest)}`}
        >
          <span
            role="img"
            aria-label={`Chance this is your best fit: ${chanceLabel(item.pBest)}`}
            className="flex gap-0.5"
          >
            {[0, 1, 2, 3].map((n) => (
              <span key={n} className={`size-1.5 ${n < strength.steps ? "bg-moss" : "bg-line"}`} />
            ))}
          </span>
          {strength.label}
        </div>
        {(item.confidence.rent !== "near_price_point" || item.confidence.access === "low") && (
          <span className="text-[11px] text-ink-muted">Rough estimate</span>
        )}
      </div>
      <div className="mt-3 grid grid-cols-[1fr_1fr_auto] items-center gap-2">
        <button
          className={btn}
          disabled={agent.busy || agent.streaming}
          onClick={() => void agent.addEvidence([likeArea(item)])}
        >
          ♥ Love it
        </button>
        <button
          className={btn}
          disabled={agent.busy || agent.streaming}
          onClick={() => void agent.addEvidence([dislikeArea(item)])}
        >
          Not for me
        </button>
        <button
          className={`${linkBtn} min-h-11 px-1 text-right`}
          onClick={onDetails}
          aria-label={`Details for ${areaName(item)}`}
        >
          Details ›
        </button>
      </div>
    </>
  );
}

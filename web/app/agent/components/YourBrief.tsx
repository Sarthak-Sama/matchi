"use client";
import { groupEvidence, friendlyText } from "../lib/derive";
import { describeEvidence, makeNameOf } from "../lib/evidence";
import { yen } from "../lib/format";
import type { AgentController } from "../lib/useAgent";
import { linkBtn } from "./ui";
export function YourBrief({ agent, onDetails }: { agent: AgentController; onDetails: () => void }) {
  const profile = agent.view?.profile;
  const names = makeNameOf(agent.view?.recommendation?.shortlist ?? []);
  const facts = [
    profile?.anchors[0]?.label,
    profile?.commuteCap ? `≤ ${profile.commuteCap.value} min` : null,
    profile?.budget ? yen(profile.budget.value) : null,
    profile?.layout,
  ];
  return (
    <div className="my-5 border-y border-line py-3">
      <div className="flex items-center justify-between">
        <h3 className="label-utility text-ink-muted">Your brief</h3>
        <button className={`${linkBtn} min-h-11`} onClick={onDetails}>
          Edit details
        </button>
      </div>
      <div className="flex flex-wrap gap-2 text-xs">
        {facts.filter(Boolean).map((fact, i) => (
          <span key={i} className="border border-line bg-paper px-2 py-2">
            {fact}
          </span>
        ))}
        {!profile?.layout && (
          <button
            className="min-h-11 border border-dashed border-line-strong px-2"
            onClick={onDetails}
          >
            + layout
          </button>
        )}
      </div>
      <ul data-testid="evidence-chips" className="mt-2 flex flex-wrap gap-2">
        {groupEvidence(agent.view?.evidence ?? []).map(({ item, count }) => (
          <li
            key={item.id}
            className="flex max-w-full items-center border border-line bg-sage/40 pl-2 text-xs"
          >
            <span className="break-words">
              {friendlyText(item.quote ?? describeEvidence(item, names))}
              {count > 1 ? ` ×${count}` : ""}
            </span>
            <button
              className="min-h-11 min-w-11 shrink-0 text-ink-muted hover:text-brick"
              disabled={agent.busy || agent.streaming}
              aria-label={`Remove: ${item.quote ?? describeEvidence(item, names)}`}
              onClick={() => void agent.removeEvidence(item)}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

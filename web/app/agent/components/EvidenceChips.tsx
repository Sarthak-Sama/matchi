"use client";
import { describeEvidence, makeNameOf } from "../lib/evidence";
import type { AgentController } from "../lib/useAgent";
import { btn } from "./ui";
/** The current brief lives beside the cards; removed preferences stay available in the working. */
export function EvidenceChips({ agent }: { agent: AgentController }) {
  const names = makeNameOf(agent.view?.recommendation?.shortlist ?? []);
  return (
    <section className="mt-6">
      <h3 className="font-serif text-xl">Removed from your brief</h3>
      <ul data-testid="removed-chips" className="mt-3 space-y-2">
        {agent.removed.map((item) => (
          <li
            key={item.id}
            className="flex items-center justify-between gap-3 border-b border-line py-2 text-xs"
          >
            <span className="line-through">{item.quote ?? describeEvidence(item, names)}</span>
            <button
              className={`${btn} shrink-0`}
              disabled={agent.busy}
              onClick={() => void agent.putBack(item)}
            >
              Put back
            </button>
          </li>
        ))}
      </ul>
      {!agent.removed.length && <p className="text-xs text-ink-muted">Nothing removed.</p>}
    </section>
  );
}

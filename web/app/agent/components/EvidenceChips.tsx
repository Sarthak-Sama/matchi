"use client";

import { describeEvidence, makeNameOf } from "../lib/evidence";
import type { AgentController } from "../lib/useAgent";
import { panel } from "./ui";

export function EvidenceChips({ agent }: { agent: AgentController }) {
  const evidence = agent.view?.evidence ?? [];
  const names = makeNameOf(agent.view?.recommendation?.shortlist ?? []);

  return (
    <section aria-label="Evidence" className={panel}>
      <h2 className="label-utility text-ink">What you have told me</h2>
      {evidence.length === 0 ? (
        <p className="mt-2 text-[14px] text-ink-muted">Nothing yet. Say what you like, or use the quick answers.</p>
      ) : (
        <ul className="mt-2 flex flex-wrap gap-2" data-testid="evidence-chips">
          {evidence.map((e) => (
            <li
              key={e.id}
              className="flex items-center gap-1.5 border border-moss bg-sage/40 py-1 pr-1 pl-2.5 text-[13px]"
              title={describeEvidence(e, names)}
            >
              <span>
                {e.quote ? <>&ldquo;{e.quote}&rdquo;</> : describeEvidence(e, names)}
                {e.strength !== "normal" && <span className="ml-1 text-[11px] text-ink-muted">({e.strength})</span>}
              </span>
              <button
                type="button"
                disabled={agent.busy}
                onClick={() => void agent.removeEvidence(e)}
                aria-label={`Remove: ${e.quote ?? describeEvidence(e, names)}`}
                className="px-1.5 text-[15px] leading-none text-ink-muted hover:text-brick disabled:opacity-50"
              >
                &times;
              </button>
            </li>
          ))}
        </ul>
      )}
      {agent.removed.length > 0 && (
        <div className="mt-3">
          <p className="label-utility text-[10px] text-ink-muted">Removed</p>
          <ul className="mt-1 flex flex-wrap gap-2" data-testid="removed-chips">
            {agent.removed.map((e) => (
              <li
                key={e.id}
                className="flex items-center gap-1.5 border border-dashed border-line-strong py-1 pr-1 pl-2.5 text-[13px] text-ink-muted"
              >
                <span className="line-through">{e.quote ? <>&ldquo;{e.quote}&rdquo;</> : describeEvidence(e, names)}</span>
                <button
                  type="button"
                  disabled={agent.busy}
                  onClick={() => void agent.putBack(e)}
                  className="border border-line-strong bg-paper px-1.5 py-0.5 text-[11px] font-medium text-ink hover:border-ink disabled:opacity-50"
                >
                  Put back
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

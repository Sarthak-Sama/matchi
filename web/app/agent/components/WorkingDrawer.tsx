"use client";
import { useId, useState } from "react";
import type { AgentController } from "../lib/useAgent";
import { yen } from "../lib/format";
import { Sheet } from "./Sheet";
import { EngineControls } from "./EngineControls";
import { BeliefPanel } from "./BeliefPanel";
import { Excluded } from "./Shortlist";
import { EvidenceChips } from "./EvidenceChips";
import { Trace } from "./Trace";
import { btn } from "./ui";
const tabs = ["Fine-tune", "What I think matters", "Left out", "Trace"];
function stopCopy(reason: string | null): string {
  if (reason === "question_limit") return "Stopping: the question limit is reached.";
  if (reason === "nothing_left_to_learn")
    return "Stopping: none of the questions I could ask would change the ranking.";
  return "Stopping: that is below the threshold.";
}
export function WorkingDrawer({
  agent,
  open,
  onClose,
}: {
  agent: AgentController;
  open: boolean;
  onClose: () => void;
}) {
  const [tab, setTab] = useState(0);
  const id = useId();
  const rec = agent.view?.recommendation;
  return (
    <Sheet open={open} onClose={onClose} title="Show the working">
      <div
        role="tablist"
        aria-label="Working sections"
        className="mb-5 flex flex-wrap border-b border-line"
      >
        {tabs.map((label, i) => (
          <button
            key={label}
            role="tab"
            id={`${id}-tab-${i}`}
            aria-controls={`${id}-panel-${i}`}
            aria-selected={tab === i}
            tabIndex={tab === i ? 0 : -1}
            className={`min-h-11 px-2 text-xs ${tab === i ? "border-b-2 border-moss text-moss" : "text-ink-muted"}`}
            onClick={() => setTab(i)}
            onKeyDown={(e) => {
              const next =
                e.key === "ArrowRight"
                  ? (i + 1) % 4
                  : e.key === "ArrowLeft"
                    ? (i + 3) % 4
                    : e.key === "Home"
                      ? 0
                      : e.key === "End"
                        ? 3
                        : null;
              if (next !== null) {
                e.preventDefault();
                setTab(next);
                document.getElementById(`${id}-tab-${next}`)?.focus();
              }
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {tabs.map((label, i) => (
        <div
          key={label}
          role="tabpanel"
          id={`${id}-panel-${i}`}
          aria-labelledby={`${id}-tab-${i}`}
          hidden={tab !== i}
          tabIndex={0}
        >
          {i === 0 && (
            <>
              <EngineControls agent={agent} />
              <p className="my-4 text-sm" data-testid="risk-line">
                {rec ? (
                  <>
                    What I still don’t know about you is worth about {yen(rec.riskYen)} a month.{" "}
                    {rec.shouldStop
                      ? stopCopy(rec.stopReason)
                      : "More answers would sharpen it."}
                  </>
                ) : (
                  "Waiting for your shortlist."
                )}
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  className={btn}
                  disabled={agent.busy}
                  onClick={() => void agent.recommend()}
                >
                  Recompute shortlist
                </button>
                <button className={btn} disabled={agent.busy} onClick={() => void agent.relax()}>
                  Relax limits
                </button>
              </div>
              <EvidenceChips agent={agent} />
            </>
          )}
          {i === 1 && <BeliefPanel belief={agent.view?.belief ?? null} />}
          {i === 2 && agent.view?.excluded && <Excluded excluded={agent.view.excluded} />}
          {i === 3 && (
            <>
              <Trace entries={agent.trace} />
              <p className="mt-4 break-all font-mono text-xs">
                Session {agent.sessionId ?? "not started"}
              </p>
              <button
                className={`${btn} mt-2`}
                disabled={!agent.sessionId}
                onClick={() => {
                  if (agent.sessionId) void navigator.clipboard.writeText(agent.sessionId);
                }}
              >
                Copy
              </button>
            </>
          )}
        </div>
      ))}
    </Sheet>
  );
}

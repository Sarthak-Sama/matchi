"use client";
import { useEffect, useMemo, useState } from "react";
import { LAYOUT_IDS, LAYOUTS } from "@tokyo/shared";
import { answersFor, makeNameOf } from "../lib/evidence";
import { buildProfile, formFromProfile, type ProfileForm } from "../lib/profile";
import { hasBrief } from "../lib/derive";
import { yen } from "../lib/format";
import type { AgentController } from "../lib/useAgent";
import { GuideTurn } from "./Chat";
import { btn, btnPrimary } from "./ui";
export function QuestionTurn({
  agent,
  onDetails,
  hideAreaChoices = false,
}: {
  agent: AgentController;
  onDetails: () => void;
  hideAreaChoices?: boolean;
}) {
  const rec = agent.view?.recommendation;
  const q = useMemo(() => rec?.nextQuestion, [rec]);
  const names = makeNameOf(rec?.shortlist ?? []);
  const [receipts, setReceipts] = useState<string[]>([]);
  const [pending, setPending] = useState<{
    label: string;
    view: typeof agent.view;
    patch?: Partial<ProfileForm>;
  } | null>(null);
  const [budget, setBudget] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    if (!pending || agent.busy) return;
    if (agent.view && agent.view !== pending.view) {
      const form = formFromProfile(agent.view.profile);
      const accepted = pending.patch
        ? Object.entries(pending.patch).every(
            ([key, value]) => form[key as keyof ProfileForm] === value,
          )
        : agent.view.evidence.length > (pending.view?.evidence.length ?? 0);
      if (accepted) setReceipts((r) => [...r, pending.label]);
    }
    setPending(null);
  }, [agent.busy, agent.view, pending]);
  const disabled = agent.busy || agent.streaming || !!pending;
  function save(patch: Partial<ProfileForm>, label: string) {
    if (!agent.view) return;
    const built = buildProfile(
      { ...formFromProfile(agent.view.profile), ...patch },
      agent.view.profile,
    );
    if (!built.ok) {
      setError(built.error);
      return;
    }
    setError("");
    setPending({ label, view: agent.view, patch });
    void agent.saveProfile(built.profile);
  }
  if (!hasBrief(agent.view?.profile) && agent.chatStatus !== "off" && !agent.chatNotice)
    return null;
  return (
    <>
      {receipts.map((label, i) => (
        <p key={i} className="border-l border-line pl-3 text-xs text-ink-muted">
          ✓ {label}
        </p>
      ))}
      {rec?.shortlist.length === 0 ? (
        <GuideTurn>
          <p>Nothing fits every limit yet. Let’s revisit your limits.</p>
          <button className={`${btn} mt-3 font-sans`} onClick={onDetails}>
            Edit details
          </button>
        </GuideTurn>
      ) : rec?.shouldStop ? (
        <GuideTurn>
          <p>
            I think I’ve got you. Love or reject a few to fine-tune, or open any area for the
            details.
          </p>
        </GuideTurn>
      ) : (
        q &&
        (q.kind === "profile_fact" || !hideAreaChoices) && (
          <GuideTurn>
            {q.kind === "profile_fact" ? (
              <>
                <p>
                  {q.missing === "layout"
                    ? "What layout do you need?"
                    : q.missing === "budget"
                      ? "What can you spend on rent each month?"
                      : q.missing === "trips_per_week"
                        ? "How many days a week do you make that trip?"
                        : "Where do you need to be?"}
                </p>
                <div className="mt-3 flex flex-wrap gap-2 font-sans">
                  {q.missing === "layout" && (
                    <>
                      {LAYOUT_IDS.map((id) => (
                        <button
                          key={id}
                          className={btn}
                          disabled={disabled}
                          onClick={() => save({ layout: id }, `Your layout: ${LAYOUTS[id].label}`)}
                        >
                          {pending?.label === `Your layout: ${LAYOUTS[id].label}`
                            ? "Got it…"
                            : LAYOUTS[id].label}
                        </button>
                      ))}
                      <button className={btn} onClick={onDetails}>
                        Other…
                      </button>
                    </>
                  )}
                  {q.missing === "budget" && (
                    <form
                      className="flex min-w-0 gap-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        save({ budget }, `Your budget: ${yen(Number(budget))}`);
                      }}
                    >
                      <label className="sr-only" htmlFor="question-budget">
                        Monthly budget in yen
                      </label>
                      <input
                        id="question-budget"
                        type="number"
                        min={1}
                        required
                        value={budget}
                        onChange={(e) => setBudget(e.target.value)}
                        className="field-control min-h-11 min-w-0 w-40 px-3 text-base"
                      />
                      <button className={btnPrimary} disabled={disabled}>
                        {pending ? "Got it…" : "Set"}
                      </button>
                    </form>
                  )}
                  {q.missing === "trips_per_week" &&
                    [1, 2, 3, 4, 5, 6, 7].map((n) => (
                      <button
                        key={n}
                        className={btn}
                        disabled={disabled}
                        onClick={() =>
                          save({ tripsPerWeek: String(n) }, `You travel ${n} days a week`)
                        }
                      >
                        {pending?.label === `You travel ${n} days a week` ? "Got it…" : n}
                      </button>
                    ))}
                  {q.missing === "anchor" && (
                    <button className={btnPrimary} onClick={onDetails}>
                      Choose a place
                    </button>
                  )}
                </div>
                {error && (
                  <p role="alert" className="mt-2 font-sans text-sm text-brick">
                    {error}
                  </p>
                )}
              </>
            ) : (
              <>
                <p>
                  {q.kind === "pair"
                    ? "Quick one — which would you rather live in?"
                    : "Which of these would you pick?"}
                </p>
                <div
                  className={`mt-3 grid gap-2 font-sans ${q.kind === "pair" ? "grid-cols-2" : ""}`}
                >
                  {answersFor(q, names).map((a, i) => {
                    const id =
                      q.kind === "pair"
                        ? i === 0
                          ? q.a
                          : q.b
                        : q.kind === "pick_from_shortlist"
                          ? q.set[i]
                          : undefined;
                    const item = rec?.shortlist.find((s) => s.localityId === id);
                    return (
                      <button
                        key={id}
                        className={`${btn} flex-col items-start py-3 text-left`}
                        disabled={disabled}
                        onClick={() => {
                          setPending({ label: `You picked ${a.label}`, view: agent.view });
                          void agent.addEvidence([a.evidence]);
                        }}
                      >
                        <span>
                          {pending?.label === `You picked ${a.label}` ? "Got it…" : a.label}
                        </span>
                        {item && (
                          <span className="text-[11px] font-normal text-ink-muted">
                            {yen(item.rentYen)} /mo
                            {item.commuteMinutes !== null
                              ? ` · ${Math.round(item.commuteMinutes)} min`
                              : ""}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </GuideTurn>
        )
      )}
    </>
  );
}

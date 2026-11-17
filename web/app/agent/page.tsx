"use client";

import { Masthead } from "../components/Masthead";
import { BeliefPanel } from "./components/BeliefPanel";
import { Chat } from "./components/Chat";
import { EngineControls } from "./components/EngineControls";
import { EvidenceChips } from "./components/EvidenceChips";
import { ProfileForm } from "./components/ProfileForm";
import { Shortlist } from "./components/Shortlist";
import { Trace } from "./components/Trace";
import { btn } from "./components/ui";
import { useAgent } from "./lib/useAgent";

export default function AgentPage() {
  const agent = useAgent();

  return (
    <div className="min-h-screen">
      <Masthead />
      <main className="mx-auto max-w-[1360px] px-5 pt-8 pb-14 sm:px-8">
        <p className="label-utility text-vermilion-deep">Matchi guide</p>
        <h1 className="mt-2 font-serif text-4xl leading-tight font-medium tracking-editorial text-balance">
          Tell the guide about your life. Watch the shortlist change.
        </h1>

        {agent.sessionError && (
          <div className="mt-4 border border-brick bg-warning/60 p-3 text-[14px]" role="alert">
            <p className="font-medium">Could not start a session.</p>
            <p className="text-ink-muted">{agent.sessionError}</p>
            <button type="button" className={`${btn} mt-2`} onClick={() => void agent.startSession()}>
              Try again
            </button>
          </div>
        )}

        {agent.notices.length > 0 && (
          <ul className="mt-4 space-y-1" aria-live="polite">
            {agent.notices.map((n, i) => (
              <li key={`${i}-${n}`} className="flex items-start justify-between gap-3 border border-line bg-warning/50 px-3 py-1.5 text-[13px]">
                <span>{n}</span>
                <button type="button" aria-label="Dismiss" className="text-ink-muted" onClick={() => agent.dismissNotice(i)}>
                  &times;
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
          <div className="space-y-4">
            <Chat agent={agent} />
            <ProfileForm agent={agent} />
            <EngineControls agent={agent} />
            <Trace entries={agent.trace} />
          </div>
          <div className="space-y-4">
            <Shortlist agent={agent} />
            <EvidenceChips agent={agent} />
            <BeliefPanel belief={agent.view?.belief ?? null} />
          </div>
        </div>

        <div className="mt-6 flex items-center gap-3 text-[12px] text-ink-muted">
          <span>Session {agent.sessionId ?? "not started"}</span>
          <button type="button" className={btn} disabled={agent.busy} onClick={() => void agent.startSession()}>
            Start over
          </button>
        </div>
      </main>
    </div>
  );
}

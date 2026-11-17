"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

import type { AgentController } from "../lib/useAgent";
import { btnPrimary, panel } from "./ui";

export function Chat({ agent }: { agent: AgentController }) {
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const off = agent.chatStatus === "off";
  const disabled = !agent.sessionId || agent.streaming || off;

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [agent.messages]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || disabled) return;
    setDraft("");
    void agent.sendMessage(text);
  }

  return (
    <section aria-label="Chat" className={panel}>
      <h2 className="label-utility text-ink">Talk to the guide</h2>

      {off && (
        <div className="mt-2 border border-line bg-warning/60 p-3 text-[13px]" role="alert">
          <p className="font-medium">Chat is unavailable, so the page is running on the engine alone.</p>
          <p className="mt-1 text-ink-muted">
            {agent.chatNotice ?? "The API returned an error."} The profile form and quick answers still work and
            update the shortlist.
          </p>
          <button type="button" onClick={agent.retryChat} className="mt-2 underline underline-offset-2">
            Try chat again
          </button>
        </div>
      )}

      <div className="mt-3 max-h-80 space-y-2 overflow-y-auto" aria-live="polite" data-testid="chat-log">
        {agent.messages.length === 0 && !off && (
          <p className="text-[13px] text-ink-muted">
            Describe your situation in your own words: where you go, how often, what you can spend, what you can&rsquo;t
            stand.
          </p>
        )}
        {agent.messages.map((m) => (
          <div
            key={m.id}
            className={`px-3 py-2 text-[14px] whitespace-pre-wrap ${
              m.role === "user" ? "ml-8 bg-sage/50" : m.caught ? "mr-8 border border-brick bg-warning/40" : "mr-8 border border-line bg-paper"
            }`}
          >
            <p className="label-utility mb-0.5 text-[10px] text-ink-muted">{m.role === "user" ? "You" : "Guide"}</p>
            <p className={m.caught ? "line-through decoration-brick/60" : ""}>{m.text}</p>
            {m.grounding && (
              <p className={`mt-1 text-[11px] ${m.grounding.pass ? "text-moss" : "text-brick"}`}>
                {m.grounding.pass
                  ? "Grounding check passed: every figure came from a tool result."
                  : `Caught by the grounding check: ${m.grounding.failures.map((f) => f.figure).join(", ") || "unmatched figures"}. The guide was asked to answer again.`}
              </p>
            )}
          </div>
        ))}
        {agent.streaming && <p className="text-[12px] text-ink-muted">Thinking&hellip;</p>}
        <div ref={endRef} />
      </div>

      <form onSubmit={submit} className="mt-3 flex gap-2">
        <label htmlFor="agent-message" className="sr-only">
          Message
        </label>
        <input
          id="agent-message"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={disabled}
          placeholder={off ? "Chat unavailable" : "e.g. I study in Hongo, work nights, tight budget, I hate noise"}
          className="field-control min-h-10 min-w-0 flex-1 px-3 text-[14px] disabled:opacity-60"
        />
        <button type="submit" disabled={disabled || draft.trim() === ""} className={btnPrimary}>
          Send
        </button>
      </form>
    </section>
  );
}

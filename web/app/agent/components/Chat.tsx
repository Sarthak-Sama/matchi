"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import type { AgentController, ChatMessage } from "../lib/useAgent";
import { GuideReply } from "./GuideReply";
import { btnPrimary, panel } from "./ui";

function GroundingNote({ grounding }: { grounding: NonNullable<ChatMessage["grounding"]> }) {
  if (grounding.pass) {
    return (
      <p
        className="mt-3 flex items-center gap-1.5 text-[11px] text-ink-muted"
        title="Every figure came from a tool result."
      >
        <svg aria-hidden viewBox="0 0 12 12" className="h-3 w-3 text-moss">
          <path d="M2.5 6.3 5 8.7l4.5-5.4" fill="none" stroke="currentColor" strokeWidth="1.6" />
        </svg>
        Figures checked
      </p>
    );
  }
  return (
    <p className="mt-3 text-[11px] text-brick">
      Caught by the grounding check:{" "}
      {grounding.failures.map((f) => f.figure).join(", ") || "unmatched figures"}. The guide was
      asked to answer again.
    </p>
  );
}

export function Chat({ agent }: { agent: AgentController }) {
  const [draft, setDraft] = useState("");
  const logRef = useRef<HTMLDivElement>(null);
  const off = agent.chatStatus === "off";
  const disabled = !agent.sessionId || agent.streaming || agent.busy || off;

  useEffect(() => {
    const log = logRef.current;
    if (!log) return;
    const reply = log.querySelector<HTMLElement>("article:last-of-type");
    const top =
      !agent.streaming && reply
        ? log.scrollTop + reply.getBoundingClientRect().top - log.getBoundingClientRect().top
        : log.scrollHeight;
    log.scrollTo({
      top,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
  }, [agent.messages.length, agent.streaming]);

  const lastGuideId = useMemo(() => {
    for (let i = agent.messages.length - 1; i >= 0; i--) {
      const m = agent.messages[i]!;
      if (m.role === "assistant" && !m.caught) return m.id;
    }
    return null;
  }, [agent.messages]);

  function send(text: string) {
    if (!text || disabled) return;
    void agent.sendMessage(text);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || disabled) return;
    setDraft("");
    send(text);
  }

  return (
    <section aria-label="Chat" className={panel}>
      <h2 className="label-utility text-ink">Talk to the guide</h2>

      {off && (
        <div className="mt-2 border border-line bg-warning/60 p-3 text-[13px]" role="alert">
          <p className="font-medium">
            Chat is unavailable, so the page is running on the engine alone.
          </p>
          <p className="mt-1 text-ink-muted">
            {agent.chatNotice ?? "The API returned an error."} The profile form and quick answers
            still work and update the shortlist.
          </p>
          <button
            type="button"
            onClick={agent.retryChat}
            className="mt-2 underline underline-offset-2"
          >
            Try chat again
          </button>
        </div>
      )}

      <div
        className="mt-3 max-h-[min(72vh,46rem)] space-y-5 overflow-y-auto pr-1 [scrollbar-gutter:stable]"
        ref={logRef}
        aria-live="polite"
        data-testid="chat-log"
      >
        {agent.messages.length === 0 && !off && (
          <p className="text-[13px] leading-[1.55] text-ink-muted">
            Describe your situation in your own words: where you go, how often, what you can spend,
            what you can&rsquo;t stand.
          </p>
        )}
        {agent.messages.map((m) =>
          m.role === "user" ? (
            <div key={m.id} className="flex justify-end">
              <p className="max-w-[85%] bg-sage/60 px-3.5 py-2 text-[14px] leading-[1.5] whitespace-pre-wrap text-ink">
                <span className="sr-only">You: </span>
                {m.text}
              </p>
            </div>
          ) : (
            <article
              key={m.id}
              aria-label="Guide reply"
              className={`relative pl-4 ${m.caught ? "opacity-60" : ""}`}
            >
              <span
                aria-hidden
                className={`absolute top-1 bottom-1 left-0 w-px ${m.caught ? "bg-brick" : "bg-ink/25"}`}
              />
              <p className="label-utility mb-2 flex items-center gap-1.5 text-[10px] text-ink-muted">
                <span
                  aria-hidden
                  className={`h-1.5 w-1.5 rotate-45 ${m.caught ? "bg-brick" : "bg-vermilion"}`}
                />
                Guide
              </p>
              <div className={m.caught ? "line-through decoration-brick/60" : ""}>
                <GuideReply
                  text={m.text}
                  choices={m.choices}
                  selected={
                    agent.messages.find((next) => next.id > m.id && next.role === "user")?.text
                  }
                  inactive={
                    m.id !== lastGuideId ||
                    agent.messages[agent.messages.length - 1]?.role === "user"
                  }
                  onChoose={send}
                  disabled={disabled}
                />
              </div>
              {m.grounding && <GroundingNote grounding={m.grounding} />}
            </article>
          ),
        )}
        {agent.streaming && (
          <p className="flex items-center gap-2 pl-4 text-[12px] text-ink-muted" role="status">
            <span aria-hidden className="flex gap-1">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="h-1 w-1 rotate-45 bg-vermilion motion-safe:animate-pulse"
                  style={{ animationDelay: `${i * 160}ms` }}
                />
              ))}
            </span>
            Checking the data&hellip;
          </p>
        )}
      </div>

      <form onSubmit={submit} className="mt-4 flex gap-2">
        <label htmlFor="agent-message" className="sr-only">
          Message
        </label>
        <input
          id="agent-message"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={disabled}
          placeholder={
            off
              ? "Chat unavailable"
              : "e.g. I study in Hongo, work nights, tight budget, I hate noise"
          }
          className="field-control min-h-10 min-w-0 flex-1 px-3 text-[14px] disabled:opacity-60"
        />
        <button type="submit" disabled={disabled || draft.trim() === ""} className={btnPrimary}>
          Send
        </button>
      </form>
    </section>
  );
}

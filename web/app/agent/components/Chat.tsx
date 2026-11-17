"use client";
import { useEffect, useRef, useState, type ReactNode, type FormEvent } from "react";
import { motion, useReducedMotion } from "motion/react";
import type { AgentController } from "../lib/useAgent";
import { cheaper, closer, quieter } from "../lib/evidence";
import { friendlyText, hasBrief } from "../lib/derive";
import { btn, btnPrimary, linkBtn } from "./ui";

const starters = [
  "I work near Shibuya five days a week, budget about ¥150,000, and I hate noise.",
  "I study at Hongo-sanchome, get home late, and want it cheap.",
  "Two office days in Otemachi. I want a park nearby and good food.",
];
export function GuideTurn({ children }: { children: ReactNode }) {
  return (
    <div>
      <p className="label-utility mb-2 text-[10px] text-vermilion-deep">■ Guide</p>
      <div className="font-serif text-[17px] leading-relaxed">{children}</div>
    </div>
  );
}
export function Chat({
  agent,
  onDetails,
  children,
  mobileShortlist,
}: {
  agent: AgentController;
  onDetails: () => void;
  children?: ReactNode;
  mobileShortlist?: ReactNode;
}) {
  const [draft, setDraft] = useState("");
  const [newReply, setNewReply] = useState(false);
  const [focused, setFocused] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const nearBottom = useRef(true);
  const wasStreaming = useRef(false);
  const reduced = useReducedMotion();
  // Some servers send done after an error; keep the fallback visible until Retry clears the notice.
  const off = agent.chatStatus === "off" || agent.chatNotice !== null;
  const disabled = !agent.sessionId || agent.streaming || agent.busy || off;
  const fresh = agent.messages.length === 0 && !hasBrief(agent.view?.profile);
  useEffect(() => {
    const log = logRef.current;
    if (!log) return;
    if (nearBottom.current) log.scrollTo({ top: log.scrollHeight, behavior: "instant" });
    else setNewReply(true);
  }, [agent.messages, agent.view?.recommendation, agent.explanation]);
  useEffect(() => {
    if (wasStreaming.current && !agent.streaming && !document.querySelector("dialog[open]"))
      inputRef.current?.focus();
    wasStreaming.current = agent.streaming;
  }, [agent.streaming]);
  useEffect(() => {
    const input = inputRef.current;
    if (input) {
      input.style.height = "auto";
      input.style.height = `${Math.min(input.scrollHeight, 132)}px`;
    }
  }, [draft]);
  function submit(e: FormEvent) {
    e.preventDefault();
    if (disabled || !draft.trim()) return;
    const text = draft.trim();
    setDraft("");
    nearBottom.current = true;
    void agent.sendMessage(text);
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      <h2 className="sr-only">Conversation</h2>
      <div
        ref={logRef}
        onScroll={() => {
          const log = logRef.current;
          if (log) {
            nearBottom.current = log.scrollHeight - log.scrollTop - log.clientHeight < 120;
            if (nearBottom.current) setNewReply(false);
          }
        }}
        data-testid="chat-log"
        aria-live="polite"
        aria-label="Conversation messages"
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 sm:px-8"
      >
        <div
          className={`mx-auto flex min-h-full max-w-[68ch] flex-col gap-7 py-7 sm:py-10 ${fresh ? "justify-center" : ""}`}
        >
          {!agent.sessionId ? (
            <div role="status" aria-label="Connecting to the guide" className="space-y-5">
              <div className="skeleton h-9 w-3/4" />
              <div className="skeleton h-16 w-full" />
              <div className="skeleton h-20 w-full" />
            </div>
          ) : (
            fresh && (
              <div>
                <p className="label-utility text-vermilion-deep">Meet your Matchi</p>
                <h2 className="mt-3 max-w-[15ch] font-serif text-4xl leading-[1.05] tracking-editorial sm:text-[44px]">
                  Where does your week happen?
                </h2>
                <p className="mt-4 max-w-[52ch] text-sm leading-relaxed text-ink-muted">
                  Tell me where you go, what you can spend and what you can’t stand. I’ll find the
                  parts of Tokyo that fit, and show you the trade-offs.
                </p>
                {!off && (
                  <div className="mt-7 grid gap-2">
                    {starters.map((text) => (
                      <button
                        key={text}
                        disabled={disabled}
                        onClick={() => {
                          nearBottom.current = true;
                          void agent.sendMessage(text);
                        }}
                        className="flex min-h-14 items-center justify-between gap-4 border border-line bg-paper-soft px-4 py-3 text-left text-[13px] leading-relaxed hover:border-ink disabled:opacity-50"
                      >
                        <span>{text}</span>
                        <span aria-hidden="true" className="text-vermilion-deep">
                          ↗
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                <p className="mt-5 text-xs text-ink-muted">
                  Prefer a form?{" "}
                  <button className={`${linkBtn} min-h-11`} onClick={onDetails}>
                    Fill in the basics
                  </button>
                </p>
              </div>
            )
          )}
          {agent.messages.map((m) => (
            <motion.div
              key={m.id}
              initial={reduced ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: reduced ? 0 : 0.24, ease: [0.22, 0.61, 0.36, 1] }}
              className={
                m.role === "user"
                  ? "ml-auto max-w-[85%] bg-sage/70 px-4 py-3 text-[14.5px] leading-relaxed"
                  : ""
              }
            >
              {m.role === "user" ? (
                <p className="whitespace-pre-wrap">{friendlyText(m.text)}</p>
              ) : (
                <GuideTurn>
                  <p
                    className={`whitespace-pre-wrap ${m.caught ? "line-through decoration-brick/60" : ""}`}
                  >
                    {friendlyText(m.text)}
                  </p>
                  {m.grounding && (
                    <p
                      className={`mt-2 font-sans text-[11px] ${m.grounding.pass ? "text-moss" : "border-l-2 border-brick pl-3 text-brick"}`}
                      title={
                        m.grounding.pass
                          ? "Every figure was checked against a tool result."
                          : undefined
                      }
                    >
                      {m.grounding.pass
                        ? "✓ Figures checked"
                        : `These figures couldn’t be checked: ${m.grounding.failures.map((f) => f.figure).join(", ") || "unmatched figures"}. The guide was asked to answer again.`}
                    </p>
                  )}
                </GuideTurn>
              )}
            </motion.div>
          ))}
          {agent.streaming && (
            <div role="status" className="flex items-center gap-3 text-xs text-ink-muted">
              <span className="flex gap-1" aria-hidden="true">
                {[0, 1, 2].map((i) => (
                  <motion.span
                    key={i}
                    className="size-1.5 bg-vermilion"
                    animate={reduced ? {} : { opacity: [0.3, 1, 0.3] }}
                    transition={{ repeat: Infinity, duration: 1.2, delay: i * 0.15 }}
                  />
                ))}
              </span>
              Reading the city…
            </div>
          )}
          {!agent.streaming && children}
        </div>
      </div>
      {newReply && (
        <button
          className={`${btn} mx-auto mb-2`}
          onClick={() => {
            nearBottom.current = true;
            logRef.current?.scrollTo({
              top: logRef.current.scrollHeight,
              behavior: reduced ? "instant" : "smooth",
            });
            setNewReply(false);
          }}
        >
          ↓ New reply
        </button>
      )}
      <div className="shrink-0 border-t border-line bg-paper px-5 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-8">
        <div className="mx-auto max-w-[68ch]">
          {mobileShortlist}
          {off ? (
            <div className="py-2 text-sm">
              <p className="text-ink-muted">
                Chat is resting right now — you can still set your details and answer the guide’s
                questions.
              </p>
              <div className="mt-3 flex gap-3">
                <button className={btnPrimary} onClick={onDetails}>
                  Enter details
                </button>
                <button className={linkBtn} onClick={agent.retryChat}>
                  Try chat again
                </button>
              </div>
            </div>
          ) : (
            <>
              {hasBrief(agent.view?.profile) && !!agent.view?.recommendation?.shortlist.length && (
                <div
                  className={`mb-3 flex flex-wrap gap-2 ${focused ? "invisible sm:visible" : ""}`}
                >
                  {[
                    ["Quieter", quieter],
                    ["Cheaper", cheaper],
                    ["Closer to work", closer],
                  ].map(([label, make]) => (
                    <button
                      key={String(label)}
                      className={`${btn} bg-transparent`}
                      disabled={disabled}
                      onClick={() => void agent.addEvidence([(make as typeof quieter)()])}
                    >
                      {String(label)}
                    </button>
                  ))}
                </div>
              )}
              <form onSubmit={submit} className="flex items-end gap-2">
                <label htmlFor="agent-message" className="sr-only">
                  Message to the guide
                </label>
                <textarea
                  ref={inputRef}
                  id="agent-message"
                  rows={1}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onFocus={() => setFocused(true)}
                  onBlur={() => setFocused(false)}
                  onKeyDown={(e) => {
                    if (
                      e.key === "Enter" &&
                      !e.shiftKey &&
                      !e.nativeEvent.isComposing &&
                      e.keyCode !== 229
                    ) {
                      e.preventDefault();
                      e.currentTarget.form?.requestSubmit();
                    }
                  }}
                  disabled={disabled}
                  placeholder={
                    !agent.sessionId
                      ? "Connecting…"
                      : agent.streaming
                        ? "The guide is answering…"
                        : "Tell the guide about your week…"
                  }
                  className="field-control max-h-[132px] min-h-12 min-w-0 flex-1 resize-none px-3 py-3 text-base leading-[22px] disabled:opacity-60 sm:text-sm"
                />
                <button
                  type="submit"
                  className={`${btnPrimary} size-12 shrink-0 px-0`}
                  aria-label="Send message"
                  disabled={disabled || !draft.trim()}
                >
                  <span aria-hidden="true">↑</span>
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ApiClientError } from "../../../lib/api";
import { agentApi, streamTurn, type StoredTurn } from "./client";
import { describeChatError, type ChatErrorInfo } from "./errors";
import { choicesFor, type QuickChoice } from "./reply";
import { makeNameOf, withoutId, type NameOf } from "./evidence";
import { track } from "./telemetry";
import { engineEntry, entryFromEvent, stepLabel, type TraceEntry } from "./trace";
import type {
  AgentStateView,
  Comparison,
  Evidence,
  LoggedEvidence,
  Profile,
  ProfileResult,
  RelaxOption,
  WhyNot,
} from "./types";

export interface ChatMessage {
  id: number;
  role: "user" | "assistant";
  text: string;
  /** Frozen with this reply so older cards never inherit a later shortlist. */
  choices?: QuickChoice[];
  grounding?: { pass: boolean; failures: { figure: string; context: string }[] };
}

export type Explanation =
  | { kind: "why_not"; result: WhyNot }
  | { kind: "compare"; result: Comparison }
  | { kind: "relax"; result: RelaxOption[] };

/** Everything on the page, in the order it happened. `seq` is also the message id. */
export type TimelineItem =
  | { kind: "message"; seq: number; message: ChatMessage }
  | { kind: "explanation"; seq: number; explanation: Explanation; names: NameOf }
  | { kind: "receipt"; seq: number; label: string };

type WithoutSeq<T> = T extends unknown ? Omit<T, "seq"> : never;

/** chat: unknown until the first turn; "off" when an error says chat cannot work (no key, daily limit). */
export type ChatStatus = "unknown" | "on" | "off";

const SESSION_STORAGE_KEY = "matchi.agent.session";
/** A turn that hit SESSION_BUSY is tried once more after this pause. */
const BUSY_RETRY_MS = 1500;

/** The shared link's `?s=` wins over the id this browser remembered. */
function savedSessionId(): string | null {
  const fromUrl = new URLSearchParams(window.location.search).get("s");
  if (fromUrl) return fromUrl;
  try {
    return localStorage.getItem(SESSION_STORAGE_KEY);
  } catch {
    return null; // Storage may be disabled in private browsing.
  }
}

function rememberSession(id: string): void {
  try {
    localStorage.setItem(SESSION_STORAGE_KEY, id);
  } catch {
    /* Storage may be disabled in private browsing. */
  }
  const url = new URL(window.location.href);
  url.searchParams.set("s", id);
  window.history.replaceState(window.history.state, "", url);
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function messageOf(err: unknown): string {
  if (err instanceof ApiClientError) {
    if (err.code === "ENGINE_UNAVAILABLE" || err.code === "GRAPH_UNAVAILABLE") {
      return `The recommendation engine is not available on the server yet (${err.code}). ${err.message}`;
    }
    if (err.code === "SESSION_NOT_FOUND")
      return "The session expired on the server. Use Start over.";
    if (err.code === "DAILY_LIMIT" || err.code === "BUDGET_EXHAUSTED")
      return describeChatError(err.code).message;
    return err.message;
  }
  if (err instanceof Error) return err.message;
  return "Something went wrong.";
}

export function useAgent() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [view, setView] = useState<AgentStateView | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notices, setNotices] = useState<string[]>([]);
  const [profileResult, setProfileResult] = useState<ProfileResult | null>(null);
  const [removed, setRemoved] = useState<LoggedEvidence[]>([]);
  const [explanation, setExplanation] = useState<Explanation | null>(null);
  const [trace, setTrace] = useState<TraceEntry[]>([]);
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [chatStatus, setChatStatus] = useState<ChatStatus>("unknown");
  const [chatError, setChatError] = useState<ChatErrorInfo | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [step, setStep] = useState<string | null>(null);

  const idRef = useRef<string | null>(null);
  const viewRef = useRef<AgentStateView | null>(null);
  const seq = useRef(1);
  const lastUserText = useRef("");
  const started = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  const messages = useMemo(
    () => timeline.flatMap((item) => (item.kind === "message" ? [item.message] : [])),
    [timeline],
  );

  const applyView = useCallback((next: AgentStateView) => {
    viewRef.current = next;
    setView(next);
  }, []);

  const log = useCallback((entry: TraceEntry) => setTrace((t) => [...t, entry]), []);
  const notify = useCallback((text: string) => setNotices((n) => [...n.slice(-3), text]), []);
  const dismissNotice = useCallback(
    (index: number) => setNotices((n) => n.filter((_, i) => i !== index)),
    [],
  );

  const append = useCallback(
    (item: WithoutSeq<TimelineItem>) =>
      setTimeline((t) => [...t, { ...item, seq: seq.current++ } as TimelineItem]),
    [],
  );

  const addReceipt = useCallback((label: string) => append({ kind: "receipt", label }), [append]);

  /** Makes a session the current one and rebuilds the page from what the server stored. */
  const adopt = useCallback(
    (id: string, next: AgentStateView, turns: StoredTurn[]) => {
      idRef.current = id;
      setSessionId(id);
      applyView(next);
      setRemoved([]);
      setTrace([]);
      setExplanation(null);
      setProfileResult(null);
      setChatError(null);
      setChatStatus("unknown");
      const restored: TimelineItem[] = turns.map((turn, i) => {
        const message: ChatMessage = { id: seq.current, role: turn.role, text: turn.content };
        // The question cards belong to the last reply only.
        if (turn.role === "assistant" && i === turns.length - 1) message.choices = choicesFor(next);
        return { kind: "message", seq: seq.current++, message };
      });
      setTimeline(restored);
      rememberSession(id);
      log(engineEntry(turns.length > 0 ? "session resumed" : "session created", { sessionId: id }));
    },
    [applyView, log],
  );

  const startSession = useCallback(async () => {
    setSessionError(null);
    setBusy(true);
    try {
      const res = await agentApi.createSession();
      adopt(res.sessionId, res.view, []);
    } catch (err) {
      setSessionError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }, [adopt]);

  /** Opens the remembered session (or a shared one); a new one is created only when it is gone. */
  const resumeSession = useCallback(async () => {
    const saved = savedSessionId();
    if (!saved) return startSession();
    setSessionError(null);
    setBusy(true);
    let gone = false;
    try {
      const res = await agentApi.getSession(saved);
      adopt(saved, res.view, res.turns);
    } catch (err) {
      if (err instanceof ApiClientError && err.code === "SESSION_NOT_FOUND") gone = true;
      else setSessionError(messageOf(err));
    } finally {
      setBusy(false);
    }
    if (gone) await startSession();
  }, [adopt, startSession]);

  useEffect(() => {
    // Strict Mode runs effects twice in development; one session is enough.
    if (!started.current) {
      started.current = true;
      void resumeSession();
    }
    return () => abortRef.current?.abort();
  }, [resumeSession]);

  /** Runs one engine call; errors become a notice and a red trace line. */
  const run = useCallback(
    async <T>(label: string, fn: (id: string) => Promise<T>): Promise<T | null> => {
      const id = idRef.current;
      if (!id) {
        notify("No session yet.");
        return null;
      }
      setBusy(true);
      try {
        const out = await fn(id);
        return out;
      } catch (err) {
        const message = messageOf(err);
        log(engineEntry(`${label} failed: ${message}`, undefined, "bad"));
        notify(`${label} failed: ${message}`);
        return null;
      } finally {
        setBusy(false);
      }
    },
    [log, notify],
  );

  const saveProfile = useCallback(
    async (profile: Profile) => {
      const res = await run("Set profile", (id) => agentApi.putProfile(id, profile));
      if (!res) return;
      applyView(res.view);
      setProfileResult(res.result);
      log(engineEntry(`profile set: ${res.result.feasibleCount} feasible areas`, res.result));
    },
    [run, applyView, log],
  );

  const addEvidence = useCallback(
    async (items: Evidence[]) => {
      const res = await run("Add evidence", (id) => agentApi.addEvidence(id, items));
      if (!res) return;
      applyView(res.view);
      res.results.forEach((r, i) => {
        const quote = items[i]?.quote ?? items[i]?.type ?? "evidence";
        if (!r.ok) {
          notify(`Not accepted (“${quote}”): ${r.error.message}`);
          log(engineEntry(`observe rejected: ${r.error.code}`, r.error, "bad"));
        } else {
          log(
            engineEntry(`observe ${items[i]?.type ?? ""} accepted`, r, r.surprising ? "bad" : "ok"),
          );
          if (r.surprising) {
            notify(
              `Surprising: “${quote}” cuts against the current picture${r.conflictsWith ? ` (conflicts with ${r.conflictsWith})` : ""}.`,
            );
          }
        }
      });
    },
    [run, applyView, log, notify],
  );

  const removeEvidence = useCallback(
    async (item: LoggedEvidence) => {
      const res = await run("Remove evidence", (id) => agentApi.removeEvidence(id, item.id));
      if (!res) return;
      applyView(res.view);
      setRemoved((r) => [...r.filter((x) => x.id !== item.id), item]);
      log(engineEntry(`evidence removed: ${item.quote ?? item.type}`, item));
    },
    [run, applyView, log],
  );

  const putBack = useCallback(
    async (item: LoggedEvidence) => {
      setRemoved((r) => r.filter((x) => x.id !== item.id));
      const before = viewRef.current?.evidence.length ?? 0;
      await addEvidence([withoutId(item)]);
      // If the engine refused it, keep it available to try again.
      if ((viewRef.current?.evidence.length ?? 0) <= before) setRemoved((r) => [...r, item]);
    },
    [addEvidence],
  );

  const recommend = useCallback(async () => {
    const res = await run("Recommend", (id) => agentApi.recommend(id));
    if (!res) return;
    applyView(res.view);
    log(engineEntry("recommend", { shortlist: res.view.recommendation?.shortlist.length ?? 0 }));
  }, [run, applyView, log]);

  const showExplanation = useCallback(
    (explanation: Explanation, view?: AgentStateView) => {
      setExplanation(explanation);
      const shortlist = (view ?? viewRef.current)?.recommendation?.shortlist ?? [];
      append({ kind: "explanation", explanation, names: makeNameOf(shortlist) });
    },
    [append],
  );

  const whyNot = useCallback(
    async (localityId: string) => {
      const res = await run("Why not", (id) => agentApi.whyNot(id, localityId));
      if (!res) return;
      if (res.view) applyView(res.view);
      showExplanation({ kind: "why_not", result: res.result }, res.view);
      log(engineEntry(`why-not ${localityId}: ${res.result.kind}`, res.result));
    },
    [run, applyView, log, showExplanation],
  );

  const compare = useCallback(
    async (a: string, b: string) => {
      const res = await run("Compare", (id) => agentApi.compare(id, a, b));
      if (!res) return;
      if (res.view) applyView(res.view);
      showExplanation({ kind: "compare", result: res.result }, res.view);
      log(engineEntry(`compare ${a} vs ${b}`, res.result));
    },
    [run, applyView, log, showExplanation],
  );

  const relax = useCallback(async () => {
    const res = await run("Relax", (id) => agentApi.relax(id));
    if (!res) return;
    if (res.view) applyView(res.view);
    showExplanation({ kind: "relax", result: res.result }, res.view);
    log(
      engineEntry(
        `relax: ${res.result.length} option${res.result.length === 1 ? "" : "s"}`,
        res.result,
      ),
    );
  }, [run, applyView, log, showExplanation]);

  const updateMessage = useCallback(
    (id: number, change: (message: ChatMessage) => ChatMessage) =>
      setTimeline((t) =>
        t.map((item) =>
          item.kind === "message" && item.message.id === id
            ? { ...item, message: change(item.message) }
            : item,
        ),
      ),
    [],
  );

  /**
   * Streams one attempt of a turn into the timeline. Returns "busy" when the
   * server said SESSION_BUSY and `quietBusy` asked to keep that to ourselves.
   */
  const streamAttempt = useCallback(
    async (
      id: string,
      message: string,
      signal: AbortSignal,
      quietBusy: boolean,
    ): Promise<"done" | "busy"> => {
      let current: number | null = null; // id of the assistant message receiving the reply
      let sawEvent = false;
      let failed = false;
      let replyChars = 0;
      const fail = (code: string | undefined, text?: string) => {
        failed = true;
        const info = describeChatError(code, text);
        setChatError(info);
        if (info.disablesChat) setChatStatus("off");
      };

      for await (const event of streamTurn(id, message, signal)) {
        sawEvent = true;
        if (event.type === "error" && event.code === "SESSION_BUSY" && quietBusy) return "busy";
        if (event.type === "text") {
          replyChars += event.delta.length;
          if (current !== null) {
            updateMessage(current, (m) => ({ ...m, text: m.text + event.delta }));
          } else {
            const messageId = seq.current++;
            current = messageId;
            setTimeline((t) => [
              ...t,
              {
                kind: "message",
                seq: messageId,
                message: { id: messageId, role: "assistant", text: event.delta },
              },
            ]);
          }
          continue;
        }
        if (event.type === "tool_call") {
          setStep(stepLabel(event.name, event.input));
        } else if (event.type === "state") {
          applyView(event.state);
          setStep(stepLabel("grounding"));
        } else if (event.type === "grounding") {
          const grounding = { pass: event.pass, failures: event.failures };
          if (current !== null) updateMessage(current, (m) => ({ ...m, grounding }));
        } else if (event.type === "error") {
          if (event.code === "SESSION_SAVE_FAILED") {
            // The reply is fine; only its saving failed, so chat stays on.
            notify("Saving that turn failed; the next message may not see it.");
          } else {
            fail(event.code, event.message);
          }
        }
        const entry = entryFromEvent(event);
        if (entry) log(entry);
        if (event.type === "done") {
          const choices = choicesFor(viewRef.current);
          if (current !== null) updateMessage(current, (m) => ({ ...m, choices }));
          log(engineEntry(`assistant reply: ${replyChars} characters`));
          if (!failed) {
            setChatStatus("on");
            setChatError(null);
          }
        }
      }
      if (!sawEvent && !signal.aborted) fail("STREAM_INTERRUPTED");
      return "done";
    },
    [applyView, log, notify, updateMessage],
  );

  const sendMessage = useCallback(
    async (text: string, options: { echo?: boolean } = {}) => {
      const id = idRef.current;
      const message = text.trim();
      if (!id || message === "" || streaming) return;
      setStreaming(true);
      setChatError(null);
      lastUserText.current = message;
      // A resend finds the person's message already on the page.
      if (options.echo !== false) {
        const userSeq = seq.current++;
        setTimeline((t) => [
          ...t,
          {
            kind: "message",
            seq: userSeq,
            message: { id: userSeq, role: "user", text: message },
          },
        ]);
      }

      const controller = new AbortController();
      abortRef.current = controller;
      try {
        // The previous turn may still be finishing its save: wait a moment, once.
        const outcome = await streamAttempt(id, message, controller.signal, true);
        if (outcome === "busy") {
          await delay(BUSY_RETRY_MS);
          await streamAttempt(id, message, controller.signal, false);
        }
      } finally {
        setStreaming(false);
        setStep(null);
        abortRef.current = null;
      }
    },
    [streaming, streamAttempt],
  );

  const resend = useCallback(
    () => sendMessage(lastUserText.current, { echo: false }),
    [sendMessage],
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);

  const retryChat = useCallback(() => {
    setChatStatus("unknown");
    setChatError(null);
  }, []);

  /** "Continue in a new chat": the brief carries over, the conversation does not. */
  const continueInNewChat = useCallback(async () => {
    const res = await run("Continue in a new chat", (id) => agentApi.forkSession(id));
    if (res) adopt(res.sessionId, res.view, []);
  }, [run, adopt]);

  /** A copy of this session for someone else; their edits never touch this one. */
  const shareLink = useCallback(async (): Promise<string | null> => {
    const res = await run("Share", (id) => agentApi.forkSession(id));
    if (!res) return null;
    if (idRef.current) track("share", { sessionId: idRef.current });
    return `${window.location.origin}/agent?s=${encodeURIComponent(res.sessionId)}`;
  }, [run]);

  return {
    sessionId,
    view,
    sessionError,
    busy,
    notices,
    dismissNotice,
    profileResult,
    removed,
    explanation,
    trace,
    timeline,
    messages,
    chatStatus,
    chatError,
    streaming,
    step,
    startSession,
    saveProfile,
    addEvidence,
    removeEvidence,
    putBack,
    recommend,
    whyNot,
    compare,
    relax,
    sendMessage,
    resend,
    stop,
    retryChat,
    continueInNewChat,
    shareLink,
    addReceipt,
  };
}

export type AgentController = ReturnType<typeof useAgent>;

"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ApiClientError } from "../../../lib/api";
import { agentApi, streamTurn } from "./client";
import { withoutId } from "./evidence";
import { engineEntry, entryFromEvent, type TraceEntry } from "./trace";
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
  /** Set on an assistant message the grounding check rejected. */
  caught?: boolean;
  grounding?: { pass: boolean; failures: { figure: string; context: string }[] };
}

export type Explanation =
  | { kind: "why_not"; result: WhyNot }
  | { kind: "compare"; result: Comparison }
  | { kind: "relax"; result: RelaxOption[] };

/** chat: unknown until the first turn; "off" after an error event (no key, no stream). */
export type ChatStatus = "unknown" | "on" | "off";

function messageOf(err: unknown): string {
  if (err instanceof ApiClientError) {
    if (err.code === "ENGINE_UNAVAILABLE" || err.code === "GRAPH_UNAVAILABLE") {
      return `The recommendation engine is not available on the server yet (${err.code}). ${err.message}`;
    }
    if (err.code === "SESSION_NOT_FOUND") return "The session expired on the server. Use Start over.";
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
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatStatus, setChatStatus] = useState<ChatStatus>("unknown");
  const [chatNotice, setChatNotice] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);

  const idRef = useRef<string | null>(null);
  const viewRef = useRef<AgentStateView | null>(null);
  const messageId = useRef(1);
  const abortRef = useRef<AbortController | null>(null);

  const applyView = useCallback((next: AgentStateView) => {
    viewRef.current = next;
    setView(next);
  }, []);

  const log = useCallback((entry: TraceEntry) => setTrace((t) => [...t, entry]), []);
  const notify = useCallback((text: string) => setNotices((n) => [...n.slice(-3), text]), []);
  const dismissNotice = useCallback((index: number) => setNotices((n) => n.filter((_, i) => i !== index)), []);

  const startSession = useCallback(async () => {
    setSessionError(null);
    setBusy(true);
    try {
      const res = await agentApi.createSession();
      idRef.current = res.sessionId;
      setSessionId(res.sessionId);
      applyView(res.view);
      setRemoved([]);
      setMessages([]);
      setTrace([]);
      setExplanation(null);
      setProfileResult(null);
      log(engineEntry("session created", { sessionId: res.sessionId }));
    } catch (err) {
      setSessionError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }, [applyView, log]);

  useEffect(() => {
    void startSession();
    return () => abortRef.current?.abort();
  }, [startSession]);

  /** Runs one engine call; errors become a notice and a red trace line. */
  const run = useCallback(
    async <T,>(label: string, fn: (id: string) => Promise<T>): Promise<T | null> => {
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
          log(engineEntry(`observe ${items[i]?.type ?? ""} accepted`, r, r.surprising ? "bad" : "ok"));
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

  const whyNot = useCallback(
    async (localityId: string) => {
      const res = await run("Why not", (id) => agentApi.whyNot(id, localityId));
      if (!res) return;
      if (res.view) applyView(res.view);
      setExplanation({ kind: "why_not", result: res.result });
      log(engineEntry(`why-not ${localityId}: ${res.result.kind}`, res.result));
    },
    [run, applyView, log],
  );

  const compare = useCallback(
    async (a: string, b: string) => {
      const res = await run("Compare", (id) => agentApi.compare(id, a, b));
      if (!res) return;
      if (res.view) applyView(res.view);
      setExplanation({ kind: "compare", result: res.result });
      log(engineEntry(`compare ${a} vs ${b}`, res.result));
    },
    [run, applyView, log],
  );

  const relax = useCallback(async () => {
    const res = await run("Relax", (id) => agentApi.relax(id));
    if (!res) return;
    if (res.view) applyView(res.view);
    setExplanation({ kind: "relax", result: res.result });
    log(engineEntry(`relax: ${res.result.length} option${res.result.length === 1 ? "" : "s"}`, res.result));
  }, [run, applyView, log]);

  const sendMessage = useCallback(
    async (text: string) => {
      const id = idRef.current;
      const message = text.trim();
      if (!id || message === "" || streaming) return;
      setStreaming(true);
      setChatNotice(null);
      const userMsg: ChatMessage = { id: messageId.current++, role: "user", text: message };
      setMessages((m) => [...m, userMsg]);

      const controller = new AbortController();
      abortRef.current = controller;
      let current: number | null = null; // id of the assistant message receiving deltas
      let sawEvent = false;
      let replyChars = 0;

      try {
        for await (const event of streamTurn(id, message, controller.signal)) {
          sawEvent = true;
          if (event.type === "text") {
            replyChars += event.delta.length;
            if (current === null) {
              current = messageId.current++;
              const mid = current;
              setMessages((m) => [...m, { id: mid, role: "assistant", text: event.delta }]);
            } else {
              const mid = current;
              setMessages((m) => m.map((x) => (x.id === mid ? { ...x, text: x.text + event.delta } : x)));
            }
            continue;
          }
          if (event.type === "state") {
            applyView(event.state);
          } else if (event.type === "grounding") {
            const mid = current;
            if (mid !== null) {
              setMessages((m) =>
                m.map((x) =>
                  x.id === mid
                    ? { ...x, caught: !event.pass, grounding: { pass: event.pass, failures: event.failures } }
                    : x,
                ),
              );
            }
            // A failed check is followed by a corrected answer: start a new message for it.
            if (!event.pass) current = null;
          } else if (event.type === "error") {
            setChatStatus("off");
            setChatNotice(event.message);
          }
          const entry = entryFromEvent(event);
          if (entry) log(entry);
          if (event.type === "done") {
            log(engineEntry(`assistant reply: ${replyChars} characters`));
            setChatStatus("on");
          }
        }
        if (!sawEvent) {
          setChatStatus("off");
          setChatNotice("The chat stream returned nothing.");
        }
      } finally {
        setStreaming(false);
        abortRef.current = null;
      }
    },
    [streaming, applyView, log],
  );

  const retryChat = useCallback(() => {
    setChatStatus("unknown");
    setChatNotice(null);
  }, []);

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
    messages,
    chatStatus,
    chatNotice,
    streaming,
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
    retryChat,
  };
}

export type AgentController = ReturnType<typeof useAgent>;

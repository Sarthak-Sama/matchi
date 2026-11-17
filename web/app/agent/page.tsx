"use client";
import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import type { ShortlistItem } from "./lib/types";
import { useAgent } from "./lib/useAgent";
import { useRankChanges } from "./lib/useRankChanges";
import { friendlyText, hasBrief } from "./lib/derive";
import { AgentHeader } from "./components/AgentHeader";
import { AreaSheet } from "./components/AreaSheet";
import { Chat } from "./components/Chat";
import { DetailsSheet } from "./components/DetailsSheet";
import { ExplanationTurn } from "./components/ExplanationTurn";
import { QuestionTurn } from "./components/QuestionTurn";
import { Sheet } from "./components/Sheet";
import { ShortlistPane } from "./components/ShortlistPane";
import { Toasts, type LocalToast } from "./components/Toasts";
import { WorkingDrawer } from "./components/WorkingDrawer";
import { btn } from "./components/ui";

export default function AgentPage() {
  const agent = useAgent();
  const [viewportHeight, setViewportHeight] = useState<number>();
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () => setViewportHeight(viewport.height);
    update();
    viewport.addEventListener("resize", update);
    return () => viewport.removeEventListener("resize", update);
  }, []);
  const reduced = useReducedMotion();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [area, setArea] = useState<ShortlistItem | null>(null);
  const [workingOpen, setWorkingOpen] = useState(false);
  const [shortlistOpen, setShortlistOpen] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [local, setLocal] = useState<LocalToast[]>([]);
  const ranks = useRankChanges(agent.view?.recommendation?.shortlist ?? []);
  const previousRemoved = useRef(new Set<string>());
  useEffect(() => {
    const query = window.matchMedia("(max-width: 1023px)");
    const update = () => setMobile(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    try {
      setWorkingOpen(localStorage.getItem("matchi.agent.working") === "true");
    } catch {
      /* Storage may be disabled in private browsing. */
    }
  }, []);
  useEffect(() => {
    const added = agent.removed.filter((item) => !previousRemoved.current.has(item.id));
    previousRemoved.current = new Set(agent.removed.map((item) => item.id));
    if (added.length)
      setLocal((toasts) => [
        ...toasts,
        ...added.map((item, i) => {
          const id = Date.now() + i;
          return {
            id,
            text: "Removed from your brief.",
            undo: () => {
              void agent.putBack(item);
              setLocal((t) => t.filter((toast) => toast.id !== id));
            },
          };
        }),
      ]);
  }, [agent.removed, agent.putBack]);
  function working(open: boolean) {
    setWorkingOpen(open);
    try {
      localStorage.setItem("matchi.agent.working", String(open));
    } catch {
      /* Storage may be disabled in private browsing. */
    }
  }
  function restart() {
    setArea(null);
    setDetailsOpen(false);
    setShortlistOpen(false);
    setLocal([]);
    void agent.startSession();
  }
  const shortlist = (
    <ShortlistPane
      agent={agent}
      deltas={ranks.deltas}
      summary={ranks.summary}
      onDetails={() => setDetailsOpen(true)}
      onArea={(id) =>
        setArea(agent.view?.recommendation?.shortlist.find((s) => s.localityId === id) ?? null)
      }
    />
  );
  const count = hasBrief(agent.view?.profile)
    ? (agent.view?.recommendation?.shortlist.length ?? 0)
    : 0;
  const pill = (
    <motion.button
      animate={reduced || !ranks.newTop ? {} : { scale: [1, 1.025, 1] }}
      transition={{ duration: reduced ? 0 : 0.4, ease: [0.22, 0.61, 0.36, 1] }}
      className={`${btn} mb-3 w-full justify-between border-moss text-moss lg:hidden`}
      onClick={() => setShortlistOpen(true)}
    >
      <span>Shortlist{count ? ` · ${count}` : ""}</span>
      <span>{ranks.newTop ? "↑ new #1" : "View →"}</span>
    </motion.button>
  );
  return (
    <div
      className="relative flex h-dvh flex-col overflow-hidden"
      style={{ height: viewportHeight }}
    >
      <AgentHeader
        busy={agent.busy || agent.streaming}
        workingOpen={workingOpen}
        onWorking={() => working(!workingOpen)}
        onRestart={restart}
      />
      <main className="mx-auto grid min-h-0 w-full max-w-[1360px] flex-1 grid-cols-1 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <h1 className="sr-only">Matchi guide</h1>
        <section aria-label="Conversation" className="min-h-0">
          {agent.sessionError ? (
            <div role="alert" className="p-5 sm:p-8">
              <h2 className="font-serif text-3xl">I couldn’t reach the guide.</h2>
              <p className="my-4 text-sm text-ink-muted">{friendlyText(agent.sessionError)}</p>
              <button className={btn} onClick={() => void agent.startSession()}>
                Try again
              </button>
            </div>
          ) : (
            <Chat
              key={agent.sessionId}
              agent={agent}
              onDetails={() => setDetailsOpen(true)}
              mobileShortlist={pill}
            >
              <ExplanationTurn agent={agent} />
              <QuestionTurn agent={agent} onDetails={() => setDetailsOpen(true)} />
            </Chat>
          )}
        </section>
        <section
          aria-label="Your shortlist"
          className={`hidden min-h-0 overflow-y-auto overscroll-contain border-l border-line p-5 sm:p-8 lg:block ${agent.sessionError ? "opacity-40" : ""}`}
        >
          {!mobile && shortlist}
        </section>
      </main>
      <Sheet
        open={mobile && shortlistOpen}
        onClose={() => setShortlistOpen(false)}
        title="Your shortlist"
        shortlist
      >
        {mobile && shortlist}
      </Sheet>
      <DetailsSheet
        key={agent.sessionId}
        agent={agent}
        open={detailsOpen}
        onClose={() => setDetailsOpen(false)}
        onSaved={(result) => {
          setDetailsOpen(false);
          setLocal((t) => [
            ...t,
            { id: Date.now(), text: `${result.feasibleCount} areas fit your limits.` },
          ]);
        }}
      />
      <AreaSheet
        key={`${agent.sessionId}-${area?.localityId}`}
        agent={agent}
        item={area}
        onClose={() => setArea(null)}
      />
      <WorkingDrawer agent={agent} open={workingOpen} onClose={() => working(false)} />
      <Toasts
        notices={agent.notices}
        dismissNotice={agent.dismissNotice}
        local={local}
        dismissLocal={(id) => setLocal((t) => t.filter((toast) => toast.id !== id))}
      />
    </div>
  );
}

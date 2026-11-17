"use client";
import { useEffect } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
export interface LocalToast { id: number; text: string; undo?: () => void }
function Toast({ text, dismiss, undo, error }: { text: string; dismiss: () => void; undo?: () => void; error: boolean }) {
  useEffect(() => { if (error) return; const t = setTimeout(dismiss, 6000); return () => clearTimeout(t); }, [dismiss, error]);
  const reduced = useReducedMotion();
  return <motion.li initial={{ opacity: reduced ? 1 : 0, y: reduced ? 0 : 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: reduced ? 0 : .2 }} className={`pointer-events-auto flex items-center gap-3 border p-3 text-sm ${error ? "border-brick/40 bg-warning" : "border-line-strong bg-paper-soft"}`}><span className="min-w-0 flex-1">{text}</span>{undo && <button className="min-h-11 underline" onClick={undo}>Undo</button>}<button className="min-h-11 min-w-11" aria-label="Dismiss notification" onClick={dismiss}>×</button></motion.li>;
}
export function Toasts({ notices, dismissNotice, local, dismissLocal }: { notices: string[]; dismissNotice: (i: number) => void; local: LocalToast[]; dismissLocal: (id: number) => void }) {
  return <ul aria-live="polite" className="pointer-events-none fixed right-4 bottom-32 left-4 z-50 flex max-h-[45dvh] flex-col gap-2 overflow-y-auto sm:left-auto sm:w-96 lg:bottom-5"><AnimatePresence>{notices.map((text,i) => <Toast key={`notice-${text}-${i}`} text={text} error={/fail|error|surprising|not accepted|no session/i.test(text)} dismiss={() => dismissNotice(i)}/>)}{local.map(t => <Toast key={t.id} text={t.text} error={false} dismiss={() => dismissLocal(t.id)} undo={t.undo}/>)}</AnimatePresence></ul>;
}

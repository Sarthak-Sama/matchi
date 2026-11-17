"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { linkBtn } from "./ui";

/** Native modal dialogs supply inert background, nested focus containment and focus restoration. */
export function Sheet({ open, onClose, title, children, shortlist = false }: { open: boolean; onClose: () => void; title: string; children: ReactNode; shortlist?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const id = useId();
  const reduced = useReducedMotion();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) { dialog.showModal(); heading.current?.focus(); }
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return <dialog ref={ref} aria-labelledby={id} aria-modal="true" onCancel={(e) => { e.preventDefault(); onClose(); }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} className={`fixed inset-x-0 top-auto bottom-0 m-0 h-dvh max-h-dvh w-full max-w-none border-0 bg-transparent p-0 text-ink backdrop:bg-ink/20 lg:inset-y-0 lg:right-0 lg:left-auto lg:ml-auto lg:w-[min(480px,92vw)] ${shortlist ? "h-[85dvh]" : ""}`}>
    <motion.div initial={false} animate={open ? { opacity: 1, y: 0 } : { opacity: 0, y: reduced ? 0 : 24 }} transition={{ duration: reduced ? 0 : .2, ease: [.22,.61,.36,1] }} className="flex h-full flex-col border-l border-line bg-paper">
      <div className="flex shrink-0 items-center justify-between gap-4 border-b border-line px-5 py-4"><h2 ref={heading} tabIndex={-1} id={id} className="font-serif text-2xl">{title}</h2><button className={`${linkBtn} min-h-11 px-2`} onClick={onClose} aria-label={`Close ${title}`}>Close ×</button></div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">{children}</div>
    </motion.div>
  </dialog>;
}

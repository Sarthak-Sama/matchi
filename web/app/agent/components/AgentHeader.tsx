"use client";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { linkBtn } from "./ui";
export function AgentHeader({
  busy,
  workingOpen,
  onWorking,
  onRestart,
}: {
  busy: boolean;
  workingOpen: boolean;
  onWorking: () => void;
  onRestart: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    if (!confirm) return;
    const t = setTimeout(() => setConfirm(false), 4000);
    return () => clearTimeout(t);
  }, [confirm]);
  return (
    <header className="sticky top-0 z-30 h-14 shrink-0 border-b border-line bg-paper/95 backdrop-blur-sm">
      <div className="mx-auto flex h-full max-w-[1360px] items-center justify-between gap-2 px-5 sm:px-8">
        <div className="flex items-center gap-3">
          <Link href="/" aria-label="Matchi home" className="flex min-h-11 items-center gap-2">
            <Image src="/matchi-logo.png" alt="" width={28} height={28} />
            <span className="font-serif text-lg font-semibold">Matchi</span>
            <span lang="ja" className="hidden text-vermilion-deep sm:inline">
              街
            </span>
          </Link>
          <span className="label-utility hidden border-l border-line pl-3 sm:block">Guide</span>
        </div>
        <div className="flex items-center gap-2 sm:gap-5">
          <button
            aria-pressed={workingOpen}
            className={`${linkBtn} min-h-11 text-[11px] sm:text-[12.5px] ${confirm ? "hidden sm:inline-flex" : ""}`}
            onClick={onWorking}
          >
            Show the working
          </button>
          {confirm ? (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-[11px] text-ink-muted">Start over?</span>
              <button
                disabled={busy}
                className={`${linkBtn} min-h-11`}
                onClick={() => {
                  setConfirm(false);
                  onRestart();
                }}
              >
                Yes
              </button>
              <button className={`${linkBtn} min-h-11`} onClick={() => setConfirm(false)}>
                Cancel
              </button>
            </div>
          ) : (
            <button
              disabled={busy}
              className={`${linkBtn} min-h-11 text-[11px] sm:text-[12.5px]`}
              onClick={() => setConfirm(true)}
            >
              Start over
            </button>
          )}
        </div>
      </div>
    </header>
  );
}

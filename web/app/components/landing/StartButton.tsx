"use client";

import { motion, useReducedMotion } from "motion/react";
import Link from "next/link";

import { ArrowRightIcon } from "../icons";

export function StartButton({
  children,
  className = "",
}: {
  readonly children: React.ReactNode;
  readonly className?: string;
}) {
  const reducedMotion = useReducedMotion();

  return (
    <motion.div
      className={`inline-flex ${className}`}
      whileHover={reducedMotion ? undefined : "hover"}
      whileTap={reducedMotion ? undefined : { scale: 0.985 }}
      initial="rest"
      animate="rest"
      transition={{ duration: 0.18, ease: [0.22, 0.61, 0.36, 1] }}
    >
      <Link
        href="/find"
        className="relative flex min-h-14 w-full items-center justify-between gap-6 overflow-hidden bg-moss py-2 pr-2 pl-6 text-[16px] font-bold text-paper-soft shadow-[inset_0_-4px_0_rgb(0_0_0/0.22)] transition-colors hover:bg-moss-deep"
      >
        <span className="flex items-center gap-3">
          <span aria-hidden="true" className="size-2.5 rotate-45 bg-vermilion" />
          {children}
        </span>
        <motion.span
          aria-hidden="true"
          className="grid h-10 w-12 place-items-center bg-paper-soft text-moss"
          style={{ clipPath: "polygon(0 0, 70% 0, 100% 50%, 70% 100%, 0 100%)" }}
          variants={{ rest: { x: 0 }, hover: { x: 4 } }}
          transition={{ duration: 0.18, ease: [0.22, 0.61, 0.36, 1] }}
        >
          <ArrowRightIcon className="size-4 -translate-x-1" />
        </motion.span>
      </Link>
    </motion.div>
  );
}

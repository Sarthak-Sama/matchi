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
        className="flex min-h-14 w-full items-center justify-center gap-4 bg-moss px-7 text-[15px] font-semibold text-white transition-colors hover:bg-moss-deep"
      >
        {children}
        <motion.span
          className="inline-flex"
          variants={{ rest: { x: 0 }, hover: { x: 5 } }}
          transition={{ duration: 0.18, ease: [0.22, 0.61, 0.36, 1] }}
        >
          <ArrowRightIcon />
        </motion.span>
      </Link>
    </motion.div>
  );
}

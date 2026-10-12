"use client";

import { motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import Image from "next/image";

import { ArrowRightIcon } from "./icons";

export function Masthead({ variant = "search" }: { readonly variant?: "search" | "landing" }) {
  const isLanding = variant === "landing";
  const reducedMotion = useReducedMotion();

  return (
    <header className="sticky top-0 z-40 border-b border-ink/15 bg-paper-soft/92 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-[1360px] items-center justify-between px-5 sm:px-8">
        <Link href="/" aria-label="Matchi home" className="group flex items-center gap-2.5">
          <motion.span
            className="inline-flex"
            whileHover={reducedMotion ? undefined : { rotate: -7, scale: 1.05 }}
            whileTap={reducedMotion ? undefined : { scale: 0.96 }}
            transition={{ type: "spring", stiffness: 360, damping: 22 }}
          >
            <Image
              src="/matchi-logo.png"
              alt=""
              width={32}
              height={32}
              priority
              className="size-8 shrink-0"
            />
          </motion.span>
          <span className="font-display text-[19px] leading-none font-extrabold tracking-[-0.02em]">
            Matchi
          </span>
          <span
            lang="ja"
            className="grid h-5 place-items-center bg-ink px-1 text-[11px] leading-none font-bold text-paper-soft transition-colors group-hover:bg-vermilion-deep"
          >
            街
          </span>
        </Link>

        <nav aria-label="Main" className="flex items-center gap-6">
          {isLanding ? (
            <>
              <a
                href="#method"
                className="label-utility hidden text-ink-muted transition-colors hover:text-ink sm:inline-block"
              >
                How it works
              </a>
              <Link
                href="/find"
                className="group flex min-h-10 items-center gap-2.5 bg-moss px-3.5 text-paper-soft transition-colors hover:bg-moss-deep"
              >
                <span aria-hidden="true" className="size-1.5 rotate-45 bg-vermilion" />
                <span className="label-utility">Find my Matchi</span>
                <ArrowRightIcon className="size-3.5 transition-transform duration-200 group-hover:translate-x-0.5 motion-reduce:transition-none" />
              </Link>
            </>
          ) : (
            <>
              <a
                href="#methodology"
                className="label-utility hidden text-ink-muted transition-colors hover:text-ink sm:inline-block"
              >
                How it works
              </a>
              <a
                href="#search"
                className="label-utility border border-ink/30 px-3 py-2 text-ink transition-colors hover:border-ink hover:bg-ink hover:text-paper-soft"
              >
                New search
              </a>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}

"use client";

import { motion, useReducedMotion, useScroll, useSpring } from "motion/react";
import type { ReactNode } from "react";

export function ExperienceFrame({ children }: { readonly children: ReactNode }) {
  const reducedMotion = useReducedMotion();
  const { scrollYProgress } = useScroll();
  const progress = useSpring(scrollYProgress, {
    stiffness: 180,
    damping: 32,
    mass: 0.35,
  });

  return (
    <>
      {!reducedMotion && (
        <motion.div
          aria-hidden="true"
          className="fixed inset-x-0 top-0 z-50 h-0.5 origin-left bg-vermilion"
          style={{ scaleX: progress }}
        />
      )}
      {children}
    </>
  );
}

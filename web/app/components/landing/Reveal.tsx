"use client";

import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

/**
 * One reveal, once — a short rise and fade, and nothing else.
 *
 * Two modes, because above and below the fold want different things. The
 * hero is on screen the moment the page exists, so `mount` reveals it as
 * soon as the component does, without waiting on an observer. Everything
 * below uses `scroll` and waits to actually be looked at.
 *
 * The intersection test is hand-rolled rather than Motion's `whileInView`
 * because that hook did not fire in this app; an observer we own is a
 * dozen lines and behaves predictably. It also degrades in the right
 * direction — no observer means show the content, never hide it.
 *
 * Note on background tabs: a browser freezes both animation frames and CSS
 * transitions in a hidden tab, so an entrance animation of either kind
 * sits at its first frame until the tab is looked at, then resumes. That
 * is correct behaviour, not a bug, and it is why this is safe to animate.
 */
export function Reveal({
  children,
  delay = 0,
  mode = "scroll",
  className,
}: {
  readonly children: ReactNode;
  readonly delay?: number;
  /** `mount` reveals immediately; `scroll` waits for the element. */
  readonly mode?: "mount" | "scroll";
  readonly className?: string;
}) {
  const reducedMotion = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (shown) return;
    if (mode === "mount") {
      setShown(true);
      return;
    }
    const element = ref.current;
    // Without an observer there is no way to time the reveal, so show the
    // content rather than hide it indefinitely.
    if (!element || typeof IntersectionObserver === "undefined") {
      setShown(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setShown(true);
          observer.disconnect();
        }
      },
      { rootMargin: "0px 0px -8% 0px" },
    );
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [mode, shown]);

  if (reducedMotion) return <div className={className}>{children}</div>;

  return (
    <motion.div
      ref={ref}
      className={className}
      initial={{ opacity: 0, y: 14 }}
      animate={shown ? { opacity: 1, y: 0 } : { opacity: 0, y: 14 }}
      transition={{ duration: 0.5, delay, ease: [0.22, 0.61, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}

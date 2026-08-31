"use client";

import { useReducedMotion } from "motion/react";

import { INDEX_NAMES, LOCALITY_COUNT } from "./tokyo-localities";

/**
 * The index band: real place names, drifting.
 *
 * The hero claims Tokyo is 937 places rather than one. This is that claim
 * made literal — an actual cross-section of the actual names, moving
 * slowly enough to read, the way a station indicator board moves. It is
 * the only ambient motion on the site, and it earns the exception because
 * the thing in motion is the subject itself, not an ornament.
 *
 * Two rows drift in opposite directions at different speeds so the band
 * reads as depth rather than as a single sliding strip. Both halt on
 * hover or keyboard focus, and reduced motion gets a static, wrapped
 * index instead of a marquee.
 *
 * The loop itself is a CSS keyframe animation (see globals.css): pausing
 * an infinite linear marquee is one declaration in CSS and a pile of
 * imperative playback control in JS.
 */

const ROWS = [
  { names: INDEX_NAMES.slice(0, 48), seconds: 78, direction: -1 },
  { names: INDEX_NAMES.slice(48), seconds: 96, direction: 1 },
] as const;

export function IndexBand() {
  const reducedMotion = useReducedMotion();

  return (
    <section aria-labelledby="index-band-heading" className="border-y border-line-strong bg-sage">
      <div className="mx-auto max-w-[1360px] px-5 pt-8 sm:px-8">
        <p className="label-utility text-moss">The index</p>
        <h2 id="index-band-heading" className="sr-only">
          A cross-section of Tokyo&rsquo;s neighborhoods
        </h2>
        <p className="mt-2 max-w-xl font-serif text-[19px] leading-snug tracking-editorial text-ink sm:text-[22px]">
          Ninety-six of the {LOCALITY_COUNT}. Every one of them is somewhere a person already calls
          home.
        </p>
      </div>

      {reducedMotion ? (
        // Static index — the same names, simply set as a block.
        <ul className="mx-auto mt-6 flex max-w-[1360px] flex-wrap gap-x-6 gap-y-2 px-5 pb-9 sm:px-8">
          {INDEX_NAMES.map((name) => (
            <li key={name} lang="ja" className="font-serif text-[17px] text-ink">
              {name}
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-6 space-y-2 overflow-hidden pb-9">
          {ROWS.map((row) => (
            <MarqueeRow key={row.seconds} {...row} />
          ))}
        </div>
      )}
    </section>
  );
}

function MarqueeRow({
  names,
  seconds,
  direction,
}: {
  readonly names: readonly string[];
  readonly seconds: number;
  readonly direction: 1 | -1;
}) {
  // The list is rendered twice end to end and travels exactly half its own
  // width, so the loop closes on itself with no visible jump.
  const doubled = [...names, ...names];

  return (
    <div
      className="index-row relative flex overflow-hidden"
      // A pause the reader controls: hovering or tabbing into the band
      // stops it, so a name can actually be read.
      tabIndex={0}
      role="group"
      aria-label="Drifting index of neighborhood names. Focus this row to stop it."
    >
      <ul
        aria-hidden="true"
        className={`index-drift flex shrink-0 gap-8 pr-8 ${direction === 1 ? "index-drift-reverse" : ""}`}
        style={{ animationDuration: `${seconds}s` }}
      >
        {doubled.map((name, index) => (
          <li
            key={`${name}-${index}`}
            lang="ja"
            className="font-serif text-[22px] leading-none whitespace-nowrap text-ink/70 transition-colors duration-200 hover:text-vermilion-deep sm:text-[26px]"
          >
            {name}
          </li>
        ))}
      </ul>
    </div>
  );
}

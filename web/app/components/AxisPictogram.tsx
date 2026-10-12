import type { LifestyleAxisId } from "@tokyo/shared";

/**
 * Station-facility pictograms, one per lifestyle axis — drawn in the bold,
 * single-weight style of the signs that tell you where the lockers and the
 * exits are. 24×24, current colour, no text.
 */
const GLYPHS: Record<LifestyleAxisId, React.ReactNode> = {
  supermarkets: (
    <>
      <path
        d="M2.5 4h3l2.2 10.5h10.6L20.5 7H7"
        fill="none"
        strokeWidth="2.2"
        strokeLinejoin="round"
      />
      <circle cx="9.5" cy="18.8" r="1.8" />
      <circle cx="16.5" cy="18.8" r="1.8" />
    </>
  ),
  restaurants: (
    <>
      <path
        d="M7 3v18M4.5 3v5.5a2.5 2.5 0 0 0 5 0V3"
        fill="none"
        strokeWidth="2.1"
        strokeLinecap="round"
      />
      <path
        d="M17 21V3c-2.6 1.6-3.6 4.6-3.6 8.2h3.6"
        fill="none"
        strokeWidth="2.1"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </>
  ),
  quietness: (
    <>
      <path d="M3.5 9h3.8L12 5v14l-4.7-4H3.5Z" />
      <path d="M15.5 10.2a3 3 0 0 1 0 3.6" fill="none" strokeWidth="2" strokeLinecap="round" />
    </>
  ),
  konbini: (
    <>
      <path d="M3 9.5 4.5 4h15L21 9.5" fill="none" strokeWidth="2" strokeLinejoin="round" />
      <path d="M3 9.5h18v1a2.6 2.6 0 0 1-4.5 1.8 2.6 2.6 0 0 1-4.5 0 2.6 2.6 0 0 1-4.5 0A2.6 2.6 0 0 1 3 10.5Z" />
      <path
        d="M5 13.5V20h14v-6.5M10 20v-4.5h4V20"
        fill="none"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </>
  ),
  cuisineVariety: (
    <>
      <path d="M3 12h18a9 9 0 0 1-18 0Z" />
      <path d="m10 9.5 9-7M13.5 10 21 4" fill="none" strokeWidth="1.8" strokeLinecap="round" />
    </>
  ),
  greenSpace: (
    <>
      <path d="M12 2.5 5 12h3.5L5 16.5h14L15.5 12H19Z" />
      <path d="M12 16v5.5" fill="none" strokeWidth="2.4" strokeLinecap="round" />
    </>
  ),
  lateNight: (
    <>
      <path d="M9 2.5h6M9 21.5h6" fill="none" strokeWidth="2" strokeLinecap="round" />
      <path d="M8.5 4.5h7c2.2 2 3.3 4.5 3.3 7.5s-1.1 5.5-3.3 7.5h-7C6.3 17.5 5.2 15 5.2 12s1.1-5.5 3.3-7.5Z" />
      <path
        d="M5.6 9.5h12.8M5.6 14.5h12.8"
        fill="none"
        strokeWidth="1.2"
        className="stroke-[var(--pictogram-ground,#fff)]"
      />
    </>
  ),
  health: <path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6Z" />,
};

export function AxisPictogram({
  axis,
  className = "size-10",
  tone = "solid",
}: {
  readonly axis: LifestyleAxisId;
  readonly className?: string;
  /** solid: white glyph on an ink tile, as on a station sign. inverse: green on white. bare: glyph only. */
  readonly tone?: "solid" | "inverse" | "bare";
}) {
  const glyph = (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={tone === "bare" ? className : "size-[62%]"}
      fill="currentColor"
      stroke="currentColor"
      strokeWidth="0"
    >
      {GLYPHS[axis]}
    </svg>
  );

  if (tone === "bare") return glyph;

  return (
    <span
      aria-hidden="true"
      className={`grid shrink-0 place-items-center ${
        tone === "inverse"
          ? "bg-paper-soft text-moss [--pictogram-ground:var(--color-paper-soft)]"
          : "bg-ink text-paper-soft [--pictogram-ground:var(--color-ink)]"
      } ${className}`}
    >
      {glyph}
    </span>
  );
}

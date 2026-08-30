/** Minimal inline icon set — 1.5px strokes, square caps, no decoration. */

export function ArrowRightIcon({ className = "size-4" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className={`${className} fill-none stroke-current`}
      strokeWidth="1.5"
    >
      <path d="M2.5 8h10M9 3.5 13.5 8 9 12.5" />
    </svg>
  );
}

export function CheckIcon({ className = "size-4" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className={`${className} fill-none stroke-current`}
      strokeWidth="1.75"
    >
      <path d="m3 8.5 3.2 3.2L13 5" />
    </svg>
  );
}

export function CloseIcon({ className = "size-4" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className={`${className} fill-none stroke-current`}
      strokeWidth="1.5"
    >
      <path d="m4 4 8 8M12 4l-8 8" />
    </svg>
  );
}

export function ChevronDownIcon({ className = "size-4" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className={`${className} fill-none stroke-current`}
      strokeWidth="1.5"
    >
      <path d="m4 6 4 4 4-4" />
    </svg>
  );
}

/** The destination marker: a vermilion survey nail, not a teardrop pin. */
export function DestinationMark({ className = "size-3" }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 12 12" className={className}>
      <rect x="2.2" y="2.2" width="7.6" height="7.6" transform="rotate(45 6 6)" fill="currentColor" />
    </svg>
  );
}

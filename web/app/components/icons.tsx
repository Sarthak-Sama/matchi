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

export function DestinationMark({ className = "size-3" }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 12 12" className={className}>
      <rect
        x="2.2"
        y="2.2"
        width="7.6"
        height="7.6"
        transform="rotate(45 6 6)"
        fill="currentColor"
      />
    </svg>
  );
}

export function ExternalLinkIcon({ className = "size-4" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className={`${className} fill-none stroke-current`}
      strokeWidth="1.5"
    >
      <path d="M6 3.5H3.5v9h9V10M8.5 3.5h4v4M12.25 3.75 7 9" />
    </svg>
  );
}

export function MapPinIcon({ className = "size-4" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className={`${className} fill-none stroke-current`}
      strokeWidth="1.5"
    >
      <path d="M13 6.5c0 3.4-5 7-5 7s-5-3.6-5-7a5 5 0 0 1 10 0Z" />
      <circle cx="8" cy="6.5" r="1.5" />
    </svg>
  );
}

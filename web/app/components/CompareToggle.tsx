"use client";

export function CompareToggle({
  checked,
  disabled,
  onChange,
  name,
  showLabel = false,
}: {
  readonly checked: boolean;
  readonly disabled: boolean;
  readonly onChange: (checked: boolean) => void;

  readonly name: string;

  readonly showLabel?: boolean;
}) {
  return (
    <label
      className={`flex min-h-11 min-w-11 items-center justify-center gap-2 px-2 text-[11px] font-semibold tracking-[0.14em] uppercase transition-colors ${
        disabled && !checked
          ? "cursor-not-allowed text-stone"
          : "cursor-pointer text-ink-muted hover:text-ink"
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled && !checked}
        onChange={(event) => onChange(event.target.checked)}
        className="peer sr-only"
      />
      <span
        aria-hidden="true"
        className={`grid size-4 shrink-0 place-items-center border transition-colors peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-vermilion-deep ${
          checked ? "border-moss bg-moss text-white" : "border-line-strong bg-paper-soft"
        }`}
      >
        {checked && (
          <svg viewBox="0 0 16 16" className="size-3 fill-none stroke-current" strokeWidth="2.5">
            <path d="m3 8.5 3.2 3.2L13 5" />
          </svg>
        )}
      </span>
      {showLabel && <span className="hidden sm:inline">Compare</span>}
      <span className="sr-only">Compare {name}</span>
    </label>
  );
}

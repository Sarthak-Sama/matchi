"use client";

import { useId } from "react";

interface SegmentedControlProps<T extends string> {
  readonly legend: string;
  readonly value: T;
  readonly options: readonly { readonly value: T; readonly label: string }[];
  readonly onChange: (value: T) => void;
  readonly wideColumns?: 4 | 7;
  readonly className?: string;
}

export function SegmentedControl<T extends string>({
  legend,
  value,
  options,
  onChange,
  wideColumns = 4,
  className = "",
}: SegmentedControlProps<T>) {
  const name = useId();
  const gridColumns =
    wideColumns === 7
      ? "grid-cols-2 min-[480px]:grid-cols-4 min-[700px]:grid-cols-7"
      : "grid-cols-2 min-[480px]:grid-cols-4";

  return (
    <div
      role="radiogroup"
      aria-label={legend}
      className={`grid w-full gap-px bg-line-strong p-px ${gridColumns} ${className}`}
    >
      {options.map((option, index) => (
        <label
          key={option.value}
          className={`relative min-w-0 bg-paper-soft ${
            wideColumns === 7 && options.length === 7 && index === options.length - 1
              ? "col-span-2 min-[700px]:col-span-1"
              : ""
          }`}
        >
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={value === option.value}
            onChange={() => onChange(option.value)}
            className="peer sr-only"
          />
          <span className="flex min-h-11 h-full cursor-pointer items-center justify-center px-2 text-center text-[13px] leading-tight font-medium transition-colors peer-checked:bg-moss peer-checked:text-white peer-focus-visible:outline-2 peer-focus-visible:-outline-offset-2 peer-focus-visible:outline-vermilion-deep hover:bg-sage/70 peer-checked:hover:bg-moss">
            {option.label}
          </span>
        </label>
      ))}
    </div>
  );
}

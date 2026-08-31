"use client";

import { useId } from "react";

interface SegmentedControlProps<T extends string> {
  readonly legend: string;
  readonly value: T;
  readonly options: readonly { readonly value: T; readonly label: string }[];
  readonly onChange: (value: T) => void;
  readonly className?: string;
}

export function SegmentedControl<T extends string>({
  legend,
  value,
  options,
  onChange,
  className = "",
}: SegmentedControlProps<T>) {
  const name = useId();

  return (
    <div
      role="radiogroup"
      aria-label={legend}
      className={`inline-flex max-w-full flex-wrap divide-x divide-line border border-line-strong ${className}`}
    >
      {options.map((option) => (
        <label key={option.value} className="relative">
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={value === option.value}
            onChange={() => onChange(option.value)}
            className="peer sr-only"
          />
          <span className="flex min-h-11 cursor-pointer items-center px-3.5 text-[13px] font-medium whitespace-nowrap transition-colors peer-checked:bg-moss peer-checked:text-white peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-vermilion-deep hover:bg-sage/70 peer-checked:hover:bg-moss">
            {option.label}
          </span>
        </label>
      ))}
    </div>
  );
}

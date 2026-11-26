"use client";
import { yen } from "../lib/format";
import { btn } from "./ui";
import type { ExcludedSummary, RelaxOption } from "../lib/types";

const EXCLUDED_LABELS: Record<keyof ExcludedSummary, string> = {
  nullRent: "No rent data",
  nullLifestyle: "Missing lifestyle data",
  missingAccess: "Missing access data",
  disconnected: "Cannot reach an anchor",
  overBudgetFirm: "Over the firm budget",
  overCommuteCapFirm: "Over the firm commute cap",
  uninhabited: "Almost no residents",
};

export function RelaxList({
  options,
  onApply,
  disabled,
}: {
  options: readonly RelaxOption[];
  onApply?: (option: RelaxOption) => void;
  disabled?: boolean;
}) {
  return (
    <ul className="mt-3 space-y-1 text-[13px]" data-testid="relax-list">
      {options.map((o) => (
        <li key={`${o.limit}-${o.step}`} className="tnum">
          {onApply ? (
            <button
              type="button"
              className={`${btn} w-full justify-between text-left`}
              disabled={disabled || o.areasGained === 0}
              onClick={() => onApply(o)}
              title={`Up to ${yen(o.yenGained)} a month gained${o.binding ? "; this is the limiting constraint" : ""}`}
            >
              <span>
                Allow up to {o.limit === "budget" ? yen(o.newValue) : `${o.newValue} min`}
              </span>
              <span>+{o.areasGained} areas</span>
            </button>
          ) : (
            <>
              {o.limit === "budget"
                ? `Budget up to ${yen(o.newValue)}`
                : `Commute cap up to ${o.newValue} min`}
              : {o.areasGained} more area{o.areasGained === 1 ? "" : "s"}, up to {yen(o.yenGained)}
              /mo gained
              {o.binding ? " (this limit is binding)" : ""}
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

export function Excluded({ excluded }: { excluded: ExcludedSummary }) {
  const keys = (Object.keys(EXCLUDED_LABELS) as (keyof ExcludedSummary)[]).sort(
    (a, b) => excluded[b] - excluded[a],
  );
  const total = keys.reduce((n, k) => n + excluded[k], 0);
  return (
    <div data-testid="excluded" className="mt-2">
      <p className="label-utility text-[10px] text-ink-muted">
        Left out of the search <span className="tnum">({total} areas)</span>
      </p>
      <ul className="tnum mt-1 grid grid-cols-1 gap-x-4 text-[12px] sm:grid-cols-2">
        {keys.map((k) => (
          <li
            key={k}
            className={`flex justify-between border-b border-line/60 py-0.5 ${excluded[k] === 0 ? "opacity-50" : ""}`}
          >
            <span>{EXCLUDED_LABELS[k]}</span>
            <span className="font-medium">{excluded[k]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

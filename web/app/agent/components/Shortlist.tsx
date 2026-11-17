"use client";
import { yen } from "../lib/format";
import type { ExcludedSummary, RelaxOption } from "../lib/types";

const EXCLUDED_LABELS: Record<keyof ExcludedSummary, string> = {
  nullRent: "No rent data",
  nullLifestyle: "Missing lifestyle data",
  missingAccess: "Missing access data",
  disconnected: "Cannot reach an anchor",
  overBudgetFirm: "Over the firm budget",
  overCommuteCapFirm: "Over the firm commute cap",
};

export function RelaxList({ options }: { options: readonly RelaxOption[] }) {
  return (
    <ul className="mt-3 space-y-1 text-[13px]" data-testid="relax-list">
      {options.map((o) => (
        <li key={`${o.limit}-${o.step}`} className="tnum">
          {o.limit === "budget" ? `Budget up to ${yen(o.newValue)}` : `Commute cap up to ${o.newValue} min`}:{" "}
          {o.areasGained} more area{o.areasGained === 1 ? "" : "s"}, up to {yen(o.yenGained)}/mo gained
          {o.binding ? " (this limit is binding)" : ""}
        </li>
      ))}
    </ul>
  );
}

export function Excluded({ excluded }: { excluded: ExcludedSummary }) {
  const keys = (Object.keys(EXCLUDED_LABELS) as (keyof ExcludedSummary)[]).sort((a,b)=>excluded[b]-excluded[a]);
  const total = keys.reduce((n, k) => n + excluded[k], 0);
  return (
    <div data-testid="excluded" className="mt-2">
      <p className="label-utility text-[10px] text-ink-muted">
        Left out of the search <span className="tnum">({total} areas)</span>
      </p>
      <ul className="tnum mt-1 grid grid-cols-1 gap-x-4 text-[12px] sm:grid-cols-2">
        {keys.map((k) => (
          <li key={k} className={`flex justify-between border-b border-line/60 py-0.5 ${excluded[k]===0?"opacity-50":""}`}>
            <span>{EXCLUDED_LABELS[k]}</span>
            <span className="font-medium">{excluded[k]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

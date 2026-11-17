"use client";

import { percent } from "../lib/format";
import { PARAM_LABELS, type BeliefSummary, type ParamSummary } from "../lib/types";
import { panel } from "./ui";

/** Bars read from BeliefSummary only: median with the 10th to 90th percentile range. */
export function BeliefPanel({ belief }: { belief: BeliefSummary | null }) {
  if (!belief) {
    return (
      <section aria-label="What the guide believes about you" className={panel}>
        <h2 className="label-utility text-ink">What I think matters to you</h2>
        <p className="mt-2 text-[14px] text-ink-muted">Waiting for a session.</p>
      </section>
    );
  }

  const shared = belief.params.filter((p) => p.shareOfBudget !== null);
  const other = belief.params.filter((p) => p.shareOfBudget === null);
  const lo = Math.min(0, ...shared.map((p) => p.shareOfBudget!.p10));
  const hi = Math.max(0, ...shared.map((p) => p.shareOfBudget!.p90));
  const span = hi - lo || 1;
  const pos = (v: number) => `${((v - lo) / span) * 100}%`;

  return (
    <section aria-label="What the guide believes about you" className={panel}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="label-utility text-ink">What I think matters to you</h2>
        <p className="tnum text-[12px] text-ink-muted">effective sample {Math.round(belief.ess)}</p>
      </div>
      <p className="mt-1 text-[12px] text-ink-muted">
        Each bar is the median weight as a share of your monthly scale; the thin line is the 10th to 90th percentile.
        A narrower line means the guide is surer.
      </p>
      {belief.lowConfidence && (
        <p className="mt-2 border border-line bg-warning/60 px-2 py-1 text-[12px]" role="status">
          Low confidence: the evidence has thinned the sample a lot, so these ranges are rough.
        </p>
      )}
      <ul className="mt-3 space-y-1.5" data-testid="belief-bars">
        {shared.map((p) => (
          <Bar key={p.param} p={p} pos={pos} zero={(0 - lo) / span} />
        ))}
      </ul>
      {other.length > 0 && (
        <dl className="tnum mt-3 grid grid-cols-1 gap-x-4 text-[12px] sm:grid-cols-2">
          {other.map((p) => (
            <div key={p.param} className="flex justify-between border-b border-line/60 py-0.5">
              <dt>{PARAM_LABELS[p.param]}</dt>
              <dd className="font-medium">
                {p.median.toFixed(2)} ({p.p10.toFixed(2)} to {p.p90.toFixed(2)})
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

function Bar({ p, pos, zero }: { p: ParamSummary; pos: (v: number) => string; zero: number }) {
  const s = p.shareOfBudget!;
  const left = Math.min(s.median, 0);
  const right = Math.max(s.median, 0);
  return (
    <li className="grid grid-cols-[9rem_1fr_3.5rem] items-center gap-2 text-[12px]">
      <span className="truncate">{PARAM_LABELS[p.param]}</span>
      <span
        className="relative h-3 bg-sage/60"
        role="img"
        aria-label={`${PARAM_LABELS[p.param]}: median ${percent(s.median, 1)}, 10th to 90th percentile ${percent(s.p10, 1)} to ${percent(s.p90, 1)}`}
      >
        <span
          className="absolute top-0 h-3 bg-moss/80"
          style={{ left: pos(left), width: `calc(${pos(right)} - ${pos(left)})` }}
        />
        <span className="absolute top-[5px] h-px bg-ink/70" style={{ left: pos(s.p10), width: `calc(${pos(s.p90)} - ${pos(s.p10)})` }} />
        <span className="absolute top-0 h-3 w-px bg-ink/40" style={{ left: `${zero * 100}%` }} />
      </span>
      <span className="tnum text-right">{percent(s.median, 1)}</span>
    </li>
  );
}

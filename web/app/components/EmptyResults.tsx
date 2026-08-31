import type { OptimizeResponse } from "@tokyo/shared";

/**
 * The no-results state — an actionable editorial response, not a dead
 * end. Names what excluded the candidates (from the API's own
 * diagnostics) and suggests the most effective adjustment first.
 */
export function EmptyResults({
  response,
  headingRef,
}: {
  readonly response: OptimizeResponse;
  readonly headingRef: React.RefObject<HTMLHeadingElement | null>;
}) {
  const { diagnostics } = response;

  // Order the adjustments by what actually excluded the most candidates.
  const adjustments: string[] = [];
  const rentTip = "Raise the monthly budget, or try a smaller layout.";
  const commuteTip = "Increase the maximum commute — even 10 minutes opens new ground.";
  const rentFirst = diagnostics.excludedByRent >= diagnostics.excludedByCommute;
  if (rentFirst && diagnostics.excludedByRent > 0) adjustments.push(rentTip);
  if (diagnostics.excludedByCommute > 0) adjustments.push(commuteTip);
  if (!rentFirst && diagnostics.excludedByRent > 0) adjustments.push(rentTip);
  adjustments.push("Lower an “Essential” priority to “High” so more areas can qualify.");

  return (
    <section aria-labelledby="results-heading" className="mt-14">
      <div className="border-t-2 border-ink pt-5">
        <p className="label-utility text-vermilion-deep">The shortlist</p>
        <h2
          id="results-heading"
          ref={headingRef}
          tabIndex={-1}
          className="mt-2 max-w-2xl font-serif text-3xl leading-tight font-medium tracking-editorial text-balance outline-none sm:text-4xl"
        >
          No neighborhood meets every limit yet
        </h2>
        <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-ink-muted">
          {diagnostics.suggestion ??
            "Every candidate was excluded by at least one of your limits. The most effective adjustment is usually one of these:"}
        </p>
      </div>

      <div className="mt-6 max-w-2xl border border-line-strong bg-paper-soft px-5 py-5">
        <p className="label-utility text-[10px] text-ink">Widening the search</p>
        <ul className="mt-3 space-y-2.5">
          {adjustments.slice(0, 3).map((adjustment) => (
            <li key={adjustment} className="flex gap-3 text-[14px] leading-relaxed">
              <span aria-hidden="true" className="text-vermilion-deep">
                →
              </span>
              {adjustment}
            </li>
          ))}
        </ul>
        <p className="mt-4 border-t border-line pt-3 text-[12px] leading-relaxed text-ink-muted">
          Considered {diagnostics.candidatesConsidered.toLocaleString()} candidate areas — excluded{" "}
          {diagnostics.excludedByRent.toLocaleString()} by rent,{" "}
          {diagnostics.excludedByCommute.toLocaleString()} by commute,{" "}
          {diagnostics.excludedByDisconnected.toLocaleString()} as disconnected from the
          destination.
        </p>
      </div>
    </section>
  );
}

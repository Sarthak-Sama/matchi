import type { OptimizeResponse } from "@tokyo/shared";
import { IMPORTANCE_VALUES, OSM_ATTRIBUTION, OVERALL_WEIGHTS } from "@tokyo/shared";

import { formatSourceDate } from "../../lib/format";

export function MethodologyFooter({ response }: { readonly response: OptimizeResponse | null }) {
  return (
    <footer id="methodology" className="mt-20 border-t border-line-strong">
      <div className="mx-auto grid max-w-[1360px] gap-10 px-5 py-10 sm:px-8 lg:grid-cols-[1.2fr_1fr]">
        <div>
          <p className="label-utility text-vermilion-deep">How it works</p>
          <h2 className="mt-2 font-serif text-2xl font-medium tracking-editorial">
            A guide, not a listing feed
          </h2>
          <p className="mt-3 max-w-xl text-[14px] leading-relaxed text-ink-muted">
            Every figure on this page is a model: rent is an area estimate from public statistics,
            commute time is a typical weekday estimate from transit topology, and lifestyle scores
            come from open map data. Nothing here is a live listing, a timetable promise, or a
            substitute for walking the streets yourself.
          </p>
          <dl className="mt-5 space-y-2 text-[13px] leading-relaxed">
            <div className="flex gap-3">
              <dt className="w-36 shrink-0 text-ink-muted">Score weights</dt>
              <dd>
                Affordability {OVERALL_WEIGHTS.affordability * 100}% · Commute{" "}
                {OVERALL_WEIGHTS.commute * 100}% · Lifestyle {OVERALL_WEIGHTS.lifestyle * 100}%
              </dd>
            </div>
            <div className="flex gap-3">
              <dt className="w-36 shrink-0 text-ink-muted">Priority weights</dt>
              <dd>
                Low {IMPORTANCE_VALUES.low}× · Medium {IMPORTANCE_VALUES.medium}× · High{" "}
                {IMPORTANCE_VALUES.high}× · Essential {IMPORTANCE_VALUES.essential}×
              </dd>
            </div>
          </dl>
        </div>

        <div>
          {response && response.dataVintages.length > 0 && (
            <>
              <p className="label-utility text-[10px] text-ink">Data vintages</p>
              <ul className="mt-3 space-y-1.5 text-[12px] leading-relaxed text-ink-muted">
                {response.dataVintages.map((vintage) => (
                  <li key={vintage.source} className="flex justify-between gap-4">
                    <span className="font-mono">{vintage.source}</span>
                    <span>
                      source {formatSourceDate(vintage.sourceUpdatedAt)} · imported{" "}
                      {formatSourceDate(vintage.importedAt)}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="mt-5 border-t border-line pt-4 text-[12px] text-ink-muted">
            {OSM_ATTRIBUTION} · MLIT real-estate and land-price data · e-Stat official statistics ·
            ODPT transit data
          </p>
        </div>
      </div>
    </footer>
  );
}

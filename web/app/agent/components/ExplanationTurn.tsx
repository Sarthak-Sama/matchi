"use client";
import { comparisonRows, describeWhyNot } from "../lib/explain";
import { friendlyText } from "../lib/derive";
import type { NameOf } from "../lib/evidence";
import { percent, yenSigned } from "../lib/format";
import { termLabel } from "../lib/types";
import type { Explanation } from "../lib/useAgent";
import { RelaxList } from "./Shortlist";
export function ExplanationBody({ ex, names }: { ex: Explanation; names: NameOf }) {
  return (
    <div data-testid="explanation">
      {ex.kind === "why_not" && <p>{friendlyText(describeWhyNot(ex.result, names))}</p>}
      {ex.kind === "relax" &&
        (ex.result.length ? (
          <RelaxList options={ex.result} />
        ) : (
          <p>Changing a limit would not add any areas.</p>
        ))}
      {ex.kind === "compare" && (
        <>
          <p>
            {names(ex.result.a)} comes ahead of {names(ex.result.b)} in{" "}
            {percent(ex.result.pABeatsB)} of the possibilities I checked.
          </p>
          <ul className="mt-3 space-y-2 font-sans text-xs">
            {comparisonRows(ex.result).map((row) => (
              <li key={row.term} className="flex justify-between gap-4 border-b border-line pb-1">
                <span>{termLabel(row.term)}</span>
                <span className="tnum">{yenSigned(row.value)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 font-sans text-xs text-ink-muted">
            Monthly difference: {names(ex.result.a)} compared with {names(ex.result.b)}.
          </p>
        </>
      )}
    </div>
  );
}

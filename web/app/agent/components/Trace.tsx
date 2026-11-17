"use client";

import type { TraceEntry } from "../lib/trace";

const TONE: Record<TraceEntry["tone"], string> = {
  neutral: "border-line-strong",
  ok: "border-moss",
  bad: "border-brick bg-warning/40",
};

export function Trace({ entries }: { entries: readonly TraceEntry[] }) {
  return (
    <section aria-label="Trace" className="py-3" data-testid="trace">
      <h2 className="label-utility text-ink">Trace</h2>
      {entries.length === 0 ? (
        <p className="mt-2 text-[14px] text-ink-muted">
          Tool calls, engine calls and the grounding check show here.
        </p>
      ) : (
        <ol className="mt-2 max-h-96 space-y-1 overflow-y-auto font-mono text-[11px]">
          {[...entries].reverse().map((e) => (
            <li key={e.id} className={`border-l-2 pl-2 ${TONE[e.tone]}`}>
              <details>
                <summary className={`cursor-pointer ${e.detail === undefined ? "list-none" : ""}`}>
                  <span className="text-stone">{new Date(e.at).toLocaleTimeString("en-GB")}</span>{" "}
                  <span className="text-ink-muted">[{e.source}]</span> {e.summary}
                </summary>
                {e.detail !== undefined && (
                  <pre className="mt-1 max-h-48 overflow-auto bg-paper p-2 whitespace-pre-wrap">
                    {JSON.stringify(e.detail, null, 2)}
                  </pre>
                )}
              </details>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

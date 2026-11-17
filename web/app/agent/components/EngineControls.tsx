"use client";

import { useState } from "react";

import { cheaper, closer, featureDirection, makeNameOf, quieter } from "../lib/evidence";
import { comparisonRows, describeWhyNot } from "../lib/explain";
import { percent, yenSigned } from "../lib/format";
import type { AgentController } from "../lib/useAgent";
import { FEATURE_KEY_LIST, FEATURE_LABELS, termLabel, type FeatureKey, type Strength } from "../lib/types";
import { RelaxList } from "./Shortlist";
import { btn, panel } from "./ui";

/** Engine-only controls: they call the direct routes, no model involved. */
export function EngineControls({ agent }: { agent: AgentController }) {
  const [strength, setStrength] = useState<Strength>("normal");
  const [feature, setFeature] = useState<FeatureKey>("green_space");
  const [whyId, setWhyId] = useState("");
  const [cmpA, setCmpA] = useState("");
  const [cmpB, setCmpB] = useState("");
  const list = agent.view?.recommendation?.shortlist ?? [];
  const names = makeNameOf(list);
  const off = agent.busy || !agent.sessionId;
  const ex = agent.explanation;

  return (
    <section aria-label="Quick answers" className={panel}>
      <h2 className="label-utility text-ink">Quick answers (no model)</h2>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" disabled={off} className={btn} onClick={() => void agent.addEvidence([quieter(strength)])}>
          Quieter
        </button>
        <button type="button" disabled={off} className={btn} onClick={() => void agent.addEvidence([cheaper(strength)])}>
          Cheaper
        </button>
        <button type="button" disabled={off} className={btn} onClick={() => void agent.addEvidence([closer(strength)])}>
          Closer
        </button>
        <label className="ml-auto flex items-center gap-1.5 text-[12px]">
          Strength
          <select value={strength} onChange={(e) => setStrength(e.target.value as Strength)} className="field-control min-h-8 px-1.5 text-[12px]">
            <option value="weak">weak</option>
            <option value="normal">normal</option>
            <option value="strong">strong</option>
          </select>
        </label>
      </div>
      <p className="mt-1 text-[11px] text-ink-muted">
        Cheaper and closer answer one question: would you pay ¥10,000 a month to save 10 minutes each way?
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select aria-label="Feature" value={feature} onChange={(e) => setFeature(e.target.value as FeatureKey)} className="field-control min-h-8 px-1.5 text-[12px]">
          {FEATURE_KEY_LIST.map((k) => (
            <option key={k} value={k}>
              {FEATURE_LABELS[k]}
            </option>
          ))}
        </select>
        <button type="button" disabled={off} className={btn} onClick={() => void agent.addEvidence([featureDirection(feature, 1, strength)])}>
          More
        </button>
        <button type="button" disabled={off} className={btn} onClick={() => void agent.addEvidence([featureDirection(feature, -1, strength)])}>
          Less
        </button>
      </div>

      <form
        className="mt-3 flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (whyId.trim()) void agent.whyNot(whyId.trim());
        }}
      >
        <input aria-label="Locality id for why-not" value={whyId} onChange={(e) => setWhyId(e.target.value)} placeholder="Locality id" className="field-control min-h-8 w-40 px-2 text-[12px]" />
        <button type="submit" disabled={off || whyId.trim() === ""} className={btn}>
          Why not this area?
        </button>
      </form>

      <form
        className="mt-2 flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (cmpA && cmpB && cmpA !== cmpB) void agent.compare(cmpA, cmpB);
        }}
      >
        <select aria-label="Compare first area" value={cmpA} onChange={(e) => setCmpA(e.target.value)} className="field-control min-h-8 max-w-36 px-1.5 text-[12px]">
          <option value="">First area</option>
          {list.map((s) => (
            <option key={s.localityId} value={s.localityId}>
              {names(s.localityId)}
            </option>
          ))}
        </select>
        <select aria-label="Compare second area" value={cmpB} onChange={(e) => setCmpB(e.target.value)} className="field-control min-h-8 max-w-36 px-1.5 text-[12px]">
          <option value="">Second area</option>
          {list.map((s) => (
            <option key={s.localityId} value={s.localityId}>
              {names(s.localityId)}
            </option>
          ))}
        </select>
        <button type="submit" disabled={off || !cmpA || !cmpB || cmpA === cmpB} className={btn}>
          Compare
        </button>
      </form>

      {ex && (
        <div className="mt-3 border border-line bg-paper p-3 text-[13px]" data-testid="explanation" aria-live="polite">
          {ex.kind === "why_not" && <p>{describeWhyNot(ex.result, names)}</p>}
          {ex.kind === "relax" &&
            (ex.result.length === 0 ? <p>Relaxing a limit would not add areas.</p> : <RelaxList options={ex.result} />)}
          {ex.kind === "compare" && (
            <div>
              <p>
                {names(ex.result.a)} beats {names(ex.result.b)} in about{" "}
                <span className="tnum font-medium">{percent(ex.result.pABeatsB)}</span> of plausible versions of you.
              </p>
              <ul className="tnum mt-1 space-y-0.5 text-[12px]">
                {comparisonRows(ex.result).map((r) => (
                  <li key={r.term} className="flex justify-between">
                    <span>{termLabel(r.term)}</span>
                    <span>{yenSigned(r.value)}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-[11px] text-ink-muted">Yen per month, {names(ex.result.a)} minus {names(ex.result.b)}.</p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

"use client";

import { useState } from "react";

import { answersFor, areaName, dislikeArea, likeArea, makeNameOf, preferOverNeighbour } from "../lib/evidence";
import { percent, yen, yenSigned } from "../lib/format";
import type { AgentController } from "../lib/useAgent";
import {
  FEATURE_KEY_LIST,
  PARAM_LABELS,
  termLabel,
  type AreaConfidence,
  type BreakdownTerm,
  type ExcludedSummary,
  type Recommendation,
  type RelaxOption,
  type ShortlistItem,
} from "../lib/types";
import { btn, panel } from "./ui";

const EXCLUDED_LABELS: Record<keyof ExcludedSummary, string> = {
  nullRent: "No rent data",
  nullLifestyle: "Missing lifestyle data",
  missingAccess: "Missing access data",
  disconnected: "Cannot reach an anchor",
  overBudgetFirm: "Over the firm budget",
  overCommuteCapFirm: "Over the firm commute cap",
};

function confidenceLabels(c: AreaConfidence): string[] {
  const out: string[] = [];
  out.push(
    c.rent === "near_price_point"
      ? "Rent: near a price point"
      : c.rent === "distant_price_point"
        ? "Rent: distant price point"
        : "Rent: modelled at ward level",
  );
  if (c.access) out.push(`Access data: ${c.access}`);
  out.push(`Commute estimate ± ${c.commuteBandMinutes} min`);
  if (c.lateReturnNotCovered) out.push("Last trains not covered");
  return out;
}

function breakdownRows(item: ShortlistItem): { term: BreakdownTerm; value: number }[] {
  const b = item.breakdown;
  const rows: { term: BreakdownTerm; value: number }[] = [
    { term: "rent", value: b.rent },
    { term: "timeCost", value: b.timeCost },
    { term: "budgetPenalty", value: b.budgetPenalty },
    { term: "capPenalty", value: b.capPenalty },
    ...FEATURE_KEY_LIST.map((k) => ({ term: k as BreakdownTerm, value: b.features[k] })),
  ];
  return rows.filter((r) => Math.round(r.value) !== 0).sort((a, c) => Math.abs(c.value) - Math.abs(a.value));
}

function ShortlistCard({
  item,
  index,
  list,
  agent,
}: {
  item: ShortlistItem;
  index: number;
  list: readonly ShortlistItem[];
  agent: AgentController;
}) {
  const [open, setOpen] = useState(false);
  const rows = breakdownRows(item);
  const shown = open ? rows : rows.slice(0, 4);
  const maxAbs = Math.max(1, ...rows.map((r) => Math.abs(r.value)));
  const prefer = preferOverNeighbour(list, index);
  const disabled = agent.busy;

  return (
    <li className="border border-line-strong bg-paper-soft p-4" data-testid="shortlist-card">
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <p className="label-utility text-[10px] text-ink-muted">#{index + 1}</p>
          <h3 className="font-serif text-xl leading-tight font-medium">{areaName(item)}</h3>
          <p className="text-[12px] text-ink-muted">
            <span lang="ja">{item.nameJa}</span>
            {item.wardNameEn ? ` · ${item.wardNameEn}` : ""}
          </p>
        </div>
        <div className="text-right">
          <p className="tnum font-serif text-3xl leading-none font-medium text-moss">{percent(item.pBest)}</p>
          <p className="label-utility mt-1 text-[10px] text-ink-muted">chance of being best</p>
        </div>
      </div>

      <dl className="tnum mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[13px] sm:grid-cols-4">
        <div>
          <dt className="text-ink-muted">Rent (modelled)</dt>
          <dd className="font-medium">{yen(item.rentYen)}/mo</dd>
        </div>
        <div>
          <dt className="text-ink-muted">Commute</dt>
          <dd className="font-medium">
            {item.commuteMinutes === null ? "no anchor" : `${Math.round(item.commuteMinutes)} min`}
          </dd>
        </div>
        <div>
          <dt className="text-ink-muted">Travel</dt>
          <dd className="font-medium">{item.monthlyTravelHours.toFixed(1)} h/mo</dd>
        </div>
        <div>
          <dt className="text-ink-muted">Regret if wrong</dt>
          <dd className="font-medium">{yen(item.regretYen)}/mo</dd>
        </div>
      </dl>

      {item.role && (
        <p className="mt-2 text-[13px]">
          <span className="label-utility text-[10px] text-vermilion-deep">Role</span> Best if you care{" "}
          {item.role.direction === "higher" ? "more" : "less"} about{" "}
          <span className="font-medium">{PARAM_LABELS[item.role.param].toLowerCase()}</span>
        </p>
      )}

      <div className="mt-3">
        <p className="label-utility text-[10px] text-ink-muted">Yen per month, at your likely values</p>
        <ul className="mt-1 space-y-1">
          {shown.map((r) => (
            <li key={r.term} className="grid grid-cols-[8.5rem_1fr_5rem] items-center gap-2 text-[12px]">
              <span className="truncate">{termLabel(r.term)}</span>
              <span className="relative h-2 bg-sage/60" aria-hidden>
                <span
                  className={`absolute top-0 h-2 ${r.value < 0 ? "right-1/2 bg-brick/70" : "left-1/2 bg-moss"}`}
                  style={{ width: `${(Math.abs(r.value) / maxAbs) * 50}%` }}
                />
                <span className="absolute top-0 left-1/2 h-2 w-px bg-ink/40" />
              </span>
              <span className="tnum text-right">{yenSigned(r.value)}</span>
            </li>
          ))}
        </ul>
        <div className="mt-1 flex items-center justify-between text-[12px]">
          <button type="button" onClick={() => setOpen((o) => !o)} className="text-ink-muted underline underline-offset-2">
            {open ? "Fewer terms" : `All ${rows.length} terms`}
          </button>
          <span className="tnum font-medium">Total {yenSigned(item.breakdown.total)}</span>
        </div>
      </div>

      <ul className="mt-3 flex flex-wrap gap-1.5">
        {confidenceLabels(item.confidence).map((l) => (
          <li key={l} className="border border-line bg-paper px-1.5 py-0.5 text-[11px] text-ink-muted">
            {l}
          </li>
        ))}
        {item.similarNearby && item.similarNearby.length > 0 && (
          <li className="border border-line bg-paper px-1.5 py-0.5 text-[11px] text-ink-muted">
            {item.similarNearby.length} similar nearby
          </li>
        )}
      </ul>

      <div className="mt-3 flex flex-wrap gap-2">
        {prefer && (
          <button type="button" disabled={disabled} className={btn} onClick={() => void agent.addEvidence([prefer])}>
            Prefer this
          </button>
        )}
        <button type="button" disabled={disabled} className={btn} onClick={() => void agent.addEvidence([likeArea(item)])}>
          Like
        </button>
        <button type="button" disabled={disabled} className={btn} onClick={() => void agent.addEvidence([dislikeArea(item)])}>
          Not this
        </button>
        <button type="button" disabled={disabled} className={btn} onClick={() => void agent.whyNot(item.localityId)}>
          Why not top pick?
        </button>
      </div>
    </li>
  );
}

export function Shortlist({ agent }: { agent: AgentController }) {
  const rec: Recommendation | null = agent.view?.recommendation ?? null;
  const names = makeNameOf(rec?.shortlist ?? []);

  if (!rec) {
    return (
      <section aria-label="Shortlist" className={panel}>
        <h2 className="label-utility text-ink">Shortlist</h2>
        <p className="mt-2 text-[14px] text-ink-muted">
          No shortlist yet. Set a profile (an anchor, a budget or a commute cap, a layout) and it appears here.
        </p>
        {agent.view?.excluded && <Excluded excluded={agent.view.excluded} />}
      </section>
    );
  }

  const question = rec.nextQuestion;
  const answers = question ? answersFor(question, names) : [];

  return (
    <section aria-label="Shortlist" className="space-y-3">
      <div className={panel}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="label-utility text-ink">Shortlist</h2>
          <p className="tnum text-[12px] text-ink-muted">
            {rec.feasibleCount} feasible areas · effective sample {Math.round(rec.ess)}
          </p>
        </div>
        <p className="mt-2 text-[14px]" data-testid="risk-line">
          What I still don&rsquo;t know about you is worth about{" "}
          <span className="tnum font-semibold">{yen(rec.riskYen)}</span> a month.{" "}
          {rec.shouldStop
            ? rec.stopReason === "question_limit"
              ? "Stopping: the question limit is reached."
              : "Stopping: that is below the threshold."
            : "More answers would sharpen it."}
        </p>
        {question && question.kind === "profile_fact" && (
          <p className="mt-2 text-[13px] text-ink-muted">Next: tell me your {question.missing.replace("_", " ")}.</p>
        )}
        {question && answers.length > 0 && !rec.shouldStop && (
          <div className="mt-3">
            <p className="text-[13px]">
              {question.kind === "pair"
                ? `Which would you rather live in: ${names(question.a)} or ${names(question.b)}?`
                : "Which of these would you pick?"}
            </p>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {answers.map((a) => (
                <button
                  key={a.label}
                  type="button"
                  disabled={agent.busy}
                  className={btn}
                  onClick={() => void agent.addEvidence([a.evidence])}
                >
                  {a.label}
                </button>
              ))}
            </div>
          </div>
        )}
        {rec.alternative && (
          <p className="mt-2 text-[13px] text-ink-muted">
            If I&rsquo;m wrong about you:{" "}
            <span className="font-medium text-ink">{names(rec.alternative.localityId)}</span> wins for about{" "}
            <span className="tnum">{percent(rec.alternative.weight)}</span> of the plausible versions of you, when{" "}
            {PARAM_LABELS[rec.alternative.param].toLowerCase()} differs.
          </p>
        )}
        <div className="mt-3 flex gap-2">
          <button type="button" disabled={agent.busy} className={btn} onClick={() => void agent.recommend()}>
            Recompute shortlist
          </button>
          <button type="button" disabled={agent.busy} className={btn} onClick={() => void agent.relax()}>
            Relax limits
          </button>
        </div>
        {rec.relax && rec.relax.length > 0 && <RelaxList options={rec.relax} />}
      </div>

      {rec.shortlist.length === 0 ? (
        <p className="border border-line bg-warning/60 p-4 text-[14px]">
          No area passes every firm limit. See the exclusion counts below, and try &ldquo;Relax limits&rdquo;.
        </p>
      ) : (
        <ul className="space-y-3">
          {rec.shortlist.map((item, i) => (
            <ShortlistCard key={item.localityId} item={item} index={i} list={rec.shortlist} agent={agent} />
          ))}
        </ul>
      )}

      <div className="border border-line bg-paper-soft p-4">
        <Excluded excluded={rec.excluded} />
      </div>
    </section>
  );
}

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
  const keys = Object.keys(EXCLUDED_LABELS) as (keyof ExcludedSummary)[];
  const total = keys.reduce((n, k) => n + excluded[k], 0);
  return (
    <div data-testid="excluded" className="mt-2">
      <p className="label-utility text-[10px] text-ink-muted">
        Left out of the search <span className="tnum">({total} areas)</span>
      </p>
      <ul className="tnum mt-1 grid grid-cols-1 gap-x-4 text-[12px] sm:grid-cols-2">
        {keys.map((k) => (
          <li key={k} className="flex justify-between border-b border-line/60 py-0.5">
            <span>{EXCLUDED_LABELS[k]}</span>
            <span className="font-medium">{excluded[k]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

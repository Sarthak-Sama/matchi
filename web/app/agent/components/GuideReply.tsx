"use client";

import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";

import {
  numericColumns,
  parseInline,
  splitName,
  type Block,
  type Inline,
  type NumericColumn,
} from "../lib/markdown";

import { presentReply, type QuickChoice } from "../lib/reply";

// ---------- Inline ----------

// Figures in prose get tabular, slightly heavier ink so the eye can scan them.
const PROSE_FIGURE =
  /(?:¥\s*)?\d[\d,]*(?:\.\d+)?\s*(?:万円?|円|yen\b|minutes?\b|mins?\b|分|hours?\b|hrs?\b|時間|%|percent\b)/gi;

function withFigures(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;
  for (const m of text.matchAll(PROSE_FIGURE)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(
      <span key={`${key}-f${n++}`} className="tnum font-semibold whitespace-nowrap text-ink">
        {m[0]}
      </span>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function InlineNodes({ nodes, k = "i" }: { nodes: readonly Inline[]; k?: string }) {
  return (
    <>
      {nodes.map((node, i) => {
        const key = `${k}.${i}`;
        switch (node.kind) {
          case "text":
            return <Fragment key={key}>{withFigures(node.text, key)}</Fragment>;
          case "strong":
            return (
              <strong key={key} className="font-semibold text-ink">
                <InlineNodes nodes={node.children} k={key} />
              </strong>
            );
          case "em":
            return (
              <em key={key} className="font-serif text-[1.06em] italic">
                <InlineNodes nodes={node.children} k={key} />
              </em>
            );
          case "code":
            return (
              <code key={key} className="bg-sage/60 px-1 font-mono text-[0.86em]">
                {node.text}
              </code>
            );
        }
      })}
    </>
  );
}

// ---------- Tables: a comparison with inline magnitude bars ----------

const UNIT_LABEL: Record<NumericColumn["unit"], string> = {
  yen: "lowest",
  minutes: "shortest",
  hours: "fewest",
  percent: "highest",
};

function ComparisonTable({ table }: { table: Extract<Block, { kind: "table" }> }) {
  const numeric = useMemo(() => numericColumns(table), [table]);
  const byIndex = new Map(numeric.map((c) => [c.index, c]));

  return (
    <div className="-mx-1 overflow-x-auto px-1">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-ink/70">
            {table.header.map((h, c) => (
              <th
                key={c}
                scope="col"
                className={`label-utility pb-1.5 text-[10px] font-semibold text-ink-muted ${
                  c === 0 ? "pr-3 text-left" : byIndex.has(c) ? "px-2 text-right" : "px-2 text-left"
                }`}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, r) => {
            const lead = /^\s*\*\*.*\*\*\s*$/.test(row[0] ?? "");
            return (
              <tr
                key={r}
                className={`border-b border-line last:border-b-0 ${lead ? "bg-vermilion/[0.05]" : ""}`}
              >
                {row.map((cell, c) => {
                  if (c === 0) {
                    const [primary, secondary] = splitName(cell);
                    return (
                      <th
                        key={c}
                        scope="row"
                        className="relative py-2 pr-3 text-left align-top font-normal"
                      >
                        {lead && (
                          <span
                            aria-hidden
                            className="absolute top-2 bottom-2 -left-1 w-[2px] bg-vermilion"
                          />
                        )}
                        <span className="block font-serif text-[15px] leading-tight text-ink">
                          {primary}
                        </span>
                        {secondary && (
                          <span className="block text-[11px] leading-tight text-ink-muted">
                            {secondary}
                          </span>
                        )}
                        {lead && <span className="sr-only"> (leading)</span>}
                      </th>
                    );
                  }
                  const col = byIndex.get(c);
                  const value = col?.values[r] ?? null;
                  if (!col || value === null) {
                    return (
                      <td key={c} className="px-2 py-2 align-top text-ink-muted">
                        <InlineNodes nodes={parseInline(cell)} k={`c${r}.${c}`} />
                      </td>
                    );
                  }
                  const isBest = col.max !== col.min && value === col.best;
                  const width = col.max === 0 ? 0 : Math.max(6, (value / col.max) * 100);
                  return (
                    <td key={c} className="px-2 py-2 text-right align-top">
                      <span
                        className={`tnum whitespace-nowrap ${isBest ? "font-semibold text-moss" : "text-ink"}`}
                      >
                        {cell.replace(/\*\*/g, "")}
                      </span>
                      <span
                        aria-hidden
                        className="mt-1 ml-auto block h-[3px] w-full max-w-24 bg-line/70"
                      >
                        <span
                          className={`ml-auto block h-full ${isBest ? "bg-moss" : "bg-stone"}`}
                          style={{ width: `${width}%` }}
                        />
                      </span>
                      {isBest && <span className="sr-only"> ({UNIT_LABEL[col.unit]})</span>}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------- Trade-off plot: rent against time ----------

const H = 196;
const PAD = { l: 12, r: 12, t: 22, b: 30 };
const LABEL_SIZE = 12;

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const overlaps = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/** Rough rendered width: CJK glyphs are a full em, Latin about 0.56 em. */
function textWidth(s: string, size: number): number {
  let w = 0;
  for (const ch of s) w += /[\u3000-\u9fff\uff00-\uffef]/.test(ch) ? size : size * 0.56;
  return w;
}

type Placed = { x: number; y: number; anchor: "start" | "end" } | null;

/** Greedy label placement: try eight spots around each point, skip the label if none is free. */
function placeLabels(points: { cx: number; cy: number; name: string }[], width: number): Placed[] {
  const taken: Box[] = points.map((p) => ({
    x0: p.cx - 5,
    y0: p.cy - 5,
    x1: p.cx + 5,
    y1: p.cy + 5,
  }));
  const offsets: [number, number, "start" | "end"][] = [
    [8, -6, "start"],
    [8, 13, "start"],
    [-8, -6, "end"],
    [-8, 13, "end"],
    [8, 4, "start"],
    [-8, 4, "end"],
    [0, -12, "start"],
    [0, 22, "start"],
  ];
  return points.map((p) => {
    const w = textWidth(p.name, LABEL_SIZE);
    for (const [dx, dy, anchor] of offsets) {
      const x = p.cx + dx - (dx === 0 ? w / 2 : 0);
      const y = p.cy + dy;
      const x0 = anchor === "start" ? x : x - w;
      const box = { x0: x0 - 1, y0: y - LABEL_SIZE + 1, x1: x0 + w + 1, y1: y + 3 };
      if (box.x0 < PAD.l + 2 || box.x1 > width - 2 || box.y0 < PAD.t - 4 || box.y1 > H - PAD.b - 2)
        continue;
      if (taken.some((t) => overlaps(t, box))) continue;
      taken.push(box);
      return { x, y, anchor };
    }
    return null;
  });
}

function useWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

function TradeoffPlot({ table }: { table: Extract<Block, { kind: "table" }> }) {
  const [ref, measured] = useWidth<HTMLDivElement>();
  const numeric = numericColumns(table);
  const rent = numeric.find((c) => c.unit === "yen");
  const time = numeric.find((c) => c.unit === "minutes");
  if (!rent || !time) return null;

  const points = table.rows
    .map((row, r) => ({
      name: splitName(row[0] ?? "")[0],
      lead: /^\s*\*\*.*\*\*\s*$/.test(row[0] ?? ""),
      x: time.values[r],
      y: rent.values[r],
    }))
    .filter(
      (p): p is { name: string; lead: boolean; x: number; y: number } =>
        p.x !== null && p.y !== null,
    );
  if (points.length < 3) return null;

  const W = Math.max(measured, 240);
  const span = (lo: number, hi: number) => {
    const pad = Math.max((hi - lo) * 0.12, hi * 0.03, 1);
    return [lo - pad, hi + pad] as const;
  };
  const [x0, x1] = span(time.min, time.max);
  const [y0, y1] = span(rent.min, rent.max);
  const sx = (v: number) => PAD.l + ((v - x0) / (x1 - x0)) * (W - PAD.l - PAD.r);
  const sy = (v: number) => H - PAD.b - ((v - y0) / (y1 - y0)) * (H - PAD.t - PAD.b);
  const midX = sx((time.min + time.max) / 2);
  const midY = sy((rent.min + rent.max) / 2);
  const timeLabel = table.header[time.index] ?? "Time";
  const rentLabel = table.header[rent.index] ?? "Rent";
  const fmtYen = (v: number) => `¥${Math.round(v / 1000)}k`;

  // Lead first, so it wins the best label spot.
  const ordered = [...points].sort((a, b) => Number(b.lead) - Number(a.lead));
  const placed =
    measured > 0
      ? placeLabels(
          ordered.map((p) => ({ cx: sx(p.x), cy: sy(p.y), name: p.name })),
          W,
        )
      : [];

  return (
    <figure className="mt-1">
      <figcaption className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className="label-utility text-[10px] text-ink-muted">The trade-off</span>
        <span className="flex items-center gap-1.5 text-[11px] text-ink-muted">
          <span aria-hidden className="inline-block h-2.5 w-2.5 bg-sage" />
          cheaper and closer
        </span>
      </figcaption>
      <div ref={ref} className="w-full">
        {measured > 0 && (
          <svg
            width={W}
            height={H}
            viewBox={`0 0 ${W} ${H}`}
            className="block"
            role="img"
            aria-label={`${rentLabel} against ${timeLabel}: ${points.map((p) => `${p.name} ${p.y} yen, ${p.x} min`).join("; ")}`}
          >
            <rect
              x={PAD.l}
              y={midY}
              width={midX - PAD.l}
              height={H - PAD.b - midY}
              fill="var(--color-sage)"
              opacity="0.6"
            />
            <line
              x1={midX}
              x2={midX}
              y1={PAD.t}
              y2={H - PAD.b}
              stroke="var(--color-line-strong)"
              strokeDasharray="2 3"
            />
            <line
              x1={PAD.l}
              x2={W - PAD.r}
              y1={midY}
              y2={midY}
              stroke="var(--color-line-strong)"
              strokeDasharray="2 3"
            />
            <line
              x1={PAD.l}
              x2={W - PAD.r}
              y1={H - PAD.b}
              y2={H - PAD.b}
              stroke="var(--color-ink)"
            />
            <line x1={PAD.l} x2={PAD.l} y1={PAD.t} y2={H - PAD.b} stroke="var(--color-ink)" />

            <g fontSize="10" fill="var(--color-ink-muted)" className="tnum">
              <text x={PAD.l} y={10} dominantBaseline="middle">
                ↑ {rentLabel} · {fmtYen(rent.min)}–{fmtYen(rent.max)}
              </text>
              <text x={PAD.l} y={H - 12}>
                {Math.round(time.min)} min
              </text>
              <text x={W / 2} y={H - 12} textAnchor="middle">
                {timeLabel} →
              </text>
              <text x={W - PAD.r} y={H - 12} textAnchor="end">
                {Math.round(time.max)} min
              </text>
            </g>

            {ordered.map((p, i) => {
              const cx = sx(p.x);
              const cy = sy(p.y);
              const label = placed[i];
              return (
                <g key={p.name}>
                  <title>{`${p.name}: ${p.y.toLocaleString("en")} yen, ${p.x} min`}</title>
                  {p.lead && (
                    <circle cx={cx} cy={cy} r="7.5" fill="none" stroke="var(--color-vermilion)" />
                  )}
                  <circle
                    cx={cx}
                    cy={cy}
                    r="3.5"
                    fill={p.lead ? "var(--color-vermilion)" : "var(--color-moss)"}
                    stroke="var(--color-paper-soft)"
                    strokeWidth="1.5"
                  />
                  {label && (
                    <text
                      x={label.x}
                      y={label.y}
                      fontSize={LABEL_SIZE}
                      textAnchor={label.anchor}
                      fill={p.lead ? "var(--color-vermilion-deep)" : "var(--color-ink)"}
                      style={{ fontFamily: "var(--font-serif)" }}
                      paintOrder="stroke"
                      stroke="var(--color-paper-soft)"
                      strokeWidth="3"
                      strokeLinejoin="round"
                    >
                      {p.name}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        )}
        {measured === 0 && <div style={{ height: H }} />}
      </div>
    </figure>
  );
}

// ---------- Blocks ----------

function BlockView({ block, index, headline }: { block: Block; index: number; headline: boolean }) {
  const k = `b${index}`;
  switch (block.kind) {
    case "heading":
      if (headline || block.level === 1) {
        return (
          <p className="font-serif text-[20px] leading-[1.25] font-medium tracking-[-0.01em] text-balance text-ink">
            <InlineNodes nodes={block.children} k={k} />
          </p>
        );
      }
      return (
        <h3 className="label-utility mt-1 flex items-center gap-2 text-[10px] text-vermilion-deep">
          <InlineNodes nodes={block.children} k={k} />
          <span aria-hidden className="h-px flex-1 bg-line" />
        </h3>
      );
    case "paragraph":
      if (headline) {
        return (
          <p className="font-serif text-[20px] leading-[1.25] font-medium tracking-[-0.01em] text-balance text-ink [&_strong]:font-medium">
            <InlineNodes nodes={block.children} k={k} />
          </p>
        );
      }
      return (
        <p className="text-[14.5px] leading-[1.6] text-ink/90">
          <InlineNodes nodes={block.children} k={k} />
        </p>
      );
    case "list":
      return block.ordered ? (
        <ol className="space-y-1.5 text-[14px] leading-[1.55] text-ink/90">
          {block.items.map((item, i) => (
            <li key={i} className="grid grid-cols-[1.5rem_1fr]">
              <span className="tnum font-serif text-[15px] text-vermilion-deep">{i + 1}</span>
              <span>
                <InlineNodes nodes={item} k={`${k}.${i}`} />
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <ul className="space-y-1.5 text-[14px] leading-[1.55] text-ink/90">
          {block.items.map((item, i) => (
            <li key={i} className="grid grid-cols-[1rem_1fr]">
              <span aria-hidden className="mt-[0.62em] block h-[5px] w-[5px] rotate-45 bg-moss" />
              <span>
                <InlineNodes nodes={item} k={`${k}.${i}`} />
              </span>
            </li>
          ))}
        </ul>
      );
    case "quote":
      return (
        <blockquote className="border-l-2 border-stone pl-3 text-[13.5px] leading-[1.55] text-ink-muted italic">
          <InlineNodes nodes={block.children} k={k} />
        </blockquote>
      );
    case "rule":
      return <hr className="border-line" />;
    case "table":
      return (
        <div className="space-y-3">
          <ComparisonTable table={block} />
          <TradeoffPlot table={block} />
        </div>
      );
  }
}

/** A headline is a leading heading, or a leading paragraph that is entirely bold. */
function isHeadline(block: Block | undefined): boolean {
  if (!block) return false;
  if (block.kind === "heading") return true;
  return (
    block.kind === "paragraph" &&
    block.children.length === 1 &&
    block.children[0]!.kind === "strong"
  );
}

export function GuideReply({
  text,
  choices,
  onChoose,
  disabled,
  inactive,
  selected,
}: {
  text: string;
  choices?: QuickChoice[];
  onChoose?: (message: string) => void;
  disabled?: boolean;
  inactive?: boolean;
  selected?: string;
}) {
  const {
    body,
    question,
    choices: cards,
  } = useMemo(() => presentReply(text, choices), [text, choices]);
  const headline = isHeadline(body[0]);

  return (
    <div className="@container space-y-3">
      {body.map((block, i) => (
        <BlockView key={i} block={block} index={i} headline={headline && i === 0} />
      ))}

      {cards.length > 0 && (
        <section aria-label="Choose an area" className="border-t border-line pt-3">
          <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h3 className="font-serif text-[19px] leading-tight text-ink">Which feels like you?</h3>
            <span className="text-[11px] text-ink-muted">
              {inactive ? "Earlier options" : "Choose one to continue"}
            </span>
          </div>
          <div className="grid grid-cols-1 gap-2 @min-[360px]:grid-cols-2">
            {cards.map((c) => {
              const chosen = selected === c.message;
              return (
                <button
                  key={c.message}
                  type="button"
                  disabled={disabled || inactive || !onChoose}
                  aria-pressed={chosen}
                  onClick={() => onChoose?.(c.message)}
                  className={`group relative min-w-0 border p-3 text-left transition-colors motion-reduce:transition-none enabled:hover:border-moss enabled:hover:bg-sage/35 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vermilion-deep disabled:cursor-default ${chosen ? "border-moss bg-sage/50" : "border-line-strong bg-paper-soft"}`}
                >
                  <span className="flex items-start justify-between gap-2">
                    <span className="min-w-0">
                      <span className="block font-serif text-[21px] leading-[1.2] text-ink">
                        {c.title ?? c.label}
                      </span>
                      {c.sublabel && (
                        <span className="mt-1 block text-[11px] leading-snug text-ink-muted">
                          {c.sublabel}
                        </span>
                      )}
                    </span>
                    <span
                      aria-hidden
                      className={`flex h-6 w-6 shrink-0 items-center justify-center border text-[13px] ${chosen ? "border-moss bg-moss text-paper-soft" : "border-line text-moss group-enabled:group-hover:border-moss group-enabled:group-hover:bg-moss group-enabled:group-hover:text-paper-soft"}`}
                    >
                      {chosen ? "✓" : "→"}
                    </span>
                  </span>
                  <span className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-line pt-2.5">
                    {c.metrics.map((metric) => (
                      <span key={metric.label} className="min-w-0">
                        <span className="block text-[10px] leading-snug text-ink-muted">
                          {metric.label}
                        </span>
                        <span className="tnum mt-0.5 block text-[14px] leading-snug font-medium text-ink">
                          {metric.value}
                        </span>
                      </span>
                    ))}
                  </span>
                  {chosen && (
                    <span className="mt-2 block text-[11px] font-medium text-moss">
                      Your choice
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-ink-muted">
            Rent is a ward-level estimate; travel times are one way.
            {!inactive && " Or tell me what you’d change below."}
          </p>
        </section>
      )}
      {question && (
        <div className="border-t border-line pt-3">
          <p className="font-serif text-[18px] leading-[1.4] text-ink">
            <InlineNodes
              nodes={
                question.kind === "paragraph" || question.kind === "quote" ? question.children : []
              }
              k="q"
            />
          </p>
        </div>
      )}
    </div>
  );
}

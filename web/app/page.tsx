import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { LIFESTYLE_AXES, LIFESTYLE_AXIS_IDS, OVERALL_WEIGHTS } from "@tokyo/shared";

import { Masthead } from "./components/Masthead";
import { IndexBand } from "./components/landing/IndexBand";
import { MethodSequence } from "./components/landing/MethodSequence";
import { NarrowingPlate } from "./components/landing/NarrowingPlate";
import { Reveal } from "./components/landing/Reveal";
import { StartButton } from "./components/landing/StartButton";
import {
  AXIS_EVIDENCE,
  EXAMPLE_SEARCH,
  LOCALITY_COUNT,
} from "./components/landing/tokyo-localities";

export const metadata: Metadata = {
  title: "Matchi — Meet your Matchi",
  description:
    "Find the Tokyo neighborhood that fits your life. Matchi compares commute, modeled rent, and everyday rhythm — and shows the compromise before you sign anything.",
};

const LIMITS = [
  {
    title: "These are not listings",
    body: "Rent is modeled from public statistics for an area and a layout, not scraped from an agent's window. Treat the range as the shape of a neighborhood's market, then go and check real ones.",
  },
  {
    title: "The commute is a typical weekday",
    body: "Estimated from transit topology, not a live timetable. It will not know about your delayed train, and it does not promise a seat.",
  },
  {
    title: "Confidence is shown, not hidden",
    body: "Some areas rest on thin data. Where that is true the guide says low confidence next to the number, rather than rounding the uncertainty away.",
  },
] as const;

export default async function Landing({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  if (params["dest"] !== undefined || params["destLabel"] !== undefined) {
    const forwarded = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (typeof value === "string") forwarded.set(key, value);
      else if (Array.isArray(value) && value[0] !== undefined) forwarded.set(key, value[0]);
    }
    redirect(`/find?${forwarded.toString()}`);
  }

  const matched = EXAMPLE_SEARCH.funnel.shortlisted;

  return (
    <div className="min-h-screen">
      <Masthead variant="landing" />

      <main>
        {/* ── Hero ─────────────────────────────────────────────── */}
        <section className="mx-auto max-w-[1360px] px-5 pt-12 pb-16 sm:px-8 lg:pt-20 lg:pb-24">
          <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,9fr)_minmax(0,11fr)] lg:gap-16">
            <div>
              <Reveal mode="mount">
                <p className="label-utility text-vermilion-deep">Meet your Matchi.</p>
              </Reveal>

              <Reveal mode="mount" delay={0.06}>
                <h1 className="mt-5 font-serif text-[2.9rem] leading-[0.98] font-medium tracking-editorial text-balance sm:text-6xl lg:text-[4.2rem]">
                  Tokyo is not one place.
                </h1>
              </Reveal>

              <Reveal mode="mount" delay={0.12}>
                <p className="mt-6 max-w-md text-[17px] leading-relaxed text-ink-muted">
                  It is {LOCALITY_COUNT} of them, each with its own rhythm, its own rent, and its
                  own quiet hour. Tell the guide where your life has to happen, and it will tell you
                  which of them fit — and what each one costs you.
                </p>
              </Reveal>

              <Reveal mode="mount" delay={0.18}>
                <div className="mt-9 flex flex-col gap-4 sm:flex-row sm:items-center">
                  <StartButton className="w-full sm:w-auto sm:min-w-72">Find my Matchi</StartButton>
                  <a
                    href="#method"
                    className="label-utility min-h-14 content-center text-ink-muted underline decoration-line-strong underline-offset-4 transition-colors hover:text-ink hover:decoration-ink"
                  >
                    How it works
                  </a>
                </div>
              </Reveal>

              <Reveal mode="mount" delay={0.24}>
                <p className="mt-6 max-w-md text-[12.5px] leading-relaxed text-ink-muted">
                  Free, no account. Recommendations use modeled rent, transit, safety, and amenity
                  data — not live listings.
                </p>
              </Reveal>
            </div>

            {/* The signature: the plate that narrows. */}
            <Reveal mode="mount" delay={0.1}>
              <NarrowingPlate />
            </Reveal>
          </div>
        </section>

        {/* ── The index ────────────────────────────────────────── */}
        <IndexBand />

        {/* ── The method ───────────────────────────────────────── */}
        <section id="method" aria-labelledby="method-heading" className="scroll-mt-6 bg-paper-soft">
          <div className="mx-auto max-w-[1360px] px-5 py-16 sm:px-8 lg:py-20">
            <Reveal>
              <p className="label-utility text-vermilion-deep">The method</p>
              <h2
                id="method-heading"
                className="mt-3 max-w-2xl font-serif text-3xl leading-tight font-medium tracking-editorial text-balance sm:text-[2.6rem]"
              >
                Three questions, then the whole city sorts itself.
              </h2>
            </Reveal>

            <MethodSequence />

            <Reveal delay={0.1}>
              <p className="mt-8 max-w-2xl text-[13px] leading-relaxed text-ink-muted">
                The overall score is {OVERALL_WEIGHTS.affordability * 100}% affordability,{" "}
                {OVERALL_WEIGHTS.commute * 100}% commute, and {OVERALL_WEIGHTS.lifestyle * 100}%
                everyday life — and the guide shows its working for each one.
              </p>
            </Reveal>
          </div>
        </section>

        {/* ── What it measures ─────────────────────────────────── */}
        <section aria-labelledby="measures-heading" className="border-t border-line-strong">
          <div className="mx-auto max-w-[1360px] px-5 py-16 sm:px-8 lg:py-20">
            <div className="grid gap-10 lg:grid-cols-[minmax(0,7fr)_minmax(0,13fr)] lg:gap-16">
              <Reveal>
                <p className="label-utility text-vermilion-deep">What it measures</p>
                <h2
                  id="measures-heading"
                  className="mt-3 font-serif text-3xl leading-tight font-medium tracking-editorial text-balance sm:text-[2.6rem]"
                >
                  Everyday life, counted.
                </h2>
                <p className="mt-5 max-w-sm text-[15px] leading-relaxed text-ink-muted">
                  Pick up to five things your week actually depends on and weigh each one — low,
                  medium, high, or essential. The guide scores every area against them from open map
                  data, counted within walking distance of the station. The figures on the right are
                  what it has to count across the 23 wards.
                </p>
              </Reveal>

              {/* A specimen list, not a grid of feature cards: one hairline
                  per axis, the way a field guide indexes what it covers. */}
              <Reveal delay={0.08}>
                <ul className="border-t border-line">
                  {LIFESTYLE_AXIS_IDS.map((id, index) => {
                    const evidence = AXIS_EVIDENCE[id];
                    return (
                      <li
                        key={id}
                        className="group flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-line py-4 transition-colors duration-200 hover:bg-paper-soft motion-reduce:transition-none sm:flex-nowrap sm:gap-x-6"
                      >
                        <span className="w-6 shrink-0 font-mono text-[11px] text-stone transition-colors duration-200 group-hover:text-vermilion-deep motion-reduce:transition-none">
                          {String(index + 1).padStart(2, "0")}
                        </span>
                        <span className="font-serif text-[1.35rem] leading-snug tracking-editorial">
                          {LIFESTYLE_AXES[id].label}
                        </span>
                        {/* Each axis rests on a different kind of record, so
                            each states its own unit rather than pretending
                            they are all the same measurement. */}
                        {evidence && (
                          <span className="ml-auto flex shrink-0 items-baseline gap-2 text-ink-muted">
                            <span className="font-mono text-[13px] tnum transition-colors duration-200 group-hover:text-vermilion-deep motion-reduce:transition-none">
                              {evidence.count.toLocaleString("en-US")}
                            </span>
                            <span className="text-[12px]">{evidence.unit}</span>
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </Reveal>
            </div>
          </div>
        </section>

        {/* ── The honest part ──────────────────────────────────── */}
        <section aria-labelledby="limits-heading" className="border-t border-line-strong bg-moss">
          <div className="mx-auto max-w-[1360px] px-5 py-16 sm:px-8 lg:py-20">
            <Reveal>
              <p className="label-utility text-sage">The honest part</p>
              <h2
                id="limits-heading"
                className="mt-3 max-w-2xl font-serif text-3xl leading-tight font-medium tracking-editorial text-balance text-paper sm:text-[2.6rem]"
              >
                What this guide will not tell you.
              </h2>
            </Reveal>

            <dl className="mt-12 grid gap-x-10 gap-y-9 sm:grid-cols-3">
              {LIMITS.map((limit, index) => (
                <Reveal key={limit.title} delay={index * 0.08}>
                  <dt className="border-t border-sage/30 pt-4 font-serif text-[1.3rem] leading-snug font-medium tracking-editorial text-paper">
                    {limit.title}
                  </dt>
                  <dd className="mt-3 text-[14.5px] leading-relaxed text-sage">{limit.body}</dd>
                </Reveal>
              ))}
            </dl>
          </div>
        </section>

        {/* ── Closing ──────────────────────────────────────────── */}
        <section aria-labelledby="start-heading" className="border-t border-line-strong">
          <div className="mx-auto max-w-[1360px] px-5 py-20 sm:px-8 lg:py-28">
            <Reveal className="mx-auto max-w-2xl text-center">
              <p className="label-utility text-vermilion-deep">Meet your Matchi</p>
              <h2
                id="start-heading"
                className="mt-4 font-serif text-[2.4rem] leading-[1.05] font-medium tracking-editorial text-balance sm:text-5xl"
              >
                Where does your Tokyo have to be?
              </h2>
              <p className="mt-5 text-[16px] leading-relaxed text-ink-muted">
                One station, one budget, one honest look at the trade-offs. In the example above,{" "}
                {EXAMPLE_SEARCH.funnel.qualified} of {LOCALITY_COUNT} areas cleared every limit —
                and the guide ranked the best {matched} of them.
              </p>
              <StartButton className="mt-9">Find my Matchi</StartButton>
            </Reveal>
          </div>
        </section>
      </main>

      <footer className="border-t border-line-strong bg-paper-soft">
        <div className="mx-auto flex max-w-[1360px] flex-wrap items-baseline justify-between gap-x-8 gap-y-3 px-5 py-8 sm:px-8">
          <p className="font-serif text-[15px] tracking-editorial">
            Matchi{" "}
            <span lang="ja" className="ml-1 text-vermilion-deep">
              街
            </span>
          </p>
          <p className="max-w-xl text-[12px] leading-relaxed text-ink-muted">
            Built on OpenStreetMap, MLIT real-estate and land-price data, e-Stat official
            statistics, and ODPT transit data. Every source and its vintage is listed with your
            results.
          </p>
        </div>
      </footer>
    </div>
  );
}

import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { LIFESTYLE_AXES, LIFESTYLE_AXIS_IDS, OVERALL_WEIGHTS } from "@tokyo/shared";

import { AxisPictogram } from "./components/AxisPictogram";
import { Masthead } from "./components/Masthead";
import { DepartureBoard } from "./components/landing/DepartureBoard";
import { MethodSequence } from "./components/landing/MethodSequence";
import { Reveal } from "./components/landing/Reveal";
import { StartButton } from "./components/landing/StartButton";
import { StationSign } from "./components/landing/StationSign";
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
    body: "Some areas rest on thin data. Where that is true Matchi says low confidence next to the number, rather than rounding the uncertainty away.",
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
        <section className="relative overflow-hidden">
          <div className="mx-auto grid max-w-[1360px] items-center gap-12 px-5 pt-10 pb-14 sm:px-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-14 lg:pt-16 lg:pb-20">
            <div>
              <Reveal mode="mount">
                <Eyebrow>Meet your Matchi</Eyebrow>
              </Reveal>

              <Reveal mode="mount" delay={0.06}>
                <h1 className="mt-5 font-display text-[3.1rem] leading-[0.92] font-extrabold tracking-[-0.035em] text-balance sm:text-[4.4rem] xl:text-[5.2rem]">
                  Tokyo is not one&nbsp;place.
                </h1>
              </Reveal>

              <Reveal mode="mount" delay={0.12}>
                <p className="mt-6 max-w-md text-[17px] leading-relaxed text-ink-muted">
                  It is {LOCALITY_COUNT} of them, each with its own rhythm, its own rent, and its
                  own quiet hour. Tell Matchi where your life has to happen, and it lays out the
                  areas that fit as stops on a line — with what each one costs you.
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

            <Reveal mode="mount" delay={0.1}>
              <StationSign />
            </Reveal>
          </div>

          <TactileStrip />
        </section>

        <section aria-labelledby="board-heading" className="bg-paper">
          <div className="mx-auto max-w-[1360px] px-5 py-16 sm:px-8 lg:py-24">
            <Reveal>
              <Eyebrow>The whole city, sorted</Eyebrow>
              <h2
                id="board-heading"
                className="mt-4 max-w-3xl font-display text-[2.1rem] leading-[1.02] font-bold tracking-editorial text-balance sm:text-[3rem]"
              >
                {LOCALITY_COUNT} areas left the station. {EXAMPLE_SEARCH.funnel.qualified} made the
                train.
              </h2>
              <p className="mt-5 max-w-xl text-[16px] leading-relaxed text-ink-muted">
                One real morning: <span lang="ja">{EXAMPLE_SEARCH.destinationNameJa}</span> by{" "}
                {EXAMPLE_SEARCH.arrivalTime}, at most {EXAMPLE_SEARCH.maxCommuteMinutes} minutes
                door to door, a {EXAMPLE_SEARCH.layout} under ¥
                {EXAMPLE_SEARCH.monthlyBudgetYen.toLocaleString("en-US")}. Every area that missed a
                limit was left on the platform; the rest were ranked.
              </p>
            </Reveal>

            <div className="mt-12">
              <DepartureBoard />
            </div>
          </div>
        </section>

        <section
          id="method"
          aria-labelledby="method-heading"
          className="scroll-mt-14 border-t border-line-strong bg-paper-soft"
        >
          <div className="mx-auto max-w-[1360px] px-5 py-16 sm:px-8 lg:py-24">
            <Reveal>
              <Eyebrow>The method</Eyebrow>
              <h2
                id="method-heading"
                className="mt-4 max-w-2xl font-display text-[2.1rem] leading-[1.02] font-bold tracking-editorial text-balance sm:text-[3rem]"
              >
                Three questions, then the whole city sorts itself.
              </h2>
            </Reveal>

            <MethodSequence />

            <p className="max-w-2xl text-[13px] leading-relaxed text-ink-muted sm:pl-[4.5rem]">
              The overall score is {OVERALL_WEIGHTS.affordability * 100}% affordability,{" "}
              {OVERALL_WEIGHTS.commute * 100}% commute, and {OVERALL_WEIGHTS.lifestyle * 100}%
              everyday life — and Matchi shows its working for each one.
            </p>
          </div>
        </section>

        <section aria-labelledby="measures-heading" className="border-t border-line-strong">
          <div className="mx-auto max-w-[1360px] px-5 py-16 sm:px-8 lg:py-24">
            <div className="grid gap-10 lg:grid-cols-[minmax(0,7fr)_minmax(0,13fr)] lg:gap-16">
              <Reveal>
                <Eyebrow>What it measures</Eyebrow>
                <h2
                  id="measures-heading"
                  className="mt-4 font-display text-[2.1rem] leading-[1.02] font-bold tracking-editorial text-balance sm:text-[3rem]"
                >
                  Everyday life, counted.
                </h2>
                <p className="mt-5 max-w-sm text-[15px] leading-relaxed text-ink-muted">
                  Pick up to five things your week actually depends on and weigh each one — low,
                  medium, high, or essential. Matchi scores every area against them from open map
                  data, counted within walking distance of the station. The figures are what it has
                  to count across the 23 wards.
                </p>
              </Reveal>

              <Reveal delay={0.08}>
                <ul className="grid border-t border-l border-line-strong sm:grid-cols-2">
                  {LIFESTYLE_AXIS_IDS.map((id) => {
                    const evidence = AXIS_EVIDENCE[id];
                    return (
                      <li
                        key={id}
                        className="group flex items-center gap-4 border-r border-b border-line-strong bg-paper-soft/60 px-4 py-4 transition-colors duration-200 hover:bg-paper-soft motion-reduce:transition-none"
                      >
                        <AxisPictogram
                          axis={id}
                          className="size-12 transition-colors duration-200 group-hover:bg-moss motion-reduce:transition-none"
                        />
                        <span className="min-w-0">
                          <span className="block font-display text-[1.1rem] leading-tight font-bold tracking-editorial">
                            {LIFESTYLE_AXES[id].label}
                          </span>
                          {evidence && (
                            <span className="mt-1 block text-[12.5px] text-ink-muted">
                              <span className="font-mono text-[13px] text-ink tnum transition-colors duration-200 group-hover:text-vermilion-deep motion-reduce:transition-none">
                                {evidence.count.toLocaleString("en-US")}
                              </span>{" "}
                              {evidence.unit}
                            </span>
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </Reveal>
            </div>
          </div>
        </section>

        <section aria-labelledby="limits-heading" className="relative bg-moss">
          <span aria-hidden="true" className="absolute inset-x-0 top-0 h-1.5 bg-vermilion" />
          <div className="mx-auto max-w-[1360px] px-5 py-16 sm:px-8 lg:py-24">
            <Reveal>
              <p className="label-utility flex items-center gap-2.5 text-sage">
                <span aria-hidden="true" className="size-2 rotate-45 bg-vermilion" />
                The honest part
              </p>
              <h2
                id="limits-heading"
                className="mt-4 max-w-2xl font-display text-[2.1rem] leading-[1.02] font-bold tracking-editorial text-balance text-paper-soft sm:text-[3rem]"
              >
                What Matchi will not tell you.
              </h2>
            </Reveal>

            <dl className="mt-12 grid gap-x-10 gap-y-9 sm:grid-cols-3">
              {LIMITS.map((limit, index) => (
                <Reveal key={limit.title} delay={index * 0.08}>
                  <dt className="border-t-2 border-sage/40 pt-4 font-display text-[1.2rem] leading-snug font-bold tracking-editorial text-paper-soft">
                    {limit.title}
                  </dt>
                  <dd className="mt-3 text-[14.5px] leading-relaxed text-sage">{limit.body}</dd>
                </Reveal>
              ))}
            </dl>
          </div>
        </section>

        <section aria-labelledby="start-heading" className="overflow-hidden">
          <div className="mx-auto max-w-[1360px] px-5 py-20 sm:px-8 lg:py-28">
            <Reveal className="mx-auto max-w-3xl text-center">
              <EndOfLine />
              <h2
                id="start-heading"
                className="mt-10 font-display text-[2.5rem] leading-[0.98] font-extrabold tracking-[-0.03em] text-balance sm:text-[3.8rem]"
              >
                Where does your Tokyo have to be?
              </h2>
              <p className="mx-auto mt-5 max-w-xl text-[16px] leading-relaxed text-ink-muted">
                One station, one budget, one honest look at the trade-offs. In the example above,{" "}
                {EXAMPLE_SEARCH.funnel.qualified} of {LOCALITY_COUNT} areas cleared every limit —
                and Matchi ranked the best {matched} of them.
              </p>
              <StartButton className="mt-9">Find my Matchi</StartButton>
            </Reveal>
          </div>
        </section>
      </main>

      <footer className="border-t-[6px] border-moss bg-ink text-paper-soft">
        <div className="mx-auto flex max-w-[1360px] flex-wrap items-center justify-between gap-x-8 gap-y-4 px-5 py-9 sm:px-8">
          <p className="flex items-center gap-2 font-display text-[17px] font-bold tracking-editorial">
            <span aria-hidden="true" className="size-2.5 rotate-45 bg-vermilion" />
            Matchi
            <span lang="ja" className="ml-0.5 text-sage">
              街
            </span>
          </p>
          <p className="max-w-xl text-[12px] leading-relaxed text-paper-soft/65">
            Built on OpenStreetMap, MLIT real-estate and land-price data, e-Stat official
            statistics, and ODPT transit data. Every source and its vintage is listed with your
            results.
          </p>
        </div>
      </footer>
    </div>
  );
}

function Eyebrow({ children }: { readonly children: React.ReactNode }) {
  return (
    <p className="label-utility flex items-center gap-2.5 text-vermilion-deep">
      <span aria-hidden="true" className="size-2 rotate-45 bg-vermilion" />
      {children}
    </p>
  );
}

/**
 * The platform edge: the yellow tactile paving (点字ブロック) that runs along
 * every Japanese platform, marking the line between waiting and leaving.
 */
function TactileStrip() {
  return (
    <div
      aria-hidden="true"
      className="h-5 border-y border-[#c99a00] bg-[#f2c200] bg-[radial-gradient(circle,rgb(0_0_0/0.16)_2.2px,transparent_2.6px)] bg-[length:12px_10px] bg-center"
    />
  );
}

/** A line that runs out of stops: the one left is the reader's. */
function EndOfLine() {
  return (
    <div aria-hidden="true" className="mx-auto flex max-w-md items-center">
      <span className="flex h-7 shrink-0 items-center gap-1.5 bg-ink px-2 text-[11px] font-bold text-paper-soft">
        <span className="size-2 rotate-45 bg-vermilion" />
        <span lang="ja">{EXAMPLE_SEARCH.destinationNameJa}</span>
      </span>
      <span className="h-1.5 flex-1 bg-moss" />
      {[0, 1, 2].map((stop) => (
        <span key={stop} className="contents">
          <span className="size-4 shrink-0 rounded-full border-4 border-moss bg-paper" />
          <span className="h-1.5 flex-1 bg-moss" />
        </span>
      ))}
      <span className="grid size-9 shrink-0 place-items-center border-[3px] border-dashed border-vermilion font-display text-[15px] font-bold text-vermilion-deep">
        ?
      </span>
    </div>
  );
}

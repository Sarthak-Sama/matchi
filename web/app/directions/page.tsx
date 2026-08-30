"use client";

import { useState } from "react";

type DirectionId =
  | "field-guide"
  | "transit-desk"
  | "living-atlas"
  | "decision-map"
  | "commute-constellation"
  | "shortlist-studio"
  | "neighborhood-signal"
  | "tokyo-week"
  | "atlas-workbench"
  | "midnight-atlas";

const DIRECTIONS: Array<{
  id: DirectionId;
  number: string;
  title: string;
  thesis: string;
  bestFor: string;
  risk: string;
}> = [
  {
    id: "field-guide",
    number: "01",
    title: "The Field Guide",
    thesis: "Turn the search into an invitation to discover a place.",
    bestFor: "Emotion, trust, and first-time Tokyo movers",
    risk: "Rich storytelling can slow repeat users down",
  },
  {
    id: "transit-desk",
    number: "02",
    title: "The Transit Desk",
    thesis: "Make every trade-off legible, fast, and inspectable.",
    bestFor: "Power users and evidence-heavy decisions",
    risk: "Density may feel intimidating or overly technical",
  },
  {
    id: "living-atlas",
    number: "03",
    title: "The Living Atlas",
    thesis: "Open on Tokyo itself and make the first interaction feel like exploration.",
    bestFor: "A memorable landing page and spatial discovery",
    risk: "The search prompt must remain more obvious than the map",
  },
  {
    id: "decision-map",
    number: "04",
    title: "The Decision Map",
    thesis: "Let geography lead while the ranking keeps the choice grounded.",
    bestFor: "Exploration, comparison, and a scalable core product",
    risk: "The map must earn its visual prominence",
  },
  {
    id: "commute-constellation",
    number: "05",
    title: "The Commute Constellation",
    thesis: "Organize Tokyo by reachable minutes, not administrative boundaries.",
    bestFor: "A distinctive core mechanic tied directly to the product promise",
    risk: "Needs an excellent explanation of modeled travel times",
  },
  {
    id: "shortlist-studio",
    number: "06",
    title: "The Shortlist Studio",
    thesis: "Treat choosing a neighborhood like editing a thoughtful shortlist.",
    bestFor: "Serious comparison and returning users",
    risk: "Less inspiring before a user has candidates to compare",
  },
  {
    id: "neighborhood-signal",
    number: "07",
    title: "The Neighborhood Signal",
    thesis: "Compress complexity into a bold, instantly scannable point of view.",
    bestFor: "Fast judgment, shareability, and mobile results",
    risk: "Strong summaries must never conceal uncertainty",
  },
  {
    id: "tokyo-week",
    number: "08",
    title: "A Week in Tokyo",
    thesis: "Help people imagine the lived experience behind every score.",
    bestFor: "Emotional confidence and lifestyle storytelling",
    risk: "Scenario copy must stay grounded in real product data",
  },
  {
    id: "atlas-workbench",
    number: "09",
    title: "The Atlas Workbench",
    thesis: "Keep Tokyo expansive while making every decision input inspectable.",
    bestFor: "A balanced, product-ready synthesis of discovery and precision",
    risk: "The analytical rail must collapse gracefully on smaller screens",
  },
  {
    id: "midnight-atlas",
    number: "10",
    title: "The Midnight Atlas",
    thesis: "Pair a luminous city canvas with a fast, command-driven decision layer.",
    bestFor: "A distinctive expert product with a strong technical identity",
    risk: "Dark density needs careful contrast and generous breathing room",
  },
];

function ArrowIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4 fill-none stroke-current">
      <path d="M3 8h9M9 4l4 4-4 4" strokeWidth="1.5" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4 fill-none stroke-current">
      <path d="M8 3v10M3 8h10" strokeWidth="1.5" />
    </svg>
  );
}

function DirectionButton({
  id,
  selected,
  onSelect,
  inverted = false,
}: {
  id: DirectionId;
  selected: boolean;
  onSelect: (id: DirectionId) => void;
  inverted?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(id)}
      aria-pressed={selected}
      className={`group inline-flex min-h-11 items-center gap-2 border px-4 text-xs font-semibold tracking-[0.08em] uppercase transition-colors focus-visible:outline-2 focus-visible:outline-offset-4 ${
        inverted
          ? "border-white/30 text-white hover:border-white focus-visible:outline-white"
          : "border-stone-400 text-stone-900 hover:border-stone-950 focus-visible:outline-stone-950"
      } ${selected ? (inverted ? "bg-white text-stone-950" : "bg-stone-950 text-white") : ""}`}
    >
      {selected ? "Selected for discussion" : "Choose this direction"}
      {selected ? <span aria-hidden="true">✓</span> : <ArrowIcon />}
    </button>
  );
}

function FieldGuidePreview() {
  return (
    <div className="overflow-hidden border border-[#2f2b25]/20 bg-[#f5f0e6] text-[#28241f] shadow-[0_20px_60px_rgba(62,48,33,0.12)]">
      <div className="flex items-center justify-between border-b border-[#2f2b25]/20 px-5 py-4 text-[10px] font-semibold tracking-[0.18em] uppercase sm:px-8">
        <span>Tokyo / Find your place</span>
        <div className="flex items-center gap-5">
          <span className="hidden sm:inline">Saved 02</span>
          <span className="font-serif text-base normal-case tracking-normal">東京</span>
        </div>
      </div>
      <div className="grid lg:grid-cols-[1.35fr_0.65fr]">
        <div className="relative min-h-[420px] overflow-hidden border-b border-[#2f2b25]/20 p-6 sm:p-10 lg:border-r lg:border-b-0">
          <div className="absolute -right-24 -bottom-36 size-[430px] rounded-full border border-[#b7472a]/25" />
          <div className="absolute right-10 bottom-5 font-serif text-[160px] leading-none text-[#b7472a]/[0.06] sm:text-[240px]">
            清
          </div>
          <div className="relative flex h-full flex-col justify-between">
            <div className="flex items-start justify-between gap-4">
              <span className="rounded-full bg-[#b7472a] px-3 py-1.5 text-[10px] font-semibold tracking-[0.16em] text-white uppercase">
                Best overall fit
              </span>
              <span className="font-mono text-xs">35°40′ N / 139°48′ E</span>
            </div>
            <div className="mt-24 max-w-xl">
              <p className="mb-3 font-serif text-xl italic text-[#b7472a]">
                A quiet pocket with a creative pulse
              </p>
              <h3 className="font-serif text-5xl leading-[0.9] tracking-[-0.04em] sm:text-7xl">
                Kiyosumi-
                <br />
                shirakawa
              </h3>
              <p className="mt-4 text-sm tracking-[0.18em] uppercase">清澄白河 · Koto City</p>
            </div>
          </div>
        </div>
        <div className="flex flex-col">
          <div className="grid grid-cols-2 border-b border-[#2f2b25]/20">
            <div className="border-r border-[#2f2b25]/20 p-5 sm:p-7">
              <p className="text-[10px] font-semibold tracking-[0.15em] uppercase">To Shibuya</p>
              <p className="mt-3 font-serif text-4xl">
                31<span className="ml-1 text-base italic">min</span>
              </p>
            </div>
            <div className="p-5 sm:p-7">
              <p className="text-[10px] font-semibold tracking-[0.15em] uppercase">Rent range</p>
              <p className="mt-3 font-serif text-3xl">
                ¥168<span className="text-base italic">k</span>
              </p>
            </div>
          </div>
          <div className="grow p-6 sm:p-8">
            <p className="text-[10px] font-semibold tracking-[0.15em] uppercase">Why it fits</p>
            <p className="mt-4 font-serif text-xl leading-relaxed">
              Gallery weekends, excellent groceries, and a calmer evening rhythm—without giving up a
              direct route into central Tokyo.
            </p>
            <div className="mt-8 space-y-3 border-t border-[#2f2b25]/20 pt-5 text-xs">
              <div className="flex justify-between">
                <span>Quietness</span>
                <span>Exceptional</span>
              </div>
              <div className="flex justify-between">
                <span>Green space</span>
                <span>Good access</span>
              </div>
              <div className="flex justify-between">
                <span>Dining</span>
                <span>Strong</span>
              </div>
            </div>
          </div>
          <button
            type="button"
            className="flex items-center justify-between bg-[#2e3f34] px-6 py-5 text-left text-xs font-semibold tracking-[0.12em] text-white uppercase transition-colors hover:bg-[#b7472a] focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-white"
          >
            Read the neighborhood portrait <ArrowIcon />
          </button>
        </div>
      </div>
    </div>
  );
}

function TransitDeskPreview() {
  const rows = [
    ["01", "Musashi-Koyama", "武蔵小山", "24", "¥182k", "91.4"],
    ["02", "Nishi-Ogikubo", "西荻窪", "22", "¥176k", "89.7"],
    ["03", "Gakugei-daigaku", "学芸大学", "18", "¥196k", "87.2"],
  ];
  return (
    <div className="overflow-hidden border border-white/15 bg-[#101311] font-mono text-[#f0f4ec] shadow-[0_24px_70px_rgba(0,0,0,0.24)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/15 px-4 py-3 text-[10px] tracking-[0.14em] uppercase sm:px-6">
        <div className="flex items-center gap-3">
          <span className="size-2 bg-[#b7f34b]" /> Matchi / Console
        </div>
        <div className="text-white/45">Model updated 08:41 JST</div>
      </div>
      <div className="grid min-h-[420px] lg:grid-cols-[250px_1fr]">
        <aside className="border-b border-white/15 bg-[#151916] p-5 lg:border-r lg:border-b-0">
          <p className="text-[9px] tracking-[0.16em] text-white/40 uppercase">Active parameters</p>
          <div className="mt-5 space-y-6">
            <div>
              <p className="text-[10px] text-white/40">DESTINATION</p>
              <p className="mt-1 text-sm">SHIBUYA / 渋谷</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-[10px] text-white/40">ARRIVE</p>
                <p className="mt-1 text-sm">08:30</p>
              </div>
              <div>
                <p className="text-[10px] text-white/40">MAX</p>
                <p className="mt-1 text-sm">45 MIN</p>
              </div>
            </div>
            <div>
              <p className="text-[10px] text-white/40">BUDGET / 1LDK</p>
              <p className="mt-1 text-sm">¥200,000</p>
            </div>
            <div>
              <p className="mb-2 text-[10px] text-white/40">PRIORITY WEIGHTS</p>
              {["QUIET", "GROCERY", "DINING", "GREEN"].map((label, index) => (
                <div key={label} className="mt-2 flex items-center gap-3">
                  <span className="w-14 text-[9px]">{label}</span>
                  <div className="h-1 flex-1 bg-white/10">
                    <div
                      className="h-full bg-[#b7f34b]"
                      style={{ width: `${[82, 65, 48, 74][index]}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
          <button
            type="button"
            className="mt-7 flex w-full items-center justify-between border border-white/20 px-3 py-2.5 text-[10px] hover:border-[#b7f34b] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#b7f34b]"
          >
            EDIT QUERY <span>E</span>
          </button>
        </aside>
        <div className="min-w-0">
          <div className="flex items-end justify-between border-b border-white/15 p-5 sm:p-6">
            <div>
              <p className="text-[9px] tracking-[0.16em] text-[#b7f34b] uppercase">
                23 candidates / 8 qualified
              </p>
              <h3 className="mt-2 font-sans text-3xl font-medium tracking-[-0.04em]">
                Ranked output
              </h3>
            </div>
            <span className="hidden text-[9px] text-white/40 sm:inline">SORT: COMPOSITE ↓</span>
          </div>
          <div className="overflow-x-auto">
            <div className="min-w-[600px]">
              <div className="grid grid-cols-[44px_1fr_72px_88px_64px] border-b border-white/15 px-4 py-2.5 text-[9px] text-white/35 sm:px-6">
                <span>#</span>
                <span>STATION / WARD</span>
                <span>COMMUTE</span>
                <span>RENT</span>
                <span>SCORE</span>
              </div>
              {rows.map((row, index) => (
                <div
                  key={row[1]}
                  className={`grid grid-cols-[44px_1fr_72px_88px_64px] items-center border-b border-white/10 px-4 py-4 transition-colors hover:bg-white/[0.04] sm:px-6 ${index === 0 ? "bg-[#b7f34b]/[0.06]" : ""}`}
                >
                  <span className="text-xs text-white/40">{row[0]}</span>
                  <div>
                    <p className="font-sans text-base font-medium">{row[1]}</p>
                    <p className="mt-1 text-[9px] text-white/40">{row[2]} · SHINAGAWA</p>
                  </div>
                  <span className="text-xs">{row[3]}m</span>
                  <span className="text-xs">{row[4]}</span>
                  <span className="text-lg text-[#b7f34b]">{row[5]}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-3 divide-x divide-white/15 border-t border-white/15 bg-black/20 p-4 text-center text-[9px] tracking-[0.1em] text-white/45 uppercase">
            <span>↑↓ Navigate</span>
            <span>Space Compare</span>
            <span>Enter Inspect</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function LivingAtlasPreview() {
  return (
    <div className="relative min-h-[590px] overflow-hidden bg-[#b9c8bd] text-[#152820] shadow-[0_24px_70px_rgba(42,64,51,0.18)]">
      <svg viewBox="0 0 1200 620" aria-hidden="true" className="absolute inset-0 h-full w-full">
        <rect width="1200" height="620" fill="#b9c8bd" />
        <path
          d="M-80 505 C220 378 305 472 520 313 S890 192 1270 18"
          fill="none"
          stroke="#dce3d9"
          strokeWidth="82"
        />
        <path
          d="M-20 165 C205 224 344 80 530 156 S880 213 1230 130"
          fill="none"
          stroke="#edf0e9"
          strokeWidth="30"
        />
        <path
          d="M198 -40 C182 121 296 217 236 352 S258 531 382 680"
          fill="none"
          stroke="#edf0e9"
          strokeWidth="24"
        />
        <path
          d="M840 -30 C790 132 904 215 816 356 S830 520 986 680"
          fill="none"
          stroke="#edf0e9"
          strokeWidth="23"
        />
        <g fill="none" stroke="#82998b" strokeWidth="1.4" opacity=".75">
          <path d="M32 40h170v82H32zM245 26h145v110H245zM438 32h184v85H438zM680 40h132v105H680zM920 25h206v108H920z" />
          <path d="M38 245h134v108H38zM314 233h168v79H314zM572 232h133v103H572zM915 239h203v92H915z" />
          <path d="M50 432h173v118H50zM322 414h152v142H322zM620 417h166v100H620zM891 404h238v143H891z" />
        </g>
        <g fill="#587162" fontSize="12" fontFamily="sans-serif" letterSpacing="2">
          <text x="72" y="208">
            NAKANO
          </text>
          <text x="518" y="390">
            SHIBUYA
          </text>
          <text x="920" y="190">
            SUMIDA
          </text>
          <text x="835" y="570">
            SHINAGAWA
          </text>
        </g>
      </svg>
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(18,38,29,0.18),transparent_55%)]" />
      <div className="relative flex items-center justify-between border-b border-[#152820]/15 bg-[#edf0e9]/90 px-5 py-4 backdrop-blur-sm sm:px-7">
        <div className="flex items-center gap-3 text-sm font-semibold">
          <span className="grid size-8 place-items-center bg-[#ef5b3f] text-[10px] text-white">
            東京
          </span>{" "}
          Matchi
        </div>
        <div className="flex items-center gap-5 text-[10px] font-semibold tracking-[0.12em] uppercase">
          <span className="hidden sm:inline">How it works</span>
          <span>Saved / 02</span>
        </div>
      </div>
      <div className="relative flex min-h-[520px] items-end p-5 sm:p-8 lg:items-center lg:p-12">
        <div className="w-full max-w-xl bg-[#f5f1e8] p-6 shadow-[0_28px_80px_rgba(21,40,32,0.22)] sm:p-9">
          <p className="text-[10px] font-semibold tracking-[0.16em] text-[#d64931] uppercase">
            Find your place in Tokyo
          </p>
          <h3 className="mt-4 max-w-lg text-4xl leading-[0.98] font-semibold tracking-[-0.05em] sm:text-6xl">
            Start with where you need to be.
          </h3>
          <div className="mt-8 border-b-2 border-[#152820] pb-3">
            <label
              htmlFor="atlas-destination"
              className="block text-[9px] font-semibold tracking-[0.14em] text-[#64756b] uppercase"
            >
              Destination station or place
            </label>
            <div className="mt-2 flex items-center gap-3">
              <span aria-hidden="true" className="text-[#d64931]">
                ●
              </span>
              <input
                id="atlas-destination"
                readOnly
                value="Shibuya / 渋谷"
                className="min-w-0 flex-1 bg-transparent text-xl font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#152820]"
              />
              <span className="text-xs">⌘ K</span>
            </div>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-px bg-[#152820]/20 sm:grid-cols-3">
            {[
              ["ARRIVE BY", "08:30"],
              ["MAX COMMUTE", "45 min"],
              ["BUDGET", "¥200k"],
            ].map(([label, value]) => (
              <button
                key={label}
                type="button"
                className="bg-[#f5f1e8] px-3 py-3 text-left transition-colors hover:bg-white"
              >
                <span className="block text-[8px] font-semibold text-[#718077]">{label}</span>
                <span className="mt-1 block text-xs font-semibold">{value}</span>
              </button>
            ))}
          </div>
          <button
            type="button"
            className="mt-5 flex min-h-12 w-full items-center justify-between bg-[#152820] px-5 text-sm font-semibold text-white transition-colors hover:bg-[#d64931]"
          >
            Show me where to live <ArrowIcon />
          </button>
        </div>
        <div className="absolute right-[13%] top-[30%] hidden lg:block">
          <span className="absolute -inset-4 animate-pulse rounded-full border border-[#d64931]/50 motion-reduce:animate-none" />
          <span className="relative grid size-10 place-items-center rounded-full border-2 border-white bg-[#d64931] text-xs font-bold text-white shadow-lg">
            渋
          </span>
        </div>
      </div>
    </div>
  );
}

function DecisionMapPreview() {
  const pins = [
    ["18%", "33%", "1"],
    ["43%", "24%", "2"],
    ["66%", "43%", "3"],
    ["33%", "68%", "4"],
    ["76%", "72%", "5"],
  ];
  return (
    <div className="overflow-hidden border border-[#172d4a]/15 bg-white text-[#172d4a] shadow-[0_24px_70px_rgba(34,66,90,0.13)]">
      <div className="flex items-center justify-between border-b border-[#172d4a]/15 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <span className="grid size-7 place-items-center bg-[#ef5b3f] text-[10px] font-bold text-white">
            TA
          </span>
          <span className="text-sm font-semibold tracking-[-0.02em]">Matchi</span>
        </div>
        <div className="flex items-center gap-2 text-[10px] font-semibold">
          <button
            type="button"
            className="hidden px-3 py-2 text-[#5c6d80] hover:text-[#172d4a] sm:block"
          >
            SAVED 02
          </button>
          <button type="button" className="bg-[#172d4a] px-3 py-2 text-white">
            REFINE SEARCH
          </button>
        </div>
      </div>
      <div className="grid min-h-[500px] lg:grid-cols-[1fr_380px]">
        <div className="relative min-h-[360px] overflow-hidden border-b border-[#172d4a]/15 bg-[#dfe8e7] lg:border-r lg:border-b-0">
          <svg viewBox="0 0 800 500" aria-hidden="true" className="absolute inset-0 h-full w-full">
            <path
              d="M-40 403 C130 316 202 382 338 280 S566 238 858 86"
              fill="none"
              stroke="#b8cfcb"
              strokeWidth="52"
            />
            <path
              d="M-30 120 C150 164 218 95 364 150 S592 178 836 120"
              fill="none"
              stroke="#f5f7f3"
              strokeWidth="24"
            />
            <path
              d="M72 -20 C110 126 198 178 185 310 S228 460 320 540"
              fill="none"
              stroke="#f5f7f3"
              strokeWidth="18"
            />
            <path
              d="M536 -30 C502 136 590 196 536 316 S568 444 690 535"
              fill="none"
              stroke="#f5f7f3"
              strokeWidth="19"
            />
            <path
              d="M-10 312 L824 312M408 -10 L408 520"
              stroke="#cbd9d6"
              strokeWidth="2"
              strokeDasharray="4 6"
            />
            <g fill="none" stroke="#9db4af" strokeWidth="1.2">
              <path d="M50 35h180v85H50zM242 42h145v75H242zM430 42h150v92H430zM610 28h140v105H610z" />
              <path d="M35 174h120v102H35zM218 183h144v70H218zM455 172h100v102H455zM614 178h160v91H614z" />
              <path d="M48 346h137v104H48zM251 342h115v126H251zM446 351h146v91H446zM630 348h123v117H630z" />
            </g>
          </svg>
          <div className="absolute top-4 left-4 flex items-center gap-1 bg-white p-1 text-[10px] font-semibold shadow-sm">
            <button type="button" className="bg-[#172d4a] px-3 py-2 text-white">
              FIT
            </button>
            <button type="button" className="px-3 py-2 text-[#5c6d80]">
              RENT
            </button>
            <button type="button" className="px-3 py-2 text-[#5c6d80]">
              TIME
            </button>
          </div>
          {pins.map(([left, top, label], index) => (
            <button
              key={label}
              type="button"
              style={{ left, top }}
              aria-label={`Open result ${label}`}
              className={`absolute grid size-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 border-white text-xs font-bold shadow-md transition-transform hover:scale-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#172d4a] ${index === 0 ? "bg-[#ef5b3f] text-white" : "bg-[#172d4a] text-white"}`}
            >
              {label}
            </button>
          ))}
          <div className="absolute bottom-4 left-4 bg-white/95 px-3 py-2 text-[10px] shadow-sm">
            <span className="mr-2 inline-block size-2 rounded-full bg-[#ef5b3f]" />
            23-minute commute boundary
          </div>
        </div>
        <div className="flex flex-col bg-[#f8f7f3]">
          <div className="border-b border-[#172d4a]/15 p-5">
            <p className="text-[10px] font-semibold tracking-[0.14em] text-[#ef5b3f] uppercase">
              8 strong matches
            </p>
            <div className="mt-2 flex items-end justify-between">
              <h3 className="text-2xl font-semibold tracking-[-0.04em]">Your Tokyo shortlist</h3>
              <button
                type="button"
                className="text-[10px] font-semibold underline underline-offset-4"
              >
                COMPARE
              </button>
            </div>
          </div>
          {[
            ["01", "Musashi-Koyama", "武蔵小山", "91", "24 min", "¥182k"],
            ["02", "Nishi-Ogikubo", "西荻窪", "89", "22 min", "¥176k"],
            ["03", "Gakugei-daigaku", "学芸大学", "87", "18 min", "¥196k"],
          ].map((item, index) => (
            <button
              key={item[1]}
              type="button"
              className={`group grid grid-cols-[34px_1fr_auto] items-start border-b border-[#172d4a]/10 p-4 text-left transition-colors hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#172d4a] ${index === 0 ? "bg-white" : ""}`}
            >
              <span className="mt-1 text-[10px] font-semibold text-[#8a99a5]">{item[0]}</span>
              <span>
                <span className="block text-sm font-semibold">{item[1]}</span>
                <span className="mt-1 block text-[10px] text-[#65788a]">
                  {item[2]} · {item[4]} · {item[5]}
                </span>
                <span className="mt-3 block text-[10px] text-[#35705b]">
                  Great groceries · quiet streets
                </span>
              </span>
              <span
                className={`grid size-10 place-items-center rounded-full text-sm font-bold ${index === 0 ? "bg-[#ef5b3f] text-white" : "border border-[#172d4a]/20"}`}
              >
                {item[3]}
              </span>
            </button>
          ))}
          <button
            type="button"
            className="m-4 mt-auto flex min-h-11 items-center justify-between border border-[#172d4a]/25 px-4 text-xs font-semibold transition-colors hover:bg-[#172d4a] hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#172d4a]"
          >
            See all 8 matches <ArrowIcon />
          </button>
        </div>
      </div>
    </div>
  );
}

function CommuteConstellationPreview() {
  return (
    <div className="overflow-hidden border border-[#9dd9ff]/20 bg-[#09131e] font-mono text-[#eaf6ff] shadow-[0_28px_80px_rgba(4,12,21,0.35)]">
      <div className="flex items-center justify-between border-b border-[#9dd9ff]/15 px-5 py-4 text-[10px] tracking-[0.14em] uppercase sm:px-7">
        <div className="flex items-center gap-3">
          <span className="size-2 rounded-full bg-[#ff765c] shadow-[0_0_0_5px_rgba(255,118,92,.12)]" />{" "}
          Tokyo in reachable minutes
        </div>
        <span className="text-[#9dd9ff]/50">Tue / arrive 08:30</span>
      </div>
      <div className="grid min-h-[560px] lg:grid-cols-[290px_1fr]">
        <aside className="relative z-10 border-b border-[#9dd9ff]/15 bg-[#0d1925] p-6 lg:border-r lg:border-b-0">
          <p className="text-[9px] tracking-[0.16em] text-[#76c9fa] uppercase">
            Your center of gravity
          </p>
          <h3 className="mt-3 font-sans text-3xl font-medium tracking-[-0.04em]">
            Shibuya
            <br />
            <span className="text-[#76c9fa]">渋谷</span>
          </h3>
          <div className="mt-8 space-y-3">
            {[
              ["15", "A fast hop"],
              ["30", "Comfortable daily"],
              ["45", "Maximum reach"],
            ].map(([minutes, label], index) => (
              <button
                key={minutes}
                type="button"
                className={`flex w-full items-center justify-between border px-4 py-3 text-left transition-colors ${index === 1 ? "border-[#ff765c] bg-[#ff765c]/10" : "border-white/15 hover:border-[#76c9fa]"}`}
              >
                <span>
                  <span className="block font-sans text-xl font-semibold">
                    {minutes}
                    <span className="ml-1 text-xs">min</span>
                  </span>
                  <span className="mt-1 block text-[9px] text-white/45">{label}</span>
                </span>
                <span
                  className={`size-2 rounded-full ${index === 1 ? "bg-[#ff765c]" : "border border-white/40"}`}
                />
              </button>
            ))}
          </div>
          <p className="mt-6 text-[9px] leading-5 text-white/40">
            Travel field includes expected wait, transfers, and station access—not just train time.
          </p>
        </aside>
        <div className="relative min-h-[500px] overflow-hidden bg-[radial-gradient(circle_at_center,#102a3b_0,#09131e_68%)]">
          <svg viewBox="0 0 850 560" aria-hidden="true" className="absolute inset-0 h-full w-full">
            <g fill="none" transform="translate(445 280)">
              <ellipse rx="98" ry="72" stroke="#ff765c" strokeWidth="1.5" opacity=".85" />
              <ellipse
                rx="220"
                ry="160"
                stroke="#76c9fa"
                strokeWidth="1.2"
                strokeDasharray="4 7"
                opacity=".7"
              />
              <ellipse
                rx="365"
                ry="248"
                stroke="#76c9fa"
                strokeWidth="1"
                strokeDasharray="3 9"
                opacity=".35"
              />
            </g>
            <g fill="none" strokeWidth="3" opacity=".8">
              <path d="M445 280L124 112" stroke="#ffd15c" />
              <path d="M445 280L706 74" stroke="#72d6a4" />
              <path d="M445 280L770 377" stroke="#c98bff" />
              <path d="M445 280L236 492" stroke="#76c9fa" />
              <path d="M445 280L170 308" stroke="#ff765c" />
            </g>
            <g fill="#eaf6ff">
              {[
                [124, 112],
                [706, 74],
                [770, 377],
                [236, 492],
                [170, 308],
                [445, 280],
              ].map(([cx, cy], index) => (
                <circle key={index} cx={cx} cy={cy} r={index === 5 ? 8 : 5} />
              ))}
            </g>
          </svg>
          <div className="absolute top-5 left-5 flex bg-[#0d1925]/90 p-1 text-[9px]">
            <button type="button" className="bg-[#eaf6ff] px-3 py-2 text-[#09131e]">
              TRAVEL FIELD
            </button>
            <button type="button" className="px-3 py-2 text-white/50">
              MAP
            </button>
          </div>
          <div className="absolute top-[46%] left-[52%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#ff765c] px-3 py-2 text-[9px] font-bold text-[#09131e] shadow-[0_0_30px_rgba(255,118,92,.35)]">
            SHIBUYA
          </div>
          {[
            ["18%", "18%", "NISHI-OGIKUBO · 29m"],
            ["65%", "12%", "KITA-SENJU · 32m"],
            ["65%", "68%", "MUSASHI-KOYAMA · 24m"],
            ["19%", "72%", "SANGENJAYA · 16m"],
          ].map(([left, top, label]) => (
            <button
              key={label}
              type="button"
              style={{ left, top }}
              className="absolute border border-[#76c9fa]/35 bg-[#0d1925]/90 px-3 py-2 text-[8px] transition-colors hover:border-[#ff765c] hover:text-[#ff765c]"
            >
              {label}
            </button>
          ))}
          <div className="absolute right-5 bottom-5 max-w-[220px] border border-[#76c9fa]/25 bg-[#0d1925]/95 p-4">
            <p className="text-[9px] text-[#76c9fa]">IN THE 30-MINUTE FIELD</p>
            <p className="mt-2 font-sans text-2xl font-semibold">47 areas</p>
            <p className="mt-1 text-[9px] text-white/45">12 within your rent target</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function ShortlistStudioPreview() {
  const comparisonRows = [
    ["Commute", "24 min", "22 min", "18 min"],
    ["Rent", "¥182k", "¥176k", "¥196k"],
    ["Quiet", "Excellent", "Excellent", "Good"],
    ["Groceries", "9.2", "8.7", "8.9"],
  ];
  return (
    <div className="overflow-hidden border border-[#2b3138]/20 bg-[#e9e7e0] text-[#20252b] shadow-[0_24px_70px_rgba(42,44,47,0.16)]">
      <div className="flex items-center justify-between border-b border-[#2b3138]/20 bg-[#f6f5f0] px-5 py-4 sm:px-7">
        <div className="text-sm font-semibold">
          Shortlist <span className="ml-2 text-[#e34f32]">03</span>
        </div>
        <div className="flex gap-4 text-[10px] font-semibold">
          <button type="button">SHARE</button>
          <button type="button" className="bg-[#20252b] px-3 py-2 text-white">
            REFINE
          </button>
        </div>
      </div>
      <div className="grid lg:grid-cols-[230px_1fr]">
        <aside className="border-b border-[#2b3138]/20 bg-[#d8d6ce] p-5 lg:border-r lg:border-b-0">
          <p className="text-[9px] font-semibold tracking-[0.14em] text-[#68717a] uppercase">
            Your decision
          </p>
          <h3 className="mt-3 text-3xl font-semibold tracking-[-0.04em]">
            Three places.
            <br />
            One life.
          </h3>
          <p className="mt-4 text-xs leading-5 text-[#5f666d]">
            Pin what matters. Remove what doesn’t. The studio remembers your trade-offs.
          </p>
          <div className="mt-8 border-t border-[#2b3138]/20 pt-4 text-xs">
            <p className="font-semibold">Pinned priority</p>
            <p className="mt-2 flex items-center gap-2 text-[#4b655a]">
              <span className="size-2 bg-[#55a078]" /> Quiet after 10pm
            </p>
          </div>
        </aside>
        <div className="min-w-0 overflow-x-auto p-5 sm:p-7">
          <div className="min-w-[680px]">
            <div className="grid grid-cols-[120px_repeat(3,1fr)] gap-2">
              <div />
              {[
                ["A", "Musashi-Koyama", "武蔵小山", "91"],
                ["B", "Nishi-Ogikubo", "西荻窪", "89"],
                ["C", "Gakugei-daigaku", "学芸大学", "87"],
              ].map(([letter, name, ja, score], index) => (
                <button
                  key={name}
                  type="button"
                  className={`group relative min-h-36 border p-4 text-left transition-transform hover:-translate-y-1 ${index === 0 ? "border-[#e34f32] bg-[#fffdf8]" : "border-[#2b3138]/20 bg-[#f6f5f0]"}`}
                >
                  <span className="text-[9px] font-semibold text-[#8a8f93]">OPTION {letter}</span>
                  <span className="mt-6 block text-base font-semibold">{name}</span>
                  <span className="mt-1 block text-[10px] text-[#68717a]">{ja}</span>
                  <span className="absolute top-4 right-4 grid size-9 place-items-center rounded-full border border-[#2b3138]/20 text-sm font-bold">
                    {score}
                  </span>
                </button>
              ))}
              {comparisonRows.map((row) => (
                <div key={row[0]} className="contents">
                  <div className="flex items-center border-b border-[#2b3138]/15 py-4 text-[10px] font-semibold text-[#72787d] uppercase">
                    {row[0]}
                  </div>
                  {row.slice(1).map((value, index) => (
                    <div
                      key={index}
                      className={`border-b border-[#2b3138]/15 px-4 py-4 text-sm font-semibold ${index === 0 ? "bg-[#fffdf8]" : ""}`}
                    >
                      {value}
                    </div>
                  ))}
                </div>
              ))}
            </div>
            <div className="mt-5 flex items-center justify-between border-t border-[#2b3138]/20 pt-5">
              <p className="text-[10px] text-[#68717a]">4 differences worth discussing</p>
              <button
                type="button"
                className="flex items-center gap-3 bg-[#e34f32] px-4 py-3 text-xs font-semibold text-white"
              >
                Open decision notes <ArrowIcon />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function NeighborhoodSignalPreview() {
  return (
    <div className="overflow-hidden border border-[#221e1a]/20 bg-[#f2e8d8] text-[#221e1a] shadow-[0_24px_70px_rgba(63,45,31,0.14)]">
      <div className="grid lg:grid-cols-[1.2fr_0.8fr]">
        <div className="relative overflow-hidden border-b border-[#221e1a]/20 p-6 sm:p-10 lg:border-r lg:border-b-0">
          <div className="absolute top-0 right-0 size-48 translate-x-1/3 -translate-y-1/3 rounded-full bg-[#f5d63d]" />
          <div className="relative flex items-start justify-between">
            <p className="text-[10px] font-bold tracking-[0.15em] uppercase">
              Signal report / 07:42
            </p>
            <span className="grid size-12 place-items-center rounded-full bg-[#e65336] text-lg font-bold text-white">
              91
            </span>
          </div>
          <div className="relative mt-24 sm:mt-32">
            <p className="text-xs font-semibold text-[#e65336]">THE READ ON</p>
            <h3 className="mt-2 text-5xl leading-[0.88] font-black tracking-[-0.065em] uppercase sm:text-7xl">
              Musashi-
              <br />
              Koyama
            </h3>
            <p className="mt-4 text-xl font-semibold">武蔵小山 · Shinagawa</p>
          </div>
          <div className="relative mt-10 grid gap-3 sm:grid-cols-3">
            {[
              ["Feels like", "Local, lively, grounded"],
              ["Best hour", "Saturday / 10:30"],
              ["Watch", "Popular streets get busy"],
            ].map(([label, value]) => (
              <div key={label} className="border-t-2 border-[#221e1a] pt-3">
                <p className="text-[9px] font-bold uppercase">{label}</p>
                <p className="mt-2 text-sm font-semibold">{value}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="bg-[#233f38] p-6 text-white sm:p-9">
          <p className="text-[10px] font-semibold tracking-[0.14em] text-[#f5d63d] uppercase">
            Your priorities, translated
          </p>
          <div className="mt-8 space-y-7">
            {[
              ["Quiet at night", "86", "The side streets settle quickly"],
              ["Daily groceries", "94", "Excellent shotengai access"],
              ["Commute fit", "89", "Direct, predictable, low-friction"],
              ["Green space", "68", "Several parks within an easy walk"],
            ].map(([label, score, note]) => (
              <div key={label}>
                <div className="flex items-end justify-between">
                  <p className="text-sm font-semibold">{label}</p>
                  <span className="font-mono text-xl text-[#f5d63d]">{score}</span>
                </div>
                <div className="mt-2 h-1 bg-white/15">
                  <div className="h-full bg-[#f5d63d]" style={{ width: `${score}%` }} />
                </div>
                <p className="mt-2 text-[10px] text-white/45">{note}</p>
              </div>
            ))}
          </div>
          <button
            type="button"
            className="mt-9 flex min-h-12 w-full items-center justify-between border border-white/25 px-4 text-xs font-semibold transition-colors hover:bg-white hover:text-[#233f38]"
          >
            See the evidence <ArrowIcon />
          </button>
        </div>
      </div>
    </div>
  );
}

function TokyoWeekPreview() {
  const moments = [
    ["07:35", "Leave home", "Quiet residential street", "bg-[#d8e5d4]"],
    ["08:02", "Train from Koenji", "One transfer · usually seated", "bg-[#f4d269]"],
    ["08:31", "Arrive Shibuya", "29 min door to door", "bg-[#e97755] text-white"],
    ["19:10", "Dinner nearby", "84 restaurants within 10 min", "bg-[#506a5d] text-white"],
  ];
  return (
    <div className="overflow-hidden border border-[#332b25]/20 bg-[#faf5eb] text-[#332b25] shadow-[0_24px_70px_rgba(62,48,35,0.14)]">
      <div className="flex items-center justify-between border-b border-[#332b25]/20 px-5 py-4 sm:px-8">
        <span className="font-serif text-lg italic">Tokyo, as a life</span>
        <span className="text-[10px] font-semibold tracking-[0.14em] uppercase">
          Scenario based on your search
        </span>
      </div>
      <div className="grid lg:grid-cols-[0.7fr_1.3fr]">
        <div className="border-b border-[#332b25]/20 p-6 sm:p-10 lg:border-r lg:border-b-0">
          <p className="text-[10px] font-semibold tracking-[0.14em] text-[#d65338] uppercase">
            Imagine a Tuesday in
          </p>
          <h3 className="mt-4 font-serif text-6xl leading-[0.9] tracking-[-0.05em] sm:text-7xl">
            Koenji
          </h3>
          <p className="mt-4 text-sm">高円寺 · Suginami City</p>
          <p className="mt-10 font-serif text-xl leading-8 italic text-[#695e55]">
            “Enough city to feel connected. Enough neighborhood to feel known.”
          </p>
          <div className="mt-10 flex gap-8 border-t border-[#332b25]/20 pt-5">
            <div>
              <p className="text-[9px] font-semibold uppercase">Match</p>
              <p className="mt-1 text-3xl font-semibold">88</p>
            </div>
            <div>
              <p className="text-[9px] font-semibold uppercase">Est. rent</p>
              <p className="mt-1 text-3xl font-semibold">¥174k</p>
            </div>
          </div>
        </div>
        <div className="p-5 sm:p-8">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold">Your day, modeled</p>
            <button
              type="button"
              className="text-[10px] font-semibold underline underline-offset-4"
            >
              CHANGE DAY
            </button>
          </div>
          <ol className="mt-6 grid gap-2 sm:grid-cols-2">
            {moments.map(([time, title, note, color], index) => (
              <li key={time} className={`relative min-h-40 p-5 ${color}`}>
                <span className="font-mono text-xs">{time}</span>
                <p className="mt-8 text-lg font-semibold">{title}</p>
                <p className="mt-2 text-xs opacity-65">{note}</p>
                <span className="absolute top-4 right-4 font-serif text-3xl opacity-20">
                  0{index + 1}
                </span>
              </li>
            ))}
          </ol>
          <div className="mt-5 flex flex-col gap-4 border-t border-[#332b25]/20 pt-5 sm:flex-row sm:items-center sm:justify-between">
            <p className="max-w-md text-[10px] leading-5 text-[#756a61]">
              A narrative layer built from commute, amenities, quietness, and neighborhood
              character—not invented testimonials.
            </p>
            <button
              type="button"
              className="flex shrink-0 items-center gap-3 bg-[#332b25] px-4 py-3 text-xs font-semibold text-white"
            >
              Explore Koenji <ArrowIcon />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function AtlasWorkbenchPreview() {
  return (
    <div className="overflow-hidden border border-[#24352d]/20 bg-[#edf0e8] text-[#1b2b24] shadow-[0_26px_80px_rgba(42,59,49,0.17)]">
      <div className="flex items-center justify-between border-b border-[#24352d]/20 bg-[#f8f5ed] px-5 py-4 sm:px-7">
        <div className="flex items-center gap-3 text-sm font-semibold">
          <span className="grid size-8 place-items-center bg-[#dc5538] text-[10px] text-white">
            東京
          </span>{" "}
          Atlas Workbench
        </div>
        <div className="flex items-center gap-4 text-[9px] font-semibold tracking-[0.14em] uppercase">
          <span className="hidden text-[#65736b] sm:inline">8 qualified / 23 modeled</span>
          <button type="button" className="border border-[#24352d]/25 px-3 py-2 hover:bg-white">
            Save search
          </button>
        </div>
      </div>
      <div className="grid min-h-[590px] lg:grid-cols-[300px_1fr]">
        <aside className="relative z-10 border-b border-[#24352d]/20 bg-[#f8f5ed] p-5 lg:border-r lg:border-b-0 sm:p-6">
          <p className="text-[9px] font-semibold tracking-[0.15em] text-[#dc5538] uppercase">
            Search model
          </p>
          <h3 className="mt-3 text-3xl font-semibold tracking-[-0.045em]">
            Where should
            <br />
            Tokyo open up?
          </h3>
          <div className="mt-7 border-b-2 border-[#1b2b24] pb-3">
            <label
              htmlFor="workbench-destination"
              className="text-[8px] font-semibold text-[#6a7770] uppercase"
            >
              Destination
            </label>
            <input
              id="workbench-destination"
              readOnly
              value="Shibuya / 渋谷"
              className="mt-2 w-full bg-transparent text-lg font-semibold focus-visible:outline-2 focus-visible:outline-offset-2"
            />
          </div>
          <div className="mt-5 grid grid-cols-2 gap-px bg-[#24352d]/15">
            {[
              ["ARRIVE", "08:30"],
              ["MAX TIME", "45 min"],
              ["BUDGET", "¥200k"],
              ["LAYOUT", "1LDK"],
            ].map(([label, value]) => (
              <button
                key={label}
                type="button"
                className="bg-[#f8f5ed] p-3 text-left transition-colors hover:bg-white"
              >
                <span className="block text-[8px] text-[#7a847e]">{label}</span>
                <span className="mt-1 block text-xs font-semibold">{value}</span>
              </button>
            ))}
          </div>
          <div className="mt-6">
            <div className="flex items-center justify-between text-[9px] font-semibold">
              <span>LIFESTYLE WEIGHTS</span>
              <button type="button" className="text-[#dc5538]">
                EDIT
              </button>
            </div>
            {[
              ["Quiet", 82],
              ["Groceries", 68],
              ["Dining", 48],
              ["Green", 74],
            ].map(([label, value]) => (
              <div key={label} className="mt-3 flex items-center gap-3">
                <span className="w-14 text-[9px]">{label}</span>
                <div className="h-1 flex-1 bg-[#24352d]/10">
                  <div className="h-full bg-[#dc5538]" style={{ width: `${value}%` }} />
                </div>
              </div>
            ))}
          </div>
          <button
            type="button"
            className="mt-7 flex min-h-12 w-full items-center justify-between bg-[#1b2b24] px-4 text-xs font-semibold text-white transition-colors hover:bg-[#dc5538]"
          >
            Update the atlas <ArrowIcon />
          </button>
        </aside>
        <div className="relative min-h-[520px] overflow-hidden bg-[#b8c8bb]">
          <svg viewBox="0 0 900 590" aria-hidden="true" className="absolute inset-0 h-full w-full">
            <rect width="900" height="590" fill="#b8c8bb" />
            <path
              d="M-40 470C145 364 250 430 396 310S655 216 950 50"
              fill="none"
              stroke="#d9e3d9"
              strokeWidth="70"
            />
            <path
              d="M-20 145C170 210 300 72 455 150S715 208 930 128"
              fill="none"
              stroke="#f2f2e9"
              strokeWidth="25"
            />
            <path
              d="M210-30C180 146 302 188 245 342S280 515 390 630"
              fill="none"
              stroke="#f2f2e9"
              strokeWidth="20"
            />
            <g fill="none" stroke="#718b79" strokeWidth="1" opacity=".7">
              <path d="M30 30h170v90H30zM265 22h155v105H265zM500 35h140v102H500zM694 25h170v110H694z" />
              <path d="M42 245h140v95H42zM328 235h126v90H328zM565 230h132v108H565zM735 248h130v91H735z" />
              <path d="M45 420h180v115H45zM330 400h155v140H330zM590 416h120v103H590zM750 401h120v135H750z" />
            </g>
          </svg>
          <div className="absolute top-4 left-4 flex gap-1 bg-[#f8f5ed] p-1 text-[9px] font-semibold shadow-sm">
            <button type="button" className="bg-[#1b2b24] px-3 py-2 text-white">
              MATCH
            </button>
            <button type="button" className="px-3 py-2">
              COMMUTE
            </button>
            <button type="button" className="px-3 py-2">
              RENT
            </button>
          </div>
          {[
            ["20%", "35%", "1"],
            ["49%", "24%", "2"],
            ["72%", "43%", "3"],
            ["40%", "69%", "4"],
          ].map(([left, top, label], index) => (
            <button
              key={label}
              type="button"
              style={{ left, top }}
              aria-label={`Open atlas result ${label}`}
              className={`absolute grid size-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 border-[#f8f5ed] text-xs font-bold text-white shadow-md transition-transform hover:scale-110 ${index === 0 ? "bg-[#dc5538]" : "bg-[#1b2b24]"}`}
            >
              {label}
            </button>
          ))}
          <div className="absolute right-4 bottom-4 left-4 grid gap-px bg-[#24352d]/20 shadow-[0_16px_50px_rgba(31,48,39,.18)] sm:grid-cols-3">
            {[
              ["01", "Musashi-Koyama", "24m · ¥182k", "91.4"],
              ["02", "Nishi-Ogikubo", "22m · ¥176k", "89.7"],
              ["03", "Gakugei-daigaku", "18m · ¥196k", "87.2"],
            ].map(([rank, name, meta, score], index) => (
              <button
                key={name}
                type="button"
                className={`grid grid-cols-[28px_1fr_auto] items-center gap-2 p-3 text-left transition-colors hover:bg-white ${index === 0 ? "bg-[#fffdf8]" : "bg-[#f2f1e9]"}`}
              >
                <span className="font-mono text-[8px] text-[#7a847e]">{rank}</span>
                <span>
                  <span className="block text-[10px] font-semibold">{name}</span>
                  <span className="mt-1 block text-[8px] text-[#6d7971]">{meta}</span>
                </span>
                <span className="font-mono text-sm text-[#dc5538]">{score}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function MidnightAtlasPreview() {
  return (
    <div className="overflow-hidden border border-[#81d8ff]/20 bg-[#071018] font-mono text-[#edf8ff] shadow-[0_28px_90px_rgba(0,7,14,0.42)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#81d8ff]/15 px-5 py-3 text-[9px] tracking-[0.14em] uppercase sm:px-7">
        <div className="flex items-center gap-3">
          <span className="size-2 bg-[#b8f05a] shadow-[0_0_14px_rgba(184,240,90,.65)]" /> Tokyo /
          live model
        </div>
        <div className="flex gap-5 text-white/40">
          <span>Data 08:41 JST</span>
          <span className="hidden sm:inline">⌘K Command</span>
        </div>
      </div>
      <div className="grid min-h-[610px] lg:grid-cols-[1fr_330px]">
        <div className="relative min-h-[500px] overflow-hidden border-b border-[#81d8ff]/15 bg-[radial-gradient(circle_at_48%_48%,#102b3c_0,#071018_66%)] lg:border-r lg:border-b-0">
          <svg viewBox="0 0 900 610" aria-hidden="true" className="absolute inset-0 h-full w-full">
            <g fill="none" stroke="#24485c" strokeWidth="1" opacity=".8">
              <path
                d="M0 130h900M0 305h900M0 480h900M180 0v610M450 0v610M720 0v610"
                strokeDasharray="3 8"
              />
              <path
                d="M-50 520C150 380 280 450 410 315S670 200 960 40"
                stroke="#18394a"
                strokeWidth="56"
              />
            </g>
            <g fill="none" strokeWidth="3">
              <path d="M432 308L145 140" stroke="#ffd65a" />
              <path d="M432 308L724 101" stroke="#6de3ae" />
              <path d="M432 308L778 420" stroke="#bb8cff" />
              <path d="M432 308L230 520" stroke="#69cfff" />
              <path d="M432 308L126 340" stroke="#ff7058" />
            </g>
            <g fill="#edf8ff">
              {[
                [145, 140],
                [724, 101],
                [778, 420],
                [230, 520],
                [126, 340],
              ].map(([cx, cy], index) => (
                <circle key={index} cx={cx} cy={cy} r="5" />
              ))}
              <circle cx="432" cy="308" r="9" fill="#ff7058" />
            </g>
          </svg>
          <div className="absolute top-5 right-5 left-5 flex items-center gap-3 border border-[#81d8ff]/25 bg-[#091722]/95 px-4 py-3 shadow-[0_16px_50px_rgba(0,0,0,.25)]">
            <span className="text-[#b8f05a]">›</span>
            <label htmlFor="midnight-command" className="sr-only">
              Search command
            </label>
            <input
              id="midnight-command"
              readOnly
              value="destination: shibuya  arrival: 08:30  max: 45m"
              className="min-w-0 flex-1 bg-transparent text-[10px] text-[#edf8ff] focus-visible:outline-2 focus-visible:outline-offset-2"
            />
            <span className="text-[8px] text-white/35">RUN ↵</span>
          </div>
          <div className="absolute top-20 left-5 flex gap-1 text-[8px]">
            <button type="button" className="bg-[#edf8ff] px-3 py-2 text-[#071018]">
              REACH
            </button>
            <button
              type="button"
              className="border border-[#81d8ff]/20 bg-[#091722]/80 px-3 py-2 text-white/55"
            >
              FIT
            </button>
            <button
              type="button"
              className="border border-[#81d8ff]/20 bg-[#091722]/80 px-3 py-2 text-white/55"
            >
              RENT
            </button>
          </div>
          <div className="absolute top-[48%] left-[48%] -translate-x-1/2 -translate-y-1/2 bg-[#ff7058] px-3 py-2 text-[9px] font-bold text-[#071018] shadow-[0_0_28px_rgba(255,112,88,.4)]">
            SHIBUYA / 渋谷
          </div>
          {[
            ["13%", "20%", "NISHI-OGIKUBO · 29m"],
            ["66%", "17%", "KITA-SENJU · 32m"],
            ["66%", "66%", "MUSASHI-KOYAMA · 24m"],
            ["16%", "76%", "SANGENJAYA · 16m"],
          ].map(([left, top, label]) => (
            <button
              key={label}
              type="button"
              style={{ left, top }}
              className="absolute border border-[#81d8ff]/30 bg-[#091722]/90 px-3 py-2 text-[8px] text-white/65 transition-colors hover:border-[#b8f05a] hover:text-[#b8f05a]"
            >
              {label}
            </button>
          ))}
          <div className="absolute right-5 bottom-5 left-5 flex flex-wrap gap-5 border-t border-[#81d8ff]/20 bg-[#071018]/85 px-4 py-3 text-[8px] text-white/40 backdrop-blur-sm">
            <span>
              <b className="mr-2 text-[#b8f05a]">47</b>REACHABLE
            </span>
            <span>
              <b className="mr-2 text-[#b8f05a]">12</b>IN BUDGET
            </span>
            <span>
              <b className="mr-2 text-[#b8f05a]">8</b>QUALIFIED
            </span>
          </div>
        </div>
        <aside className="bg-[#0a1620]">
          <div className="border-b border-[#81d8ff]/15 p-5">
            <p className="text-[8px] tracking-[0.14em] text-[#b8f05a] uppercase">
              Ranked live output
            </p>
            <div className="mt-2 flex items-end justify-between">
              <h3 className="font-sans text-2xl font-medium tracking-[-0.04em]">Best matches</h3>
              <span className="text-[8px] text-white/35">SCORE ↓</span>
            </div>
          </div>
          {[
            ["01", "Musashi-Koyama", "武蔵小山", "24m", "¥182k", "91.4"],
            ["02", "Nishi-Ogikubo", "西荻窪", "22m", "¥176k", "89.7"],
            ["03", "Gakugei-daigaku", "学芸大学", "18m", "¥196k", "87.2"],
          ].map((row, index) => (
            <button
              key={row[1]}
              type="button"
              className={`grid w-full grid-cols-[30px_1fr_auto] items-start border-b border-[#81d8ff]/10 p-4 text-left transition-colors hover:bg-white/[0.04] ${index === 0 ? "bg-[#b8f05a]/[0.05]" : ""}`}
            >
              <span className="text-[9px] text-white/30">{row[0]}</span>
              <span>
                <span className="block font-sans text-sm font-medium">{row[1]}</span>
                <span className="mt-1 block text-[8px] text-white/35">
                  {row[2]} · {row[3]} · {row[4]}
                </span>
                <span className="mt-3 block text-[8px] text-[#69cfff]">QUIET ↑ · GROCERY ↑</span>
              </span>
              <span className="text-lg text-[#b8f05a]">{row[5]}</span>
            </button>
          ))}
          <div className="p-5">
            <p className="text-[8px] leading-5 text-white/35">
              Confidence and source detail stay one keystroke away; the initial view only shows
              decision-critical evidence.
            </p>
            <button
              type="button"
              className="mt-5 flex min-h-11 w-full items-center justify-between border border-[#81d8ff]/25 px-4 text-[9px] transition-colors hover:border-[#b8f05a] hover:text-[#b8f05a]"
            >
              OPEN INSPECTOR <span>I</span>
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}

function DirectionSection({
  direction,
  selected,
  onSelect,
  children,
  dark = false,
}: {
  direction: (typeof DIRECTIONS)[number];
  selected: boolean;
  onSelect: (id: DirectionId) => void;
  children: React.ReactNode;
  dark?: boolean;
}) {
  return (
    <article
      id={direction.id}
      className={`scroll-mt-16 border-t px-5 py-20 sm:px-8 lg:px-12 lg:py-28 ${dark ? "border-white/15 bg-[#171916] text-white" : "border-stone-300"}`}
    >
      <div className="mx-auto max-w-[1320px]">
        <div className="mb-10 grid gap-8 lg:grid-cols-[110px_1fr_300px] lg:items-start">
          <p className={`font-mono text-xs ${dark ? "text-[#b7f34b]" : "text-[#b7472a]"}`}>
            {direction.number} / 10
          </p>
          <div>
            <h2 className="text-4xl font-semibold tracking-[-0.045em] sm:text-6xl">
              {direction.title}
            </h2>
            <p
              className={`mt-4 max-w-2xl text-lg leading-7 sm:text-xl ${dark ? "text-white/60" : "text-stone-600"}`}
            >
              {direction.thesis}
            </p>
          </div>
          <div
            className={`space-y-4 border-l pl-5 text-xs leading-5 ${dark ? "border-white/20 text-white/55" : "border-stone-300 text-stone-600"}`}
          >
            <p>
              <span className={`block font-semibold ${dark ? "text-white" : "text-stone-950"}`}>
                Strongest at
              </span>
              {direction.bestFor}
            </p>
            <p>
              <span className={`block font-semibold ${dark ? "text-white" : "text-stone-950"}`}>
                Watch out for
              </span>
              {direction.risk}
            </p>
          </div>
        </div>
        {children}
        <div className="mt-7 flex flex-wrap items-center justify-between gap-4">
          <p className={`max-w-xl text-xs leading-5 ${dark ? "text-white/45" : "text-stone-500"}`}>
            This is a mood and interaction study—not a proposed final screen. The best direction can
            borrow selected behaviors from the others.
          </p>
          <DirectionButton
            id={direction.id}
            selected={selected}
            onSelect={onSelect}
            inverted={dark}
          />
        </div>
      </div>
    </article>
  );
}

export default function DirectionsPage() {
  const [selectedDirection, setSelectedDirection] = useState<DirectionId | null>("atlas-workbench");
  const selected = DIRECTIONS.find((direction) => direction.id === selectedDirection);

  return (
    <main className="min-h-screen bg-[#f4f2ed] font-sans text-stone-950 antialiased [&_button]:focus-visible:outline-2 [&_button]:focus-visible:outline-offset-2 [&_button]:focus-visible:outline-current">
      <header className="border-b border-stone-300 px-5 sm:px-8 lg:px-12">
        <div className="mx-auto flex max-w-[1320px] items-center justify-between py-4 text-[10px] font-semibold tracking-[0.15em] uppercase">
          <span>Matchi</span>
          <span className="text-stone-500">Frontend direction study · 24 Aug 2026</span>
        </div>
      </header>

      <section className="px-5 py-20 sm:px-8 lg:px-12 lg:py-28">
        <div className="mx-auto grid max-w-[1320px] gap-12 lg:grid-cols-[1fr_330px] lg:items-end">
          <div>
            <p className="mb-7 flex items-center gap-3 text-[10px] font-semibold tracking-[0.16em] text-[#b7472a] uppercase">
              <span className="h-px w-8 bg-[#b7472a]" /> A choice about character, not decoration
            </p>
            <h1 className="max-w-5xl text-5xl leading-[0.95] font-semibold tracking-[-0.06em] sm:text-7xl lg:text-[104px]">
              Ten ways this product could feel.
            </h1>
          </div>
          <div className="border-l border-stone-300 pl-6">
            <p className="text-sm leading-6 text-stone-600">
              The current product has the right ingredients. These directions explore how Tokyo,
              travel time, evidence, and lived experience could shape the product.
            </p>
            <p className="mt-6 text-xs font-semibold">Scroll to compare ↓</p>
          </div>
        </div>
      </section>

      <nav
        aria-label="Design directions"
        className="sticky top-0 z-40 overflow-x-auto border-y border-stone-300 bg-[#f4f2ed]/95 backdrop-blur-sm"
      >
        <div className="mx-auto flex min-w-max max-w-[1320px] px-5 sm:px-8 lg:px-12">
          {DIRECTIONS.map((direction) => (
            <a
              key={direction.id}
              href={`#${direction.id}`}
              className="flex min-h-14 items-center gap-3 border-r border-stone-300 px-5 text-[10px] font-semibold tracking-[0.1em] uppercase transition-colors first:border-l hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-stone-950"
            >
              <span className="font-mono text-stone-400">{direction.number}</span>
              {direction.title}
            </a>
          ))}
        </div>
      </nav>

      <DirectionSection
        direction={DIRECTIONS[0]!}
        selected={selectedDirection === "field-guide"}
        onSelect={setSelectedDirection}
      >
        <FieldGuidePreview />
      </DirectionSection>

      <DirectionSection
        direction={DIRECTIONS[1]!}
        selected={selectedDirection === "transit-desk"}
        onSelect={setSelectedDirection}
        dark
      >
        <TransitDeskPreview />
      </DirectionSection>

      <DirectionSection
        direction={DIRECTIONS[2]!}
        selected={selectedDirection === "living-atlas"}
        onSelect={setSelectedDirection}
      >
        <LivingAtlasPreview />
      </DirectionSection>

      <DirectionSection
        direction={DIRECTIONS[3]!}
        selected={selectedDirection === "decision-map"}
        onSelect={setSelectedDirection}
      >
        <DecisionMapPreview />
      </DirectionSection>

      <DirectionSection
        direction={DIRECTIONS[4]!}
        selected={selectedDirection === "commute-constellation"}
        onSelect={setSelectedDirection}
        dark
      >
        <CommuteConstellationPreview />
      </DirectionSection>

      <DirectionSection
        direction={DIRECTIONS[5]!}
        selected={selectedDirection === "shortlist-studio"}
        onSelect={setSelectedDirection}
      >
        <ShortlistStudioPreview />
      </DirectionSection>

      <DirectionSection
        direction={DIRECTIONS[6]!}
        selected={selectedDirection === "neighborhood-signal"}
        onSelect={setSelectedDirection}
      >
        <NeighborhoodSignalPreview />
      </DirectionSection>

      <DirectionSection
        direction={DIRECTIONS[7]!}
        selected={selectedDirection === "tokyo-week"}
        onSelect={setSelectedDirection}
      >
        <TokyoWeekPreview />
      </DirectionSection>

      <DirectionSection
        direction={DIRECTIONS[8]!}
        selected={selectedDirection === "atlas-workbench"}
        onSelect={setSelectedDirection}
      >
        <AtlasWorkbenchPreview />
      </DirectionSection>

      <DirectionSection
        direction={DIRECTIONS[9]!}
        selected={selectedDirection === "midnight-atlas"}
        onSelect={setSelectedDirection}
        dark
      >
        <MidnightAtlasPreview />
      </DirectionSection>

      <section className="border-t border-stone-300 bg-[#ebe8e0] px-5 py-20 sm:px-8 lg:px-12 lg:py-28">
        <div className="mx-auto max-w-[1320px]">
          <div className="grid gap-10 lg:grid-cols-[1fr_1.5fr]">
            <div>
              <p className="text-[10px] font-semibold tracking-[0.16em] text-[#b7472a] uppercase">
                A point of view
              </p>
              <h2 className="mt-4 text-4xl font-semibold tracking-[-0.045em] sm:text-6xl">
                The mix is
                <br />
                the direction.
              </h2>
            </div>
            <div className="max-w-2xl">
              <p className="text-xl leading-8 text-stone-700">
                Direction 09 is the strongest all-round synthesis: the city remains the emotional
                entry point, while a persistent workbench makes every recommendation understandable
                and adjustable.
              </p>
              <p className="mt-5 text-sm leading-6 text-stone-600">
                Direction 10 uses the same information architecture with a more opinionated
                technical identity. Choose 09 for broader trust and residential warmth; choose 10 if
                the product should feel like a uniquely powerful Tokyo intelligence tool.
              </p>
            </div>
          </div>

          <div className="mt-14 overflow-x-auto border-t border-stone-400">
            <table className="w-full min-w-[760px] border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-stone-400">
                  <th className="py-4 pr-6 font-semibold">Direction</th>
                  <th className="px-4 py-4 font-semibold">First impression</th>
                  <th className="px-4 py-4 font-semibold">Information density</th>
                  <th className="px-4 py-4 font-semibold">Best device</th>
                  <th className="py-4 pl-4 font-semibold">Product role</th>
                </tr>
              </thead>
              <tbody className="text-stone-600">
                <tr className="border-b border-stone-300">
                  <td className="py-4 pr-6 font-semibold text-stone-950">01 Field Guide</td>
                  <td className="px-4 py-4">Human, cultured</td>
                  <td className="px-4 py-4">Relaxed</td>
                  <td className="px-4 py-4">Desktop / tablet</td>
                  <td className="py-4 pl-4">Brand layer</td>
                </tr>
                <tr className="border-b border-stone-300">
                  <td className="py-4 pr-6 font-semibold text-stone-950">02 Transit Desk</td>
                  <td className="px-4 py-4">Exact, capable</td>
                  <td className="px-4 py-4">High</td>
                  <td className="px-4 py-4">Desktop</td>
                  <td className="py-4 pl-4">Expert mode</td>
                </tr>
                <tr className="border-b border-stone-300">
                  <td className="py-4 pr-6 font-semibold text-stone-950">03 Living Atlas</td>
                  <td className="px-4 py-4">Expansive, inviting</td>
                  <td className="px-4 py-4">Focused</td>
                  <td className="px-4 py-4">All</td>
                  <td className="py-4 pl-4">Landing page</td>
                </tr>
                <tr className="border-b border-stone-300">
                  <td className="py-4 pr-6 font-semibold text-stone-950">04 Decision Map</td>
                  <td className="px-4 py-4">Clear, exploratory</td>
                  <td className="px-4 py-4">Balanced</td>
                  <td className="px-4 py-4">All</td>
                  <td className="py-4 pl-4">Results workspace</td>
                </tr>
                <tr className="border-b border-stone-300">
                  <td className="py-4 pr-6 font-semibold text-stone-950">
                    05 Commute Constellation
                  </td>
                  <td className="px-4 py-4">Distinctive, spatial</td>
                  <td className="px-4 py-4">Balanced</td>
                  <td className="px-4 py-4">Desktop / tablet</td>
                  <td className="py-4 pl-4">Signature mechanic</td>
                </tr>
                <tr className="border-b border-stone-300">
                  <td className="py-4 pr-6 font-semibold text-stone-950">06 Shortlist Studio</td>
                  <td className="px-4 py-4">Intentional, capable</td>
                  <td className="px-4 py-4">High</td>
                  <td className="px-4 py-4">Desktop</td>
                  <td className="py-4 pl-4">Comparison</td>
                </tr>
                <tr className="border-b border-stone-300">
                  <td className="py-4 pr-6 font-semibold text-stone-950">07 Neighborhood Signal</td>
                  <td className="px-4 py-4">Bold, decisive</td>
                  <td className="px-4 py-4">Compressed</td>
                  <td className="px-4 py-4">Mobile / social</td>
                  <td className="py-4 pl-4">Results summary</td>
                </tr>
                <tr className="border-b border-stone-300">
                  <td className="py-4 pr-6 font-semibold text-stone-950">08 A Week in Tokyo</td>
                  <td className="px-4 py-4">Human, imaginable</td>
                  <td className="px-4 py-4">Relaxed</td>
                  <td className="px-4 py-4">All</td>
                  <td className="py-4 pl-4">Detail page</td>
                </tr>
                <tr className="border-b border-stone-300 bg-white/60">
                  <td className="py-4 pr-6 font-semibold text-[#b7472a]">09 Atlas Workbench ★</td>
                  <td className="px-4 py-4">Inviting, capable</td>
                  <td className="px-4 py-4">Progressive</td>
                  <td className="px-4 py-4">All</td>
                  <td className="py-4 pl-4">Core synthesis</td>
                </tr>
                <tr className="border-b border-stone-300">
                  <td className="py-4 pr-6 font-semibold text-stone-950">10 Midnight Atlas</td>
                  <td className="px-4 py-4">Technical, magnetic</td>
                  <td className="px-4 py-4">High</td>
                  <td className="px-4 py-4">Desktop / tablet</td>
                  <td className="py-4 pl-4">Power synthesis</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section
        aria-live="polite"
        className="border-t border-stone-300 bg-[#f4f2ed] px-5 py-14 sm:px-8 lg:px-12"
      >
        <div className="mx-auto flex max-w-[1320px] flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[10px] font-semibold tracking-[0.15em] text-stone-500 uppercase">
              Current selection
            </p>
            <p className="mt-2 text-2xl font-semibold tracking-[-0.03em]">
              {selected ? `${selected.number} — ${selected.title}` : "No direction selected"}
            </p>
          </div>
          <a
            href="#field-guide"
            className="inline-flex min-h-11 items-center gap-2 self-start border border-stone-400 px-4 text-xs font-semibold tracking-[0.08em] uppercase transition-colors hover:border-stone-950 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-stone-950"
          >
            <PlusIcon /> Review again
          </a>
        </div>
      </section>
    </main>
  );
}

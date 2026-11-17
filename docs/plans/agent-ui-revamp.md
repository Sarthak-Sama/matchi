# /agent UI/UX revamp — implementation plan

**Executor:** GPT Sol 6.1 (coding agent) · **Branch / worktree:** `feat/ui-ux-polish` at `../matchi-ui-polish`
**Scope:** the `/agent` page only — files under `web/app/agent/**`. Nothing else in the repo changes.

---

## 0. The problem, in the owner's words

1. "A lot of things on screen, very cluttered and hard to use, navigate and understand."
2. "Looks like a complicated dashboard rather than an easy to use, friendly chat and recommendation tool."

Every decision below serves one goal: **turn an engine debug console into a friendly conversation that
produces a short, understandable list of neighborhoods.** If a choice makes the page look more like a dashboard,
it is the wrong choice.

### The target experience in one paragraph

You land on a calm page with one greeting and one text box. You type how your week works, or tap a starter.
The guide replies in plain language and asks one question at a time, with tappable answers. A short list of
three to five neighborhoods appears beside the chat as simple cards: name, rent, commute, and one line on why each fits. You react
with "Love it" or "Not for me" and the list visibly re-orders. The numbers behind each card and the trace sit one tap away,
under "Show the working", and nobody has to look at them.

---

## 1. Hard constraints (read before writing code)

1. **Only edit files in `web/app/agent/`.** New files go in `web/app/agent/components/` or `web/app/agent/lib/`.
   Do **not** edit `web/app/globals.css`, `web/app/components/*` (including `Masthead.tsx`, `icons.tsx`), `web/lib/*`,
   `shared/`, `api/`, or the `/` and `/find` pages. Importing from shared components (e.g. `../components/icons`)
   is fine; modifying them is not.
2. **Do not change behaviour of `web/app/agent/lib/useAgent.ts`.** Every existing call (`sendMessage`, `saveProfile`,
   `addEvidence`, `removeEvidence`, `putBack`, `recommend`, `whyNot`, `compare`, `relax`, `startSession`,
   `retryChat`, `dismissNotice`) must keep working with the same semantics. You may *add* derived values or
   small helpers in new files (`lib/derive.ts`). Keep `lib/evidence.ts`, `lib/explain.ts`, `lib/profile.ts`,
   `lib/client.ts`, `lib/sse.ts` untouched unless a pure display helper is added.
3. **No feature may be lost.** Everything that exists today must still be reachable (see §3 inventory).
   "Hidden behind *Show the working*" counts as reachable; "deleted" does not.
4. **Keep every `data-testid`** that exists today (`chat-log`, `profile-result`, `shortlist-card`, `risk-line`,
   `relax-list`, `excluded`, `explanation`, `evidence-chips`, `removed-chips`, `belief-bars`, `trace`) on the
   element that carries the equivalent content.
5. **No new dependencies.** Available: React 19, Next 15 App Router, Tailwind v4, `motion` (`motion/react`).
6. **Use the existing design tokens** from `web/app/globals.css` (`paper`, `paper-soft`, `ink`, `ink-muted`, `moss`,
   `moss-deep`, `vermilion`, `vermilion-deep`, `stone`, `sage`, `sage-deep`, `warning`, `brick`, `line`,
   `line-strong`; fonts `font-serif` (Newsreader), `font-sans` (Archivo), `font-mono` (Plex Mono); utilities
   `label-utility`, `tnum`, `field-control`, `skeleton`). The site is a warm "field guide": paper, ink, hairline
   rules, square corners, no drop shadows. Stay inside that language — friendly does **not** mean rounded
   bubbles and gradients. It means fewer things, plainer words, bigger targets, one obvious next step.
7. Already done: `web/app/agent/components/ui.ts` has refined button tokens (`btn`, `btnPrimary`, `linkBtn`,
   `panel`, `eyebrow`, `sectionTitle`). Reuse them; adjust if needed.

---

## 2. Diagnosis of the current page (why it feels like a dashboard)

Current tree (`web/app/agent/page.tsx`): a heading, then a 2-column grid of **eight bordered panels of equal
weight**:

| Left column | Right column |
|---|---|
| Chat (log capped at `max-h-80`) | Shortlist status (risk ¥, ESS, feasible count, next question, alternative, Recompute, Relax) |
| "Your situation" form (7 fields) | 5 shortlist cards, each with 4 stats, a 4–14 row yen bar chart, 3–4 confidence tags, 4 buttons |
| "Quick answers (no model)" (Quieter/Cheaper/Closer, strength select, feature select + More/Less, locality-id why-not, compare) | "Left out of the search" table (6 counts, mostly 0) |
| Trace (raw tool-call log) | "What you have told me" chips |
| | "What I think matters to you" (13 belief bars + 2 params, "effective sample 2231") |
| Footer: raw session UUID + Start over | |

Specific problems:

- **No hierarchy.** The chat, which is the main way in, has the same box, border and label as the trace log.
- **Engine vocabulary on the surface:** "effective sample", "regret if wrong", "chance of being best 0%",
  "Rent: distant price point", "Access data: low", "−¥105,455" bars, "lambda/gamma" params, "Locality id".
- **Too many simultaneous inputs.** There are three competing ways to give input: chat, the form, and quick answers. All are visible at once.
- **The core loop is invisible.** The guide's next question is small grey text inside a status panel. Re-ranking
  has no motion, and there is no "working" state.
- **Layout dead space.** The left column ends around 1,400px down while the right column runs to about 4,000px. The chat scrolls off screen while you read
  cards.
- **Rough details:** Japanese names printed twice (`大宮 / 大宮 · Suginami`); "Why not top pick?" on the top pick;
  "0%" where the value is tiny; notices render at the page top, out of view; the Masthead's "How it works" and "New
  search" link to anchors that don't exist on this page; the chat's `scrollIntoView` can scroll the whole window.

---

## 3. Inventory → disposition (nothing is lost, most things move)

**Tier A — Always visible.** **Tier B — One tap away**: inline expand or a sheet. **Tier C — "Show the working"** drawer, for transparency and debugging.

| Today | New home | Tier |
|---|---|---|
| Chat log + input | Main conversation column, full height | A |
| Next question (pair / pick / profile_fact) | **Inline in the conversation** as a "guide asks" turn with tappable reply chips | A |
| Shortlist cards | Simplified cards in the "Your shortlist" pane | A |
| Like / Not this | Card buttons "Love it" / "Not for me" | A |
| Prefer this (over neighbour) | Inside card detail sheet: "Prefer over {neighbour name}" | B |
| Why not top pick? | Inside card detail sheet (hidden for #1) | B |
| Card stats: rent, commute | On card | A |
| Card stats: travel h/mo, regret ¥ | Card detail sheet | B |
| Yen breakdown bars | Card detail sheet, titled "How this adds up" | B |
| Confidence tags | Card detail sheet ("How sure is this?") — but surface one plain warning on the card if rent is ward-level or access data is low: "Rough estimate" | A (flag) / B |
| Role ("Best if you care more about X") | Card one-liner, rewritten plainly (§6.4) | A |
| pBest | Small "match strength" indicator on card, words not 0% (§6.4) | A |
| "What you have told me" chips + removed/put back | **"Your brief"** strip at top of the shortlist pane (chips, removable, undo) | A |
| Profile form | **"Edit details" sheet** (opened from Your brief, from profile_fact questions, or from the empty state) | B |
| profile result (feasible count, refused anchors, missing) | Toast + inline line in the sheet | B |
| Quieter / Cheaper / Closer | **Suggestion chips above the composer** ("Quieter", "Cheaper", "Closer to work") | A |
| Strength select, feature More/Less | Show the working → "Fine-tune" | C |
| Why-not by locality id, Compare A vs B | Show the working → "Fine-tune" (compare also reachable from the detail sheet: "Compare with…") | C/B |
| Explanation output (why_not / compare / relax) | Rendered as a **guide turn in the conversation** (it is an answer) and mirrored in the drawer | A |
| Risk line (¥ uncertainty), shouldStop | Plain "How well I know you" meter in the shortlist header (§6.5); exact ¥ in drawer | A (meter) / C |
| Alternative ("if I'm wrong…") | One muted line under the shortlist: "Not sure? {Name} wins if {plain param} matters more." | A |
| Recompute / Relax limits | Recompute → drawer. Relax → shown **only when it matters** (shortlist empty or `rec.relax` present) as a friendly prompt | A (contextual) / C |
| Left out of the search | Drawer; and a single line in the empty-shortlist state | C |
| Belief bars ("what I think matters") | Drawer "What I think matters to you" (keep the chart, keep its explanation) | C |
| Trace | Drawer "Trace" | C |
| Session id | Drawer footer | C |
| Start over | Header, quiet text button with inline confirm | A |
| Notices | Toast stack, bottom-right (bottom-center on mobile) | A |
| Session error | Full-pane friendly error state with Retry | A |

---

## 4. New information architecture

```
AgentPage
├── AgentHeader           (agent-specific; replaces shared Masthead on this page only)
│     logo/home link · "Guide" title · [Show the working] toggle · [Start over]
├── main (2 panes ≥1024px; single column + bottom sheet <1024px)
│   ├── ConversationPane  (primary, ~58%)
│   │     Welcome (empty state) | Messages + inline Question turns + Explanation turns
│   │     Typing indicator
│   │     Composer: suggestion chips row · auto-growing textarea · Send
│   └── ShortlistPane     (secondary, ~42%, sticky, own scroll)
│         Header: "Your shortlist" · N areas fit · confidence meter
│         YourBrief strip (chips + "Edit details")
│         Cards (top 3 visible, "Show 2 more")
│         Alternative line · contextual Relax prompt
│         Empty / loading / no-fit states
├── DetailsSheet          (Edit details = existing ProfileForm, restyled)
├── AreaSheet             (one area's full working: breakdown, confidence, prefer, why-not, compare)
├── WorkingDrawer         (Tier C: Fine-tune, What I think matters, Left out, Trace, session id, Recompute)
└── Toasts
```

### Desktop (≥1024px)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ◆ Matchi 街 · Guide                          Show the working ◻   Start over │
├───────────────────────────────────────────────┬──────────────────────────────┤
│                                               │ YOUR SHORTLIST   5 areas fit │
│  GUIDE                                        │ How well I know you ▰▰▰▱▱    │
│  Noted: Shibuya, 5 days a week, about         │ ┌──────────────────────────┐ │
│  ¥150,000, and quiet matters a lot. What      │ │ Shibuya · ¥150k · Quiet ✕│ │
│  layout do you need?                          │ │              Edit details│ │
│   [1R] [1K] [1DK] [1LDK] [2LDK] [Other…]      │ └──────────────────────────┘ │
│                                               │ ┌ 1  Ōmiya  · Suginami ────┐ │
│                      I need a 1LDK ▐ (you)    │ │ ¥99,000/mo · 28 min       │ │
│                                               │ │ Leafy and calm; longer    │ │
│  GUIDE                                        │ │ ride than #2.             │ │
│  Quick one: which would you rather live in?   │ │ Strong match ▰▰▰▱         │ │
│   [ Hanegi ]   or   [ Ōmiya ]                 │ │ [♥ Love it] [Not for me] ›│ │
│                                               │ └───────────────────────────┘ │
│                                               │ ┌ 2  Hanegi · Setagaya ─────┐ │
│ ─────────────────────────────────────────────│ │ …                          │ │
│ [Quieter] [Cheaper] [Closer to work]          │ Show 2 more                  │
│ ┌───────────────────────────────────────┐ ➤  │ Not sure? Ōmiya wins if time │
│ │ Tell the guide about your week…        │    │ matters less to you.         │
│ └───────────────────────────────────────┘    │                              │
└───────────────────────────────────────────────┴──────────────────────────────┘
```

- Grid: `lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]`, page height = viewport minus header
  (`lg:h-[calc(100dvh-3.5rem)]`), each pane scrolls independently (`overflow-y-auto`, `overscroll-contain`).
  The page itself does not scroll on desktop.
- Max content width 1360px, side gutters `px-5 sm:px-8` to match the rest of the site.
- Conversation column text measure: max ~68ch, centred within its pane.

### Mobile / tablet (<1024px)

- Conversation is the whole screen; the composer is pinned to the bottom (`sticky bottom-0`, respect
  `env(safe-area-inset-bottom)`).
- A pinned **"Shortlist · 5" pill** sits above the composer. Tapping it opens a bottom sheet (85dvh) holding the ShortlistPane.
  When the shortlist changes, the pill pulses once and shows "↑ new #1" for 3s.
- Sheets (Details, Area, Working) are full-height bottom sheets on mobile, right-side panels (min(480px, 92vw))
  on desktop.
- Verify at 375×812, 768×1024, 1024×768, 1440×900. No horizontal scroll anywhere. Tap targets ≥ 44px.

---

## 5. The agent-specific header (`components/AgentHeader.tsx`)

The shared `Masthead` points to `#methodology` and `#search`, which don't exist on this page. Do **not** edit it.
Instead `/agent/page.tsx` renders a new `AgentHeader`:

- Left: the same logo treatment as Masthead (`/matchi-logo.png`, "Matchi", 街), linking to `/`. Then a thin divider and
  "Guide" in `label-utility`.
- Right: a `Show the working` toggle button (`aria-pressed`) that opens the WorkingDrawer, and `Start over`. Clicking
  Start over once changes it to "Start over? Yes / Cancel" for 4 seconds. Starting over wipes the conversation, so it should not
  happen on a single misclick. Disabled while `busy`.
- 56px tall, sticky, `bg-paper/95 backdrop-blur-sm border-b border-line`, matching the Masthead.
- Drop the big page H1 ("Tell the guide about your life…"). Its job moves to the welcome state (§6.1). Keep an `h1`
  for accessibility. It can be visually hidden, or it can be the welcome headline.

---

## 6. Component specs

### 6.1 ConversationPane (`components/Conversation.tsx`, replaces `Chat.tsx`'s layout; keep `Chat.tsx` filename or rename — update imports)

**Welcome (no messages yet):** vertically centred in the pane.
- Eyebrow `Meet your Matchi` (vermilion-deep), serif headline about 2.25rem: **"Where does your week happen?"**
- One sentence: "Tell me where you go, what you can spend and what you can't stand. I'll find the parts of Tokyo
  that fit, and show you the trade-offs."
- Three starter cards, full-width buttons with a hairline border and an arrow. Clicking one **sends it immediately**. That is one
  tap to value, and the user can correct things afterwards. Starters:
  - "I work near Shibuya five days a week, budget about ¥150,000, and I hate noise."
  - "I study at Hongo-sanchome, get home late, and want it cheap."
  - "Two office days in Otemachi. I want a park nearby and good food."
- Below, a quiet link: "Prefer a form? **Fill in the basics**", which opens the DetailsSheet.

**Messages:**
- User turns: right-aligned, `bg-sage/70`, square corners, max 85% width, sans 14.5px.
- Guide turns: left, no box. Above each one, a tiny `■ Guide` label in vermilion-deep. Body in **serif 16–17px, 1.5 leading**.
  This is the main brand moment: the guide reads like a field guide, not a chat widget.
- Grounding: on pass, a tiny moss `✓ Figures checked` with `title` explaining it. On fail, keep today's behaviour:
  strike through the caught message and show a brick left-rule note.
- New turns fade and rise in (8px, 240ms, `[0.22,0.61,0.36,1]`). Turn this off with `useReducedMotion`.
- Auto-scroll: `logRef.scrollTo({top: scrollHeight})` inside the pane, **never** `scrollIntoView`. Only auto-scroll
  if the user was already near the bottom (within 120px). Otherwise show a "↓ New reply" pill.
- Typing indicator while `streaming`: three small vermilion squares pulsing, plus "Reading the city…". Use `role="status"`.

**Inline question turns (the core loop):** after each `view.recommendation` change, if
`rec.nextQuestion && !rec.shouldStop`, append a **question turn** at the end of the log. It is client-side and is not
added to `agent.messages`. Derive it with `useMemo` from `view`, and render it after the messages.
- `pair`: serif "Quick one — which would you rather live in?", then two large choice buttons side by side with a
  small "or" between them. Under each name, show rent · commute from the shortlist item.
- `pick_from_shortlist`: "Which of these would you pick?" with stacked choice buttons.
- `profile_fact`: a friendly ask with an inline control:
  - `layout`: chips for each `LAYOUT_IDS` label → calls `saveProfile` with the layout set. Build the profile with
    the same `buildProfile(formFromProfile(view.profile)+layout)` path the form uses, so validation stays the same.
  - `budget`: a short ¥ input + "Set" button.
  - `anchor`: "Where do you need to be?" + a button "Choose a place" that opens DetailsSheet focused on the anchor field
    (or reuse the places combobox inline if straightforward).
  - `trips_per_week`: chips 1–7.
- Answer buttons call the same `agent.addEvidence([a.evidence])` / `saveProfile` as today. While `busy`, disable them and
  show the clicked one as "Got it…". After answering, the question turn collapses to a one-line receipt:
  "You picked Hanegi".
- If chat is **off**, these question turns are still the main interaction. The engine path works without the model,
  so the page stays useful.

**Explanation turns:** when `agent.explanation` changes (why_not / compare / relax), render it as a guide turn in the
log, using the existing `describeWhyNot`, `comparisonRows` and `RelaxList`. Keep `data-testid="explanation"` on it.

**Composer:**
- Suggestion chips row above the input: `Quieter`, `Cheaper`, `Closer to work`. These call `addEvidence([quieter()])`
  etc. with "normal" strength. Hide the row until a shortlist exists, and hide it on narrow screens while the input is
  focused.
- Auto-growing textarea, 1–5 lines. **Enter sends, Shift+Enter adds a new line.** Respect `isComposing` for Japanese IME
  (important for this product). Placeholder: "Tell the guide about your week…". While streaming: "The guide is answering…".
- Send: square moss button with arrow icon, `aria-label="Send message"`.
- Return focus to the textarea when a stream ends.

**Chat unavailable (`chatStatus === "off"`):** replace the composer with a calm panel: "Chat is resting right now —
you can still set your details and answer the guide's questions." Add two buttons: **Enter details** (opens the sheet) and
**Try chat again** (`retryChat`). The welcome state should point to the form instead of the starters in this mode.

### 6.2 ShortlistPane (`components/ShortlistPane.tsx`, replaces `Shortlist.tsx`'s top-level layout; keep exported `RelaxList` and `Excluded`)

Header:
- `Your shortlist` (serif 1.35rem), with "**{feasibleCount}** areas fit" in muted `tnum` on the right.
- **"How well I know you"** meter (§6.5).

**YourBrief strip** (replaces EvidenceChips as the always-visible version):
- One line of profile facts from `view.profile`: anchor label · `≤ N min` · `¥budget` · layout. Each comes from the
  profile, and missing ones show as dashed "+ layout" chips that open the DetailsSheet.
- Then evidence chips (the person's quote, or `describeEvidence`), each with an ✕. Removing one shows a toast with **Undo**,
  which calls `putBack`. That replaces the separate "Removed" list in Tier A. Keep the removed list in the drawer with
  `data-testid="removed-chips"`.
- **De-duplicate repeated identical quotes visually** ("I hate noise ×3"). Group by `quote+type` and show a count badge.
  Removing the group removes one at a time, so the behaviour stays honest.
- `Edit details` link at the end opens the DetailsSheet.
- Keep `data-testid="evidence-chips"` on the chip list.

**Area cards** (`components/AreaCard.tsx`): show the top 3. Below them, "Show {n} more" reveals the rest.
- Rank numeral in `font-mono` (1, 2, 3). The #1 card gets a 2px ink top rule and a "Top pick" eyebrow.
- Name: `areaName(item)` in serif 1.35rem. Subline: show `nameJa` **only if it differs from the heading**, then
  `wardNameEn`.
- Two facts, large and `tnum`: **¥99,122 /mo** (with a small "est." mark and a `title` explaining modelled rent) and
  **28 min** commute ("—" plus "add a destination" if there is no anchor).
- One-line **why** (§6.4).
- Match strength (§6.4).
- An optional "Rough estimate" flag (stone, small) when `confidence.rent === "ward_level"`-equivalent (anything that isn't
  `near_price_point`) or `confidence.access` is low.
- Actions: `♥ Love it` (likeArea) and `Not for me` (dislikeArea) as two equal buttons, plus a `Details ›` link that opens
  the AreaSheet. Remove "Prefer this" and "Why not top pick?" from the card face; they move to the sheet.
- Keep `data-testid="shortlist-card"` on each card `li`.
- **Re-rank animation:** wrap the list in `LayoutGroup`, give each `motion.li` `layout` and key it by
  `localityId`. Track the previous rank per id in a ref, and show a small badge for 4 seconds after a change: `▲2` (moss), `▼1`
  (brick) or `New` (vermilion). The badge needs an `aria-live="polite"` summary. The pane's sr-only live region should say
  "Shortlist updated: Hanegi moved to first."
- Busy (`agent.busy && view.recommendation`): set the cards to 60% opacity and `aria-busy`, and run a 2px indeterminate moss bar
  under the pane header. Never blank the list while recomputing.

Below the cards:
- Alternative line (muted): "Not sure? **{name}** comes out on top if {plain param} matters
  {more/less} to you." Use `rec.alternative`.
- Contextual relax: if `rec.shortlist.length === 0` **or** `rec.relax?.length`, show a friendly box: "Nothing
  fits every limit yet." Under it, the `RelaxList` options as buttons ("Allow up to ¥165,000 · +12 areas"). Clicking one
  updates the profile through `saveProfile` with the new budget or cap. If that is not cleanly possible, keep the list as
  information plus an `Edit details` button. Keep `data-testid="relax-list"`.

### 6.3 AreaSheet (`components/AreaSheet.tsx`)

This opens from a card's "Details". Use a dialog (`role="dialog"`, `aria-modal`, focus trap, Esc closes, return focus to the
trigger). Content:
1. Name, ward, rank, the same two big facts, and the why line.
2. **"How this adds up"**: today's yen breakdown bars (reuse the existing `breakdownRows` logic), titled with a single
   sentence: "Each bar is what this costs (−) or gives back (+) each month, at what I think you value."
   Keep "All N terms".
3. "Travel 20.0 h a month" and "If I'm wrong about you, picking this could cost about ¥7,694 a month". Label this
   plainly as "Cost if I've misread you".
4. **"How sure is this?"**: the confidence labels, rewritten (§6.6).
5. Actions: `Prefer over {neighbour name}` (preferOverNeighbour), `Why isn't this #1?` (whyNot; hidden for #1),
   `Compare with…` (a select of other shortlisted areas → `compare`). Results show inside the sheet **and** as a
   conversation turn.

### 6.4 Plain-language derivations (`lib/derive.ts`, pure functions + unit tests in `lib/derive.test.ts`)

- `matchStrength(pBest)`: `≥ .35` → "Strong match" (4/4), `≥ .15` → "Good match" (3/4), `≥ .05` → "Possible"
  (2/4), `> 0` → "Long shot" (1/4), `0` → "Outside chance" (0–1/4). Render 4 small squares with `aria-label`
  "Chance this is your best fit: 12%". Never print "0%". Put the exact % in `title` and in the AreaSheet.
- `whyLine(item, list)`: build one short sentence from the item's own data. Never invent figures:
  - If `role`: "Best if {param plain} matters {more|less} to you." Plain params: `c_t` → "a short commute",
    feature keys → `FEATURE_LABELS` lower-case ("green space"), `lambda_b` → "staying under budget",
    `gamma` → "staying under your commute cap".
  - Else use the largest positive feature term in `breakdown.features`: "Strong on {feature}."
  - Append a relative fact when true: cheapest in list → "Cheapest here."; shortest commute → "Shortest ride."
- `confidenceMeter(rec)`: map `riskYen` to 5 steps. Thresholds: `<300` → 5 ("I know you well"), `<1,000` → 4,
  `<3,000` → 3, `<8,000` → 2, else 1 ("Still getting to know you"). When `shouldStop`, show 5/5 with the caption
  "That's enough to go on." Tweak the thresholds after looking at real values, and note the final ones in a code comment.
  Keep the exact sentence (today's `risk-line`) in the drawer with `data-testid="risk-line"`.
- `groupEvidence(evidence)` for the brief de-dupe.
- `rankDeltas(prev, next)` for the re-rank badges.

### 6.5 "How well I know you" meter

There are 5 segments, each 10×4px, moss when filled and `line` when empty, plus a caption. Animate the fill change with a 300ms width
or colour transition. The meter replaces "worth about ¥1,043 a month" and "effective sample 2231" on the surface.

### 6.6 Confidence wording (used in AreaSheet)

| Field | Plain wording |
|---|---|
| rent `near_price_point` | "Rent estimate: based on nearby listings' prices" |
| rent `distant_price_point` | "Rent estimate: based on prices a little further away" |
| rent ward-level | "Rent estimate: rough, from ward-wide averages" |
| access low/… | "Station access data: {level}" |
| commute band | "Commute could be ± N min" |
| lateReturnNotCovered | "Last-train times not checked" |
| similarNearby | "N similar areas nearby" |

### 6.7 DetailsSheet (wraps existing `ProfileForm.tsx`)

- Title: "Your details", plus a sub-line: "The guide fills these in from the chat. Change anything here."
- Restyle `ProfileForm` fields:
  - Group them as **Where** (anchor + trips/week + "Often home late"), **Money** (budget + "This is a hard limit") and
    **Time** (commute cap + "This is a hard limit").
  - Layout becomes a segmented chip row, not a select.
- Rename "Firm limit" to "Hard limit", with a `title` explaining it: "Areas over this are left out entirely."
- Primary button "Update my shortlist". Rename "Clear form" to the text link "Clear".
- After saving, close the sheet and toast "{feasibleCount} areas fit your limits." Show refused anchors or missing
  facts inline in the sheet without closing it. Keep `data-testid="profile-result"`.
- Combobox: add proper keyboard support (↑/↓ to move, Enter to choose, Esc to close) and `aria-activedescendant`.
  Today it is mouse-only.
- Preserve the existing hydrate-from-server-profile behaviour. **Keep the form mounted** (render the sheet with
  `hidden`/inert when closed, or lift form state) so the state survives closing.

### 6.8 WorkingDrawer (`components/WorkingDrawer.tsx`) — "Show the working"

This is a right-side panel on desktop and a full sheet on mobile. It uses the tabs **Fine-tune · What I think matters · Left out · Trace**
(`role="tablist"`, arrow-key navigation). Keep all panels mounted and use `hidden`, so the testids remain in the DOM.
- Fine-tune: the existing `EngineControls` content (strength, feature More/Less, why-not by id, compare, Quieter /
  Cheaper / Closer), the explanation output, the exact risk line (`data-testid="risk-line"`), **Recompute shortlist**,
  **Relax limits**, the removed-evidence list with Put back.
- What I think matters: existing `BeliefPanel`. Format negative numbers with a real minus `−`, and dim the
  `effective sample` caption.
- Left out: existing `Excluded`. Dim zero rows, and sort non-zero rows first.
- Trace: existing `Trace`, with the session id and a "Copy" button at the bottom.
- The drawer's open state persists in `localStorage` (`matchi.agent.working`). Wrap it in try/catch.

### 6.9 Toasts (`components/Toasts.tsx`)

- Fixed stack: bottom-right on desktop, bottom-centre above the composer on mobile, `z-50`, max width 24rem, newest at
  the bottom, `aria-live="polite"`.
- Source: `agent.notices` (dismiss with `agent.dismissNotice(i)`), plus local toasts (Undo after removing a chip, profile saved).
- Tone: warning style (`bg-warning border-brick/40`) for failures and "Surprising…". Paper style for neutral messages.
- Neutral toasts auto-dismiss after 6 seconds. Error toasts stay until dismissed. Use motion for enter and exit.

---

## 7. States checklist (each must be designed and verified)

| State | What the user sees |
|---|---|
| Session starting | Welcome skeleton in the conversation pane; shortlist pane shows 3 skeleton cards (`skeleton` utility). Composer disabled with "Connecting…" |
| Session failed (`sessionError`) | Conversation pane: "I couldn't reach the guide." + the message in muted text + **Try again** (startSession). Shortlist pane hidden or greyed |
| Fresh session, no messages | Welcome (§6.1). Shortlist pane empty state: three steps with ticks driven by `view.profile` — "Where you need to be", "A budget or commute limit", "Your layout" — and "Your shortlist appears here once I know these." |
| Streaming | Typing indicator; composer disabled; suggestion chips disabled |
| Recomputing (`busy`) | Indeterminate bar on shortlist header; cards dimmed, not removed; answer buttons disabled |
| Shortlist present | Cards + brief + meter + inline question turn |
| No area fits | Friendly empty card: "Nothing fits every limit yet." + relax options + Edit details; "Left out" summary in one line ("11 areas have missing data") |
| `shouldStop` | Meter full; question turn replaced by a guide line: "I think I've got you. Love or reject a few to fine-tune, or open any area for the details." |
| Chat off | §6.1 off-mode; questions still work |
| Grounding failed | Struck-through message + brick note + corrected reply after |
| Engine error on an action | Toast (error tone) + red trace line (already logged by `useAgent`) |

---

## 8. Motion & micro-interactions

- One easing everywhere: `[0.22, 0.61, 0.36, 1]`. Durations: 160–240ms for UI, 300–420ms for layout and re-rank.
- Re-rank with `layout` animation on the cards (the signature moment). Show the delta badges for 4 seconds.
- On mobile, the shortlist pill pulses once when #1 changes.
- Sheets slide in (x on desktop, y on mobile) with a backdrop fade at `bg-ink/20`.
- Buttons get `active:translate-y-px` (already in `ui.ts`).
- **All motion is disabled under `prefers-reduced-motion`** (`useReducedMotion` from motion, `motion-reduce:` classes).

---

## 9. Accessibility requirements

- Landmarks: `header`, `main` with two labelled regions ("Conversation", "Your shortlist"), and dialogs for the sheets.
- One `h1`. Panes get `h2`; cards get `h3`.
- Live regions: the conversation log is `aria-live="polite"`, and the typing indicator is `role="status"`. The shortlist
  change summary is an sr-only `aria-live` region.
- Focus management: when a sheet opens, focus its heading. When it closes, return focus to the trigger. Esc closes any sheet.
  After a stream ends, focus returns to the composer.
- All icon-only buttons have `aria-label`s. Tabs use `role="tab"`, `aria-selected`, `aria-controls` and roving tabindex.
- Contrast: body text stays `ink` or `ink-muted` on paper. `stone` is only for non-essential metadata.
- IME-safe Enter handling (`event.nativeEvent.isComposing`).
- Tap targets ≥ 44px on touch.

---

## 10. Copy guide (voice)

- Use the second person and plain verbs. Keep one idea per sentence, and drop the jargon.
- Banned on the surface (allowed in the drawer only): *effective sample, ESS, regret, pBest, lambda, gamma,
  feasible, evidence, anchor, locality id, price point, term*.
- Replacements: feasible → "fit"; evidence → "what you've told me"; anchor → "where you need to be"; regret →
  "cost if I've misread you"; firm limit → "hard limit"; Recompute → "Refresh"; Like/Not this → "Love it / Not for
  me".
- Never invent numbers in UI copy. Every figure must come from `view` or a result object, the same rule the
  grounding check applies to the model.

---

## 11. File-by-file work list

| File | Action |
|---|---|
| `page.tsx` | Rewrite: AgentHeader + 2-pane grid / mobile layout + sheets + drawer + toasts. Owns UI state: `detailsOpen`, `areaSheetId`, `workingOpen`, `shortlistSheetOpen` (mobile). |
| `components/AgentHeader.tsx` | New (§5). |
| `components/Chat.tsx` → `Conversation.tsx` | Rewrite (§6.1). Includes `QuestionTurn`, `ExplanationTurn`, `Composer`, `Typing`, `Welcome`. |
| `components/ShortlistPane.tsx` | New (§6.2); `Shortlist.tsx` keeps exports `RelaxList`, `Excluded` (or move them and update `EngineControls` import). |
| `components/AreaCard.tsx`, `AreaSheet.tsx` | New (§6.2, §6.3). |
| `components/YourBrief.tsx` | New; replaces `EvidenceChips` on the surface (keep `EvidenceChips` content for the drawer's removed list or fold it in). |
| `components/ProfileForm.tsx` | Restyle + keyboard combobox (§6.7). No logic change to `buildProfile`. |
| `components/DetailsSheet.tsx`, `components/Sheet.tsx` | New. A generic accessible `Sheet` (dialog, focus trap, Esc, side/bottom variants), used by all sheets and the drawer. |
| `components/WorkingDrawer.tsx` | New (§6.8), composes `EngineControls`, `BeliefPanel`, `Excluded`, `Trace`. |
| `components/EngineControls.tsx`, `BeliefPanel.tsx`, `Trace.tsx` | Light restyle only; they now live in the drawer, so remove their outer `panel` boxes. |
| `components/Toasts.tsx` | New (§6.9). |
| `components/ui.ts` | Already updated; extend as needed. |
| `lib/derive.ts` + `lib/derive.test.ts` | New pure helpers (§6.4) with vitest tests. |

Suggested order (each step leaves the page working; commit after each):
1. `Sheet`, `Toasts`, `AgentHeader`, and the new page shell with the existing components dropped into the new places
   (form → DetailsSheet, engine/belief/excluded/trace → WorkingDrawer).
2. `derive.ts` + tests.
3. Conversation rewrite (welcome, messages, composer, typing, off-mode).
4. ShortlistPane + AreaCard + YourBrief + meter.
5. Inline QuestionTurn and ExplanationTurn.
6. AreaSheet.
7. Re-rank animation, deltas, live summary, mobile shortlist pill + sheet.
8. ProfileForm restyle + combobox keyboard support.
9. States pass (§7), a11y pass (§9), copy pass (§10), responsive pass.

---

## 12. Running it locally

The worktree is already set up. Its `.env` is a gitignored copy with `PORT=4200` and `CORS_ORIGIN=http://localhost:3101`.
The owner's own servers run on :3000 and :4100. **Do not stop them.**

```bash
cd ../matchi-ui-polish
pnpm --filter @tokyo/shared build          # once
pnpm dev:api                               # API on :4200 (reads ../.env)
cd web && NEXT_PUBLIC_API_BASE_URL=http://localhost:4200 npx next dev -p 3101
# open http://localhost:3101/agent
```

The model key is configured, so chat works. To test chat-off mode, start a second API with
`AGENT_MODEL_API_KEY=` empty on another port, and point a web instance at it.

---

## 13. Definition of done

**Automated (must pass):** `pnpm typecheck`, `pnpm lint`, `pnpm test` (including the new `derive.test.ts`), and
`pnpm --filter @tokyo/web build`.

**Manual, with screenshots at 375, 768, 1024 and 1440 widths:**
- [ ] First screen shows **one** headline, **one** input, and three starters. There are no tables, bars, or engine numbers.
- [ ] At 1440×900 after a first message, the whole experience fits without page scroll. Each pane scrolls on its own.
- [ ] On the surface (drawer closed) there are no more than **5 distinct interactive regions**: header, conversation,
      composer, brief, cards.
- [ ] Banned words (§10) do not appear unless the drawer is open. Check with
      `document.body.innerText` and the drawer closed.
- [ ] Answering an inline question visibly re-orders the cards with delta badges.
- [ ] Every Tier B/C feature in §3 is reachable, and its `data-testid` exists in the DOM.
- [ ] Every state in §7 has been seen and screenshotted (force states by blocking the API, emptying the key, or setting a tiny
      budget for no-fit).
- [ ] Keyboard-only run: start → type → answer the question → open a card → compare → close → open the drawer → switch tabs →
      start over. No focus traps, and focus is always visible.
- [ ] With `prefers-reduced-motion` on, nothing animates.
- [ ] Japanese IME: composing in Japanese and pressing Enter to confirm a conversion does **not** send.
- [ ] No horizontal scroll at 375px, and the composer is not hidden behind the mobile keyboard or safe area.
- [ ] No console errors or React key warnings.

**Report back** with the before and after screenshots, a short list of what changed and why, and anything that was
deferred.

---

## 14. Explicitly out of scope / follow-ups for the owner

- The shared `Masthead` has broken "How it works" and "New search" links on `/agent`. This plan sidesteps that with
  `AgentHeader`. Fixing the Masthead itself is a separate change.
- No API, engine, or `useAgent` behaviour changes. If a feature needs one (for example "apply relax option" in one click),
  stop and list it rather than changing the server.

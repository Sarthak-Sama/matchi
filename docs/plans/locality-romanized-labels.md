# Plan — Locality-Level Recommendation Labels

## Context

Recommendations already use official e-Stat town/locality polygons (938 in the Tokyo
23 wards, chōme dissolved). `localities.name_en` exists but is never populated, so the
API falls back to the Japanese name and every UI surface renders Japanese-only labels
with the ward repeated beside them. This plan populates `name_en` from the Japan Post
romanized-address archive and reworks the result surfaces to lead with
`Hatsudai (初台)` and demote the ward to secondary context.

Ranking, rent, commute, lifestyle scoring, polygons and locality IDs must not change.

## Global Constraints

- Locality IDs are `sha256(name_ja)`-derived and MUST stay stable. Naming enrichment
  must not change `localityId`, rank order, scores, rents, or commutes.
- No database migration. `localities.name_en` already exists; `nameEn`, `nameJa`,
  `wardNameEn`, `wardNameJa`, `nearbyStations` and `catchmentLabel` already exist in
  the response contract. Do NOT change the response schema shape.
- Verified locality romanization coverage against the checked-in data (measured, not
  assumed): 927 of 938 e-Stat localities join the Japan Post archive exactly, 0 are
  ambiguous, and 11 need overrides. Those 11 are listed verbatim in Task 2.
- The Japan Post CSV is Shift-JIS with CRLF, 7 columns, all fields double-quoted, all
  romanization UPPERCASE. Decode with the existing `iconv-lite` dependency in
  `scripts/`. Never add a new npm dependency.
- Display romanization is title case per whitespace-delimited word:
  `HATSUDAI` becomes `Hatsudai`; `SENJU AKEBONOCHO` becomes `Senju Akebonocho`.
- This repo has NO component tests and NO Playwright by design (see the comment at the
  top of `vitest.config.ts`). The `web` vitest project only includes `lib/**/*.test.ts`.
  UI behaviour is therefore tested through pure helpers in `web/lib/format.ts`.
  Do NOT add component tests or a new vitest project.
- Run `pnpm test`, `pnpm typecheck` and `pnpm lint` before reporting DONE. DB-backed
  integration suites (`scripts/src/{migrate,seed,derive}.test.ts`) are skipped without
  `DATABASE_URL`; that is expected — report which suites ran.
- Never run `pnpm data:refresh`, `pnpm import:localities`, `pnpm derive`,
  `pnpm data:validate`, `pnpm build:ward-plate` or any other command that writes to
  `DATABASE_URL`. That database is shared/production and `import:localities` cascades
  a delete through `locality_metrics`. The controller handles the data refresh
  separately, with the human's authorization.

---

## Task 1 — Add the Japan Post romanized archive to the verified data catalog

Extend the catalog and preparation pipeline so the archive is downloaded, checksummed
and extracted alongside the existing MLIT / e-Stat archives.

**`scripts/src/data-catalog.ts`**

- Add `"JP_POST_ROME"` to the `CatalogEntry["dataset"]` union.
- Add and export `RAW_JP_POST_DIR = path.join(DATA_DIR, "raw", "japanpost")`.
- In `prepareArchives`, `mkdir` that directory and route `JP_POST_ROME` entries to it
  (the existing ternary picks between the MLIT and e-Stat dirs; make it a small helper
  or `switch` rather than a nested ternary).

**`data/catalog.json`** — append this entry verbatim (values verified by download on
2026-09-13):

```json
{ "id": "japanpost-rome", "dataset": "JP_POST_ROME", "release": "2025-06", "url": "https://www.post.japanpost.jp/service/search/zipcode/download/roman/KEN_ALL_ROME.zip", "archive": "KEN_ALL_ROME.zip", "sourceDate": "2025-06-03", "sha256": "9764834dfd1d0148600c38b7fc4c00feae8443e81e68da3a49469447cd97707d" }
```

**`scripts/src/data-prepare.ts`**

- After the e-Stat locality extraction, extract `KEN_ALL_ROME.CSV` out of the archive
  to `data/locality-romanization.csv` **without transcoding** — write the raw Shift-JIS
  bytes. Use `execFileSync("unzip", ["-p", zip, "KEN_ALL_ROME.CSV"], { maxBuffer: ... })`
  and `writeFileSync`, or `unzip -o -j <zip> KEN_ALL_ROME.CSV -d <dir>` plus a rename.
  `unzip` is already a hard dependency of this file. The extracted CSV is ~11 MB;
  set `maxBuffer` accordingly if you pipe it, and do not pass an encoding so the bytes
  come back as a Buffer.
- Fail loudly if the catalog is missing `japanpost-rome`, matching how the file already
  handles `estat-localities-2020`.
- Extend the closing `console.log` only if it still reads accurately.

**Tests:** none required for this task (the file has no existing test and is pure
shell orchestration). Verify with `pnpm typecheck` and `pnpm lint`.

---

## Task 2 — Romanization module: parsing, normalization, overrides

Create `scripts/src/import-localities/romanization.ts`,
`scripts/src/import-localities/romanization-overrides.ts` and
`scripts/src/import-localities/romanization.test.ts`. This task is pure functions
plus no I/O of its own; it touches no database and no other file.

### `romanization-overrides.ts`

Export a checked-in, readonly override table keyed by ward code + the **stored** e-Stat
Japanese locality name (the name after the importer's existing `normalizeLocalityName`,
i.e. chōme already dissolved). Shape:

```ts
export interface RomanizationOverride {
  readonly wardCode: string;
  readonly nameJa: string;
  readonly nameEn: string;
  readonly reason: string;
}
export const ROMANIZATION_OVERRIDES: readonly RomanizationOverride[] = [ ... ];
```

These are the exact 11 entries — the complete measured set of e-Stat localities with no
Japan Post match. Use these `nameEn` values verbatim:

| wardCode | nameJa | nameEn | reason |
|---|---|---|---|
| 13101 | 三崎町 | Misakicho | Japan Post files this as 神田三崎町 (KANDAMISAKICHO) |
| 13101 | 猿楽町 | Sarugakucho | Japan Post files this as 神田猿楽町 (KANDASARUGAKUCHO) |
| 13102 | 水面調査区 | Water Survey Area | Tokyo Bay survey polygon, not a postal town |
| 13103 | ‐ | Minato Waterfront | e-Stat placeholder name for Minato's unnamed waterfront blocks |
| 13111 | 羽田沖水面及び中央防波堤外側付近 | Haneda Offshore and Outer Breakwater | water polygon, not a postal town |
| 13111 | 多摩川河川敷(上流) | Tamagawa Riverbed (Upstream) | riverbed polygon, not a postal town |
| 13111 | 多摩川河川敷(下流) | Tamagawa Riverbed (Downstream) | riverbed polygon, not a postal town |
| 13113 | 鴬谷町 | Uguisudanicho | e-Stat writes 鴬, Japan Post writes 鶯 |
| 13113 | 松涛 | Shoto | e-Stat writes 涛, Japan Post writes 濤 |
| 13121 | 入谷町,舎人町 | Iriyamachi / Tonerimachi | e-Stat merges two postal towns into one polygon |
| 13123 | 堀江町 | Horiecho | former town name retained by e-Stat, absent from Japan Post |

Note the `13103` entry's `nameJa` is the single character U+2010 HYPHEN, not an ASCII
hyphen-minus and not a dash — copy it from this table exactly.

### `romanization.ts`

Export these, each independently testable:

1. `normalizeForMatch(name: string): string` — matching key only, never stored:
   - `String.prototype.normalize("NFKC")`
   - strip a trailing chōme suffix: `[一二三四五六七八九十]+丁目$`, `[0-9]+丁目$`, `丁目$`
   - replace every `ケ` (U+30B1 katakana KE) with `ヶ` (U+30F6 small KE), so `幡ケ谷` and
     `幡ヶ谷` produce the same key
   - remove ALL whitespace, including the ideographic space U+3000
   - trim

2. `toDisplayRomanization(upper: string): string` — split on runs of whitespace,
   title case each word (`w.charAt(0) + w.slice(1).toLowerCase()`), join with a single
   space. `"HATSUDAI"` becomes `"Hatsudai"`, `"SENJU AKEBONOCHO"` becomes
   `"Senju Akebonocho"`.

3. `parseJapanPostCsv(bytes: Buffer): readonly JapanPostRow[]` where
   `JapanPostRow = { wardNameJa: string; matchKey: string; nameEn: string }`:
   - `iconv.decode(bytes, "Shift_JIS")`, split on `/\r?\n/`, skip blank lines.
   - Split each line on `,` and strip one leading and one trailing `"` per field.
     (Japan Post never emits an embedded comma inside a quoted field in this file —
     do not pull in a CSV parser.)
   - Skip lines with fewer than 7 fields.
   - Columns are: `[postalCode, prefJa, cityJa, townJa, prefRo, cityRo, townRo]`.
   - Keep only `prefJa === "東京都"` and `cityJa` ending in `区`.
   - Skip any row whose `townJa` contains `以下に掲載がない場合` (the "no town listed"
     catch-all).
   - Strip parenthesized annotations from both name columns: full-width `（...）` with an
     optional closing bracket from `townJa`, and ASCII `(...)` with an optional closing
     bracket from `townRo`. The optional close matters — Japan Post truncates long
     fields mid-annotation, leaving an unclosed bracket. So
     `恵比寿　（次のビルを除く）` / `EBISU (TSUGINOBIRUONOZOKU)` must yield
     `恵比寿` / `Ebisu`.
   - **The ideographic space inside a town name is a sub-town separator, not an
     annotation.** `千住　曙町` / `SENJU AKEBONOCHO` must yield matchKey `千住曙町` and
     display `Senju Akebonocho`. Do not split on it and do not discard the tail.
   - Drop rows that end up with an empty match key or an empty romanization.

4. `buildRomanizationIndex(rows): Map<string, Map<string, Set<string>>>` keyed
   `wardNameJa` then `matchKey`, to a set of display romanizations. (A `Set` so the
   caller can detect ambiguity; the measured data has none, but the importer must fail
   rather than pick arbitrarily if a future release introduces one.)

5. `resolveLocalityNames(input): ResolvedRomanization` — the whole join, so the
   importer stays thin. Input:

   ```ts
   {
     readonly localities: readonly { wardCode: string; wardNameJa: string; nameJa: string }[];
     readonly index: ReturnType<typeof buildRomanizationIndex>;
     readonly overrides?: readonly RomanizationOverride[]; // defaults to ROMANIZATION_OVERRIDES
   }
   ```

   Returns `{ nameEnByKey: Map<string, string> }` keyed by `wardCode` and `nameJa`
   joined with a NUL (` `) separator, matching how `import-localities.ts` already
   keys its grouping map. Resolution order per locality: an override matching
   `wardCode` plus exact `nameJa` wins; otherwise the index lookup by `wardNameJa` and
   `normalizeForMatch(nameJa)`.

   It **throws** — one error listing every offender, not one error per offender — when:
   - any locality resolves to no romanization (list `wardCode nameJa`);
   - any index lookup yields more than one distinct romanization (ambiguous);
   - any supplied override was never used (an override that no longer matches an
     e-Stat locality is stale and must be deleted, not silently ignored);
   - any resolved `nameEn` is empty or equal to its `nameJa`.

### `romanization.test.ts`

Vitest, `import { describe, expect, it } from "vitest"` — match the existing style in
`scripts/src/import-localities.test.ts`. Build Shift-JIS fixture buffers in-test with
`iconv.encode(...)`; do NOT read anything under `data/`. Cover:

- Shift-JIS decoding round-trips Japanese town names correctly.
- Title casing: `HATSUDAI` to `Hatsudai`; `SENJU AKEBONOCHO` to `Senju Akebonocho`.
- Chōme removal in `normalizeForMatch`: `初台１丁目`, `初台2丁目`, `初台一丁目`, `初台丁目`
  all key to `初台`.
- `ケ`/`ヶ`: `幡ケ谷` and `幡ヶ谷` produce the same key, so a `幡ヶ谷` postal row matches
  a `幡ケ谷` e-Stat name.
- Postal annotations: the `以下に掲載がない場合` row is skipped; `恵比寿　（次のビルを除く）`
  yields `恵比寿`/`Ebisu`; a truncated unclosed `（１` annotation is still stripped.
- Sub-town ideographic space: `千住　曙町`/`SENJU AKEBONOCHO` gives key `千住曙町` and
  display `Senju Akebonocho`.
- Duplicate detection: two postal rows giving the same ward and key different
  romanizations make `resolveLocalityNames` throw, and the message names the locality.
- Overrides: an override wins over an index hit; an unused override throws.
- Missing romanization throws and the message names every missing locality.
- The three canonical fixtures resolve to the exact pairs
  `Hatsudai`/`初台`, `Hatagaya`/`幡ケ谷`, `Yoyogi`/`代々木`.

---

## Task 3 — Populate `name_en` from the importer

Wire Task 2's module into `scripts/src/import-localities.ts`.

- Add an optional third parameter `romanizationPath = "data/locality-romanization.csv"`.
- After grouping the features and before writing, read that file as a `Buffer`
  (`readFile(path)` with no encoding), build the index, and load ward code to Japanese
  ward name with `SELECT ward_code, name_ja FROM wards` (via the pool, before
  `runImport`). Throw a clear error if any grouped locality's ward code is absent from
  `wards` — the ward import must run first.
- Call `resolveLocalityNames` for every grouped locality. Its throw propagates, which
  is the required "fail the import on missing or ambiguous romanizations".
- Extend the `INSERT` to write `name_en` alongside `name_ja`. Keep the existing
  `locality_id` derivation, the `DELETE`, the dissolve/clip CTEs, and
  `SOURCE_UPDATED_AT` exactly as they are — locality IDs and geometry must not shift.
- `normalizeLocalityName` keeps its current behaviour and stays exported (it produces
  the stored Japanese name; `normalizeForMatch` is the separate matching-only form).

**Tests** — extend `scripts/src/import-localities.test.ts`:

- The existing `normalizeLocalityName` suite stays green and unmodified.
- Add a suite that runs the join end-to-end over an in-memory Shift-JIS fixture
  covering Hatsudai, Hatagaya and Yoyogi plus their ward rows, asserting the resolved
  pairs are exactly `Hatsudai`/`初台`, `Hatagaya`/`幡ケ谷`, `Yoyogi`/`代々木`. Do this by
  calling the exported Task 2 functions — do NOT open a database connection; the
  `scripts` vitest project runs without `DATABASE_URL`.

---

## Task 4 — API contract wording and data validation

Two small, independent edits plus one validation addition.

**`shared/src/config/scoring.ts`** — change

```ts
export const CATCHMENT_LABEL = "approximate 10-minute station area";
```

to

```ts
export const CATCHMENT_LABEL = "official town locality boundary (chōme combined)";
```

Keep the export name. Check `web/lib/format.test.ts` and `api/src/domain/scoring.test.ts`
for assertions on the old wording and update only what actually breaks. Leave
`CATCHMENT_RADIUS_M` alone — it still drives POI catchments.

**`api/src/routes/lib/candidates.ts`** — the `nameEn: row.nameEn ?? row.nameJa`
fallback stays as a last-ditch guard against a half-imported database, but add a
one-line comment saying the import and `data:validate` now guarantee a romanized
`name_en`, so the fallback should never fire. Do not change the SQL.

**`scripts/src/data-validate.ts`** — add one check to the `checks` array, alongside the
existing locality checks:

```ts
{
  label: "romanized locality names",
  sql: "SELECT count(*)::int AS value FROM localities WHERE name_en IS NULL OR btrim(name_en) = '' OR name_en = name_ja",
  expect: (n) => n === 0,
},
```

**Tests:** `pnpm typecheck`, `pnpm lint`, `pnpm test`. No new test file is warranted
for a constant and a SQL string; confirm no existing assertion depends on the old
catchment wording.

---

## Task 5 — Result surfaces: bilingual primary label, ward as secondary context

All display logic goes through pure helpers in `web/lib/format.ts` so it is testable
under the repo's existing no-component-tests policy.

### `web/lib/format.ts`

- `localityDisplayName(nameEn, nameJa)` keeps its current signature and behaviour
  (`Hatsudai (初台)`, falling back to `初台` alone when `nameEn` is empty or identical).
  It is already correct — do not change it.
- Add:

  ```ts
  export function localitySecondaryLabel(result: NeighborhoodResult): string
  ```

  Returns `Shibuya-ku · 6 min walk to Hatsudai Station` — `wardDisplayName(result.wardNameEn)`,
  then, when `result.nearbyStations[0]` exists, a ` · ` separator followed by
  `<rounded walkMinutes> min walk to <name> Station`, where `name` is the nearest
  station's `nameEn` if it is non-empty and differs from its `nameJa`, else its
  `nameJa`. Round `walkMinutes` with `Math.round`. Do not append ` Station` when the
  resolved name already ends in `Station` or `駅`. With no nearby station, return the
  ward alone. `nearbyStations` is already ordered by walk minutes (see the
  `ORDER BY x.walk_minutes` in the API query) — take index `0`, do not re-sort.

Add tests to `web/lib/format.test.ts` covering: the ward-plus-station string; the
ward-only string when `nearbyStations` is empty; a station whose `nameEn` is a Japanese
fallback; a station name that already ends in `Station`; and rounding of a fractional
`walkMinutes`.

### Component edits

The visual intent: the bilingual locality name is the only thing at heading size, and
everything that used to compete with it — a second copy of the Japanese name, a
free-standing ward chip, a Japanese ward name — collapses into one quiet secondary
line beneath it, in the muted ink already used for supporting text. Nothing new is
introduced: reuse the existing `text-ink-muted` supporting-text treatment and the
existing type scale at each site. Do not add colors, borders, badges, icons, uppercase
labels, or new spacing tokens.

- **`web/app/components/FeaturedResult.tsx`** — the `<h3>` keeps
  `localityDisplayName(...)`. Replace the `<p className="mt-1.5 text-[13px] text-ink-muted">`
  block entirely with a single `localitySecondaryLabel(result)`. This deletes the
  duplicated `result.nameJa` span and the `result.wardNameJa` span.
- **`web/app/components/ResultRow.tsx`** — `displayName` is unchanged. Replace the
  free-standing `<span className="text-[12px] text-ink-muted">{wardDisplayName(...)}</span>`
  that sits inline beside the name with `localitySecondaryLabel(result)` rendered on
  its own line beneath the name button, keeping the existing `text-[12px] text-ink-muted`
  treatment. Update the button's `aria-label` to
  `` `Rank ${result.rank}: ${displayName}. ${localitySecondaryLabel(result)}. Open the neighborhood entry.` ``
- **`web/app/components/NeighborhoodDetail.tsx`** — the `<h2>` is unchanged. Replace
  the ward paragraph (`wardDisplayName` plus the `lang="ja"` `wardNameJa` span) with a
  single `localitySecondaryLabel(result)` at the same `text-[14px] text-ink-muted`.
  Leave the coordinates line below it as is. `result.catchmentLabel` renders in two
  places and needs no change — Task 4 changes the value it carries.
- **`web/app/components/ComparisonTable.tsx`** — in the column header, replace the
  ward-only `<span className="mt-0.5 block text-[12px] text-ink-muted">` with
  `localitySecondaryLabel(result)`. The rank marker, the bilingual name and the remove
  button are unchanged.
- **`web/app/components/ResultsMap.tsx`** — line 263's `aria-label` uses the raw
  `result.nameJa`. Change it to `localityDisplayName(result.nameEn, result.nameJa)` and
  replace the inline `wardDisplayName(...)` with `localitySecondaryLabel(result)`,
  keeping the commute and rent clauses that follow.
- **`web/app/components/landing/MethodSequence.tsx`** — the landing example card at
  lines 75–82 renders `topResult.nameJa` as the heading and a hand-built
  `topResult.wardNameEn` plus `-ku` beneath. Render
  `bilingualLabel(topResult.nameEn, topResult.nameJa)` as the heading (`bilingualLabel`
  is already exported from `web/lib/format.ts` and handles the identical-name case that
  the current checked-in artifact still has) and render the ward line as
  `wardDisplayName(topResult.wardNameEn)`. Do not change the layout, the score, or the
  metric rows.

**Do not touch** `web/app/components/landing/tokyo-localities.ts` — it is generated by
`scripts/src/build-ward-plate.ts` and the controller regenerates it during the data
refresh. Its `nameEn: "五本木"` Japanese fallback is expected to persist until then, and
`bilingualLabel` renders it correctly either way.

**Aggregate summaries keep ward names**: `deriveResultsSummary` in `web/lib/format.ts`
("matches cluster in Shibuya-ku") is correct as written. Do not change it.

**Tests:** `pnpm test` (the new `format.test.ts` cases), `pnpm typecheck`, `pnpm lint`.
Do not add component tests.

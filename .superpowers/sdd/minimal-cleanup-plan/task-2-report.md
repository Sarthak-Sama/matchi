# Task 2 report: Simplify the locality optimizer model

## Implementation

- Made internal `Candidate`, `CandidateRow`, and `ScoredCandidate` locality-first: `localityId` is required.
- Removed station-backed candidate fallback code, synthetic `legacy:` locality IDs, and legacy conditional response fields.
- Made `ScoredCandidate` a complete `NeighborhoodResult` without `rank`; `rankCandidates` now sorts it and only adds `rank`.
- Updated scoring and route optimizer fixtures/assertions to model locality rows with samples and stable locality IDs.
- Preserved the public `NeighborhoodResult`/optimize response schema without edits.

## Files changed

- `api/src/domain/scoring.ts`
- `api/src/domain/scoring.test.ts`
- `api/src/routes/lib/candidates.ts`
- `api/src/routes/optimize.test.ts`

## Tests

```sh
pnpm --filter @tokyo/api typecheck
pnpm exec vitest run api/src/domain/scoring.test.ts api/src/routes/lib/candidates.test.ts api/src/routes/optimize.test.ts
```

Result: typecheck passed; 3 test files passed, 68 tests passed, 4 skipped.

## Self-review

- Confirmed the scoped implementation contains no `legacy:` IDs, `legacyStation` fallback functions, or optional locality IDs.
- Confirmed ranking no longer normalizes or copies completed scored results.
- Ran `git diff --check`; no whitespace errors.
- Did not edit flood code/tests or unrelated user changes.

## Concerns

- `isDestinationAccessStation` remains optional in the unchanged public schema but is no longer populated by the locality optimizer, because it was only supplied by the removed station-backed compatibility path.

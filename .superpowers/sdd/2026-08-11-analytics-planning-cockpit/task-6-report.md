# Task 6 report

## Files changed

- `packages/core/src/analytics/types.ts`
- `packages/core/src/analytics/filter.ts`
- `packages/core/src/analytics/index.ts`
- `packages/core/tests/analytics/filter.test.ts`

## RED

Command:

```sh
ORBIT_TEST_LANE=analytics-cockpit-task6 bun run --filter '@orbit/core' test ./tests/analytics/filter.test.ts
```

Output summary after the local test database was available:

```text
Cannot find module '../../src/analytics/filter.ts'
0 pass
1 fail
1 error
Exited with code 1
```

## GREEN

Focused resolver command:

```sh
ORBIT_TEST_LANE=analytics-cockpit-task6 bun run --filter '@orbit/core' test ./tests/analytics/filter.test.ts
```

Focused result:

```text
18 pass
0 fail
66 expect() calls
```

Full core result against an isolated current-schema lane:

```text
812 pass
0 fail
2119 expect() calls
```

Current-schema database verification used one fresh explicit database for `@orbit/db` and six fresh package lane databases. Each database received the current schema directly. The explicit database drift check reported every declared table and column present.

The final repository verification command was:

```sh
DATABASE_URL=postgres://orbit:orbit@localhost:5434/orbit_test_task6review10813 DIRECT_URL=postgres://orbit:orbit@localhost:5434/orbit_test_task6review10813 ORBIT_TEST_LANE=analytics-task6-review1-0813 bun run verify
```

The command exited 0. Lint, comment policy, source-byte policy, Bun import policy, dependency checks, every package typecheck, and every package test process passed.

## Resolution semantics

- Concrete ranges use half-open UTC intervals, `[from, to)`.
- Resolved queries remain assignable to `AnalyticsQuery`; the requested range discriminator stays in `range` and the concrete interval is exposed as `resolvedRange`.
- Custom end dates are inclusive calendar selections and resolve to the next local midnight as the exclusive end.
- Last 30 and last 90 presets cover complete reporting-timezone calendar days through the local day containing the supplied clock.
- One active sprint selects its stored range and timezone. Zero or several active sprints use the trailing 30 days in the reporting timezone.
- A selected cycle, selected team, or relevant positive cycle filter narrows active sprint selection before the zero-configuration default is chosen.
- Auto comparison selects the previous completed sprint for a selected sprint and the immediately preceding equal calendar period for date ranges.
- Explicit previous sprint selection and comparison use only a same-team predecessor. An unavailable predecessor yields a null comparison or the bounded range-selection fallback rather than an unrelated team's sprint.
- All-time begins at the local day containing known earliest history. With no known history it uses the bounded trailing 30-day range.
- Daily buckets cover ranges through 45 days. Weekly buckets cover ranges through 15 calendar months. Longer ranges use monthly buckets.
- Bucket boundaries advance in local calendar time and emit UTC instants. A skipped midnight resolves to the first valid instant of its civil date, and an ambiguous midnight resolves to the earlier instant.
- Month buckets coarsen when needed and every plotted series stays at or below 120 buckets.

## Self-review

- Covered empty, single-active, multiple-active, selected-cycle, selected-team, and cycle-filtered sprint contexts.
- Covered active and previous sprint selectors, automatic and explicit comparisons, custom ranges, leap day, daylight-saving boundaries, adaptive granularity, reversed custom input, and bounded all-time history.
- Covered São Paulo's 2018 skipped midnight and Havana's 2018 repeated midnight across custom ranges, comparisons, and buckets.
- Proved resolved query structural compatibility by assigning the result to `AnalyticsQuery` and preserving its requested range value.
- Defined reusable coverage, freshness, metric, bucket, date-range, sprint-context, and resolved-query contracts for later analytics services.
- Kept the resolver pure and deterministic with an injected clock and cycle set.
- Added no comments, em dash characters, `any`, non-null assertions, runtime Bun imports, or external dependencies.

## Concerns

- Root lint reports the existing Biome schema-version information message and the existing warning in `packages/db/tests/check-source-bytes.test.ts:19`; lint exits 0.

## Review fix round 1

The focused review test first failed with cycle-filtered selection returning no sprint, previous-sprint relevance choosing another team's sprint, missing `resolvedRange`, an overwritten query range discriminator, and a `RangeError` for the valid São Paulo civil date whose midnight was skipped.

The existing `analytics-cockpit-task6` lane produced 37 unrelated schema failures because its `cycle_progress_snapshot` table predates the `captured_at` and `is_final` columns. The authoritative full-core run used a fresh current-schema lane and passed all 812 tests.

Fresh disposable databases for the review used lane suffix `analyticstasa8f83c37`. The final repository verification used `orbit_test_task6review10813` for the explicit database and current-schema package databases for the same lane. All disposable databases were removed after verification, and no developer database was changed.

The first root verification run naturally exited 1 after the `@orbit/db` catchup test cleanup exceeded its 30 second hook timeout under concurrent package load. The isolated database package rerun passed all 230 tests, and the complete root verification rerun naturally exited 0.

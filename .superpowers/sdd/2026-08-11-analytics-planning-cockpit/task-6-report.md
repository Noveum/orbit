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
12 pass
0 fail
44 expect() calls
```

Full core result against an isolated current-schema lane:

```text
806 pass
0 fail
2097 expect() calls
```

Current-schema database verification used one fresh explicit database for `@orbit/db` and six fresh package lane databases. Each database received the current schema directly. The explicit database drift check reported every declared table and column present.

The final repository verification command was:

```sh
DATABASE_URL=postgres://orbit:orbit@localhost:5434/orbit_test_task6verify0813a DIRECT_URL=postgres://orbit:orbit@localhost:5434/orbit_test_task6verify0813a ORBIT_TEST_LANE=analytics-task6-verify-0813a bun run verify
```

The command exited 0. Lint, comment policy, source-byte policy, Bun import policy, dependency checks, every package typecheck, and every package test process passed.

## Resolution semantics

- Concrete ranges use half-open UTC intervals, `[from, to)`.
- Custom end dates are inclusive calendar selections and resolve to the next local midnight as the exclusive end.
- Last 30 and last 90 presets cover complete reporting-timezone calendar days through the local day containing the supplied clock.
- One active sprint selects its stored range and timezone. Zero or several active sprints use the trailing 30 days in the reporting timezone.
- Auto comparison selects the previous completed sprint for a selected sprint and the immediately preceding equal calendar period for date ranges.
- Explicit previous sprint comparison uses the latest relevant completed sprint. Previous sprint range selection falls back to a bounded date window when no completed sprint exists.
- All-time begins at the local day containing known earliest history. With no known history it uses the bounded trailing 30-day range.
- Daily buckets cover ranges through 45 days. Weekly buckets cover ranges through 15 calendar months. Longer ranges use monthly buckets.
- Bucket boundaries advance in local calendar time and emit UTC instants, so daylight-saving transitions do not create duplicate or skipped local dates.
- Month buckets coarsen when needed and every plotted series stays at or below 120 buckets.

## Self-review

- Covered empty, single-active, and multiple-active sprint contexts.
- Covered active and previous sprint selectors, automatic and explicit comparisons, custom ranges, leap day, daylight-saving boundaries, adaptive granularity, reversed custom input, and bounded all-time history.
- Defined reusable coverage, freshness, metric, bucket, date-range, sprint-context, and resolved-query contracts for later analytics services.
- Kept the resolver pure and deterministic with an injected clock and cycle set.
- Added no comments, em dash characters, `any`, non-null assertions, runtime Bun imports, or external dependencies.

## Concerns

- Root lint reports the existing Biome schema-version information message and the existing warning in `packages/db/tests/check-source-bytes.test.ts:19`; lint exits 0.

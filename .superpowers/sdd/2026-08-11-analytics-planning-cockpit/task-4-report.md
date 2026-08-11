# Task 4 report: scheduled sprint snapshots

## Status

Implemented the daily sprint snapshot job, local calendar dates, idempotent final snapshots, transactional sprint-close capture, protected cron route, Vercel schedule, and deployment configuration.

## Files changed

- `.env.example`
- `apps/web/src/app/api/cron/analytics-snapshots/route.ts`
- `apps/web/tests/app/api/cron/analytics-snapshots/route.test.ts`
- `apps/web/vercel.json`
- `docs/configuration.md`
- `packages/core/src/analytics/snapshot.ts`
- `packages/core/src/work/cycle-service.ts`
- `packages/core/tests/analytics/snapshot.test.ts`
- `scripts/snapshot-cycles.ts`

## RED evidence

Core snapshot command from `packages/core`:

```bash
ORBIT_TEST_LANE=analytics-cockpit bun --env-file=../../.env test --timeout 30000 tests/analytics/snapshot.test.ts
```

Output before implementation:

```text
0 pass
7 fail
```

The failures covered the new typed input boundary, sprint-local dates, idempotent upsert behavior, final-row capture, close transaction atomicity, and organization-safe tallying.

Web route command from `apps/web`:

```bash
ORBIT_TEST_LANE=analytics-cockpit bun --env-file=../../.env test --timeout 30000 tests/app/api/cron/analytics-snapshots/route.test.ts
```

The suite failed to import the absent analytics snapshot cron route. The tests were in place for missing configuration, missing authorization, wrong authorization, successful publication, and retry idempotence.

## GREEN evidence

Focused core snapshot command:

```bash
ORBIT_TEST_LANE=analytics-cockpit bun --env-file=../../.env test --timeout 30000 tests/analytics/snapshot.test.ts
```

```text
7 pass
0 fail
31 expect() calls
```

Focused web cron command:

```bash
ORBIT_TEST_LANE=analytics-cockpit bun --env-file=../../.env test --timeout 30000 tests/app/api/cron/analytics-snapshots/route.test.ts
```

```text
5 pass
0 fail
17 expect() calls
```

Focused core snapshot, membership, and cycle commands passed with exit 0. Focused analytics and pruning route tests passed 10 tests with 0 failures and 23 assertions.

Full affected packages:

```bash
ORBIT_TEST_LANE=analytics-cockpit bun run --filter '@orbit/core' test
ORBIT_TEST_LANE=analytics-cockpit bun run --filter '@orbit/web' test
```

```text
@orbit/core: 785 pass, 0 fail, 1998 expect() calls, 55 files
@orbit/web: 1881 pass, 0 fail, 4659 expect() calls, 233 files
```

Database drift against the disposable current-schema database:

```bash
DATABASE_URL=postgres://orbit:orbit@localhost:5434/orbit_test_core bun run db:check-drift
```

```text
Every table and column declared in the Drizzle schema exists in the database.
```

Static verification:

```text
bun run lint: exit 0
bun run check-comments: 0 disallowed comments
bun run check-bytes: exit 0
bun run check-bun-imports: exit 0
bun run check-deps: exit 0
bun run typecheck: every package exit 0
git diff --check: exit 0
```

Repository verification was run twice with the exact command:

```bash
ORBIT_TEST_LANE=analytics-cockpit bun run verify
```

The first sandboxed run completed core and web successfully but denied the database package access to local port 5434. The approved local-database rerun completed every static and type gate, core at 785 pass and 0 fail, and web at 1881 pass and 0 fail. The aggregate command exited 1 because the separate `@orbit/db` lane is stale and lacks the Task 3 database constraints. An isolated database package run reproduced exactly 3 schema-invariant failures with 227 other tests passing: the open-membership unique constraint, duplicate-outcome unique constraint, and organization cascade constraints. The disposable current-schema drift database passes, and Task 4 does not change schema or migrations.

## Transaction and publication evidence

The close atomicity test wraps the real database transaction, confirms the final snapshot is visible inside that transaction after the close callback, forces a later failure, and then verifies both the final snapshot and cycle completion rolled back. The final snapshot is written before rollover moves unfinished work away, so its tally preserves the closing sprint scope.

The cron route follows the established constant-time bearer-token comparison, returns 503 when no secret is configured, and publishes the exact actions returned by `writeCycleSnapshots` through the existing web publisher boundary. A retry updates the same sprint-local calendar row rather than creating a duplicate.

## Self-review

- Snapshot dates come from each sprint timezone with `Intl.DateTimeFormat` calendar parts.
- The input boundary carries an explicit clock and an optional final sprint identifier.
- Daily and final writes set `capturedAt`; final writes preserve `isFinal` across later upserts.
- Final capture shares the sprint-close transaction and happens before rollover or completion.
- Existing Task 3 membership bootstrap remains in daily snapshot and close paths.
- Issue tallies require the issue organization to match the sprint organization.
- The protected route writes nothing and publishes nothing for unauthorized callers.
- Vercel schedules snapshots before the existing pruning job.
- No comments, em dash characters, `any`, or non-null assertions were added.

## Concerns

- The default local development database predates the current schema and cannot apply the Task 3 `cycle.team_id` migration while legacy rows contain null values. The isolated test schema and drift database are current.
- The separate database-package test lane is stale as described in the verification evidence. Its failures are existing schema setup state, not Task 4 code.
- Root lint reports the existing Biome schema-version information message and existing warning in `packages/db/tests/check-source-bytes.test.ts:19`; lint exits 0.

## Commit

`feat(analytics): schedule sprint snapshots`

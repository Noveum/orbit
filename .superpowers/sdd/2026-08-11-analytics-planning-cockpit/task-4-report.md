# Task 4 report: scheduled sprint snapshots

## Status

Implemented the sprint snapshot job, local calendar dates, idempotent final snapshots, transactional sprint-close capture, protected cron route, six-hour Vercel schedule, and deployment configuration.

## Files changed

- `.env.example`
- `apps/web/src/app/api/cron/analytics-snapshots/route.ts`
- `apps/web/tests/app/api/cron/analytics-snapshots/route.test.ts`
- `apps/web/vercel.json`
- `docs/configuration.md`
- `packages/core/src/analytics/membership.ts`
- `packages/core/src/analytics/snapshot.ts`
- `packages/core/src/work/cycle-service.ts`
- `packages/core/tests/analytics/snapshot.test.ts`
- `packages/core/tests/work/cycle-service.test.ts`
- `packages/shared/src/validators/cycle.ts`
- `packages/shared/tests/validators/validators.test.ts`
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

The initial Task 4 verification mistakenly expected `ORBIT_TEST_LANE` to redirect `@orbit/db`. That package reads `DATABASE_URL` directly, so this was not valid full-repository evidence. Review fix round 1 corrects the setup below with an explicit disposable database for `@orbit/db` and a current fixed test lane for the remaining packages. Task 4 does not change schema or migrations.

## Transaction and publication evidence

The close atomicity test wraps the real database transaction, confirms the final snapshot is visible inside that transaction after the close callback, forces a later failure, and then verifies both the final snapshot and cycle completion rolled back. The final snapshot is written before rollover moves unfinished work away, so its tally preserves the closing sprint scope.

The cron route follows the established constant-time bearer-token comparison, returns 503 when no secret is configured, and publishes the exact actions returned by `writeCycleSnapshots` through the existing web publisher boundary. A retry updates the same sprint-local calendar row rather than creating a duplicate.

## Self-review

- Snapshot dates come from each sprint timezone with `Intl.DateTimeFormat` calendar parts.
- The input boundary carries an explicit clock and an optional final sprint identifier.
- Daily and final writes set `capturedAt`; final writes preserve `isFinal` across later upserts.
- Final capture shares the sprint-close transaction and happens before rollover or completion.
- Existing Task 3 membership bootstrap remains in daily snapshot and close paths.
- Issue membership and tallies require both the issue organization and team to match the sprint.
- The protected route writes nothing and publishes nothing for unauthorized callers.
- Vercel schedules snapshots every six hours so no local calendar date is skipped across timezone or DST changes.
- No comments, em dash characters, `any`, or non-null assertions were added.

## Concerns

- Root lint reports the existing Biome schema-version information message and existing warning in `packages/db/tests/check-source-bytes.test.ts:19`; lint exits 0.

## Commit

`feat(analytics): schedule sprint snapshots`

## Review fix round 1

### RED evidence

Focused core tests initially reported 64 passing and 4 failing. Creation and update ignored the supplied timezone, an invalid stored timezone threw a `RangeError` in both daily and close paths, and a same-organization cross-team issue leaked into the tally. The dedicated invalid-timezone run reported 0 passing and 2 failing. Corrupt cross-organization and cross-team fixtures also asserted that neither memberships nor outcomes may be created for mismatched issues.

Focused shared validation reported 15 passing and 1 failing because an invalid timezone was accepted. The cron route test observed no fixed-length digest comparison for unequal secret lengths. The Vercel schedule test received `0 3 * * *` instead of `0 */6 * * *`. A DST integration test exercised successive six-hour invocations around the `America/New_York` spring transition.

### GREEN evidence

```bash
ORBIT_TEST_LANE=analytics-cockpit bun --env-file=../../.env test --timeout 30000 tests/analytics/snapshot.test.ts tests/work/cycle-service.test.ts
ORBIT_TEST_LANE=analytics-cockpit bun --env-file=../../.env test tests/validators/validators.test.ts
ORBIT_TEST_LANE=analytics-cockpit bun --env-file=../../.env test tests/app/api/cron/analytics-snapshots/route.test.ts
```

```text
@orbit/core focused: 68 pass, 0 fail, 203 expect() calls
@orbit/shared focused: 16 pass, 0 fail, 61 expect() calls
@orbit/web cron focused: 8 pass, 0 fail, 23 expect() calls
```

Full affected packages passed:

```text
@orbit/shared: 241 pass, 0 fail, 574 expect() calls, 16 files
@orbit/core: 789 pass, 0 fail, 2012 expect() calls, 55 files
@orbit/web: 1884 pass, 0 fail, 4665 expect() calls, 233 files
```

A fresh disposable database named `orbit_test_task4review1b74` was created from the current schema with explicit `DATABASE_URL` and `DIRECT_URL`. Database push exited 0. Drift verification exited 0 and reported that the database has every table and column the schema declares. The developer database was not used or changed.

The exact full repository verification command was:

```bash
DATABASE_URL=postgres://orbit:orbit@localhost:5434/orbit_test_task4review1b74 DIRECT_URL=postgres://orbit:orbit@localhost:5434/orbit_test_task4review1b74 ORBIT_TEST_LANE=analytics-cockpit bun run verify
```

The command exited 0. Every static gate, package typecheck, and package test process passed. The final web package result was 1884 passing, 0 failing, and 4664 expectation calls across 233 files.

### Fix details and self-review

- New and updated cycles accept only valid IANA timezone names. Minted successor cycles inherit the closing cycle timezone.
- A legacy invalid stored timezone is isolated to that cycle and explicitly uses UTC for its snapshot date. It cannot block valid cycles or permanently block close. This fallback is documented in `docs/configuration.md`.
- Membership bootstrap, tally, close outcomes, detach, rollover, and cycle issue locks match organization, team, and cycle boundaries.
- Six-hour idempotent invocations cover every local calendar date across DST transitions.
- Cron authentication hashes both offered and expected secrets with SHA-256 before constant-time comparison, including when input lengths differ.
- The route test proves the exact action array from the snapshot writer is forwarded to the existing publisher boundary.
- Existing Task 3 membership bootstrap and close self-healing remain active.
- No comments, em dash characters, `any`, or non-null assertions were added.

### Review commit

`fix(analytics): harden sprint snapshot scheduling`

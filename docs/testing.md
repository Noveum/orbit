# Testing

Orbit tests with `bun test`. There is no vitest and no jest, and adding either
would mean two runners for one repository.

A feature is not done until it has a test that would fail if the feature broke.
That is the bar reviewers hold changes to, and it is the thing pull requests get
sent back for most often.

## Running them

```bash
bun run verify                      # lint, comment policy, types, tests. What CI runs
bun run test                        # every package
cd packages/shared && bun test      # one package, fast
bun test tests/policy               # one directory
bun test --watch                    # while you work
bun run test:e2e                    # Playwright, needs bun run dev running
```

Before anything works you need the test databases, once per checkout:

```bash
bun run infra:up
bun run db:test-setup
```

Skip that and `verify` fails with connection errors that look like broken tests
rather than missing setup, which is an hour of debugging the wrong thing.

## Where tests live

Tests live in each package's own `tests/` tree, mirroring `src/`. Never beside
the code.

```
packages/shared/src/policy/index.ts
packages/shared/tests/policy/index.test.ts

packages/mcp-server/src/tools/issues.ts
packages/mcp-server/tests/tools/issues.test.ts
```

**Bun's scanner skips directories whose name starts with a dot.** A test for
something under `src/app/.well-known/` goes in `tests/app/well-known/`, or it
silently never runs. A test that never runs is worse than no test, because it
reads as coverage.

Import from `bun:test`:

```ts
import { describe, expect, test } from 'bun:test';
```

Never from `vitest`. It is not installed, and the import will resolve to
nothing useful.

## The databases

Each package owns an isolated database, so one package's `resetDatabase` cannot
truncate tables another package is mid-test on.

| Package | Database |
| --- | --- |
| `packages/core` | `orbit_test_core` |
| `packages/services` | `orbit_test_svc` |
| `apps/realtime` | `orbit_test_rt` |
| `packages/realtime-server` | `orbit_test_rts` |
| `packages/mcp-server` | `orbit_test_mcp` |
| `apps/web` | `orbit_test_web` |

Database tests run against the real Postgres from docker compose, inside a
transaction that rolls back. Not a mock, because the things that break in
practice are constraints, cascades and concurrent writes, and a mock has none of
those.

`scripts/test-env.ts` refuses to run against a database whose name does not
contain `test`, so you cannot wipe your development data by pointing a test run
at the wrong `DATABASE_URL`.

## Running two suites at once

Two worktrees, or two agents, or a test run while another is going: they will
share a database and you will get deadlocks and foreign key violations that look
exactly like real failures.

Set `ORBIT_TEST_LANE` to anything unique:

```bash
ORBIT_TEST_LANE=my-branch bun run test
```

The suite then uses `orbit_test_core_<lane>` and so on, cloned from the base
database the first time it is used. The lane name becomes a readable stub plus a
digest of the raw value, so two lanes that normalise to the same stub stay
apart.

Clean up when you are done:

```bash
ORBIT_TEST_LANE=my-branch bun run db:test-lanes-drop
```

That drops the databases of that one lane and nothing else. With no
`ORBIT_TEST_LANE` set it refuses and tells you why, because dropping every lane
takes out the runs other worktrees have in flight and the failures that follow
read exactly like broken tests. When you genuinely want a clean slate:

```bash
bun run db:test-lanes-drop --all
```

That takes every lane on that Postgres, live ones included. The six base
databases survive either way. Without `ORBIT_TEST_LANE` set on a test run,
nothing about the lane mechanism changes.

## DOM tests

A package that needs a DOM configures it in its own `bunfig.toml` with a
`tests-preload.ts`, which registers happy-dom. Environment variables for tests
go in the same preload.

## End to end

Playwright, in `apps/web/e2e`. The suite seeds the database in `global-setup`,
then drives a real browser against a running app.

```bash
bun run dev            # in one terminal
bun run test:e2e       # in another
```

E2E covers the things unit tests cannot: drag and drop on the board, two tabs
seeing the same update, attachments actually uploading, the doc editor.

`same-user-tabs.spec.ts` and `second-workspace-realtime.spec.ts` are the ones
worth reading if you touch the realtime layer, since they are what catch a
scope that delivers to the wrong people.

## Writing a good one

**Test the behaviour, not the implementation.** A test that asserts a function
was called breaks when you rename it, and passes when you break what it does.

**Use the real database for anything touching data.** The rollback makes it
fast enough, and the constraints are the point.

**For a bug fix, write the failing test first.** It proves you have understood
the bug, and it stops it coming back. This is the single most useful habit in
this repository.

**For realtime, assert the scope.** The question is not only "did the event
fire" but "who received it". A test that only checks delivery to the right
person misses the bug where it also went to the wrong one.

**Name the test after the behaviour**, since there are no comments to explain it:

```ts
test('a guest cannot delete a comment they did not write', () => { });
```

not:

```ts
test('deleteComment 403', () => { });
```

## What CI runs

Four jobs on every pull request:

| Job | Runs |
| --- | --- |
| Lint, comments, types | Biome, the comment policy, the byte check, `tsc` |
| Unit and integration | `bun run test` against real Postgres and Redis |
| Build | `bun run build` |
| End to end | Playwright against a booted app, with MinIO for uploads |

`bun run verify` locally runs the same first two. Run it before you push and CI
will rarely surprise you.

Failed E2E runs upload their Playwright traces as an artifact. Download it and
open it with `bunx playwright show-trace` to see exactly what the browser did.

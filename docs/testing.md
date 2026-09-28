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
bun run test:e2e                    # Playwright, starts its own Web and Realtime processes
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

Playwright, in `apps/web/e2e`. The configuration starts dedicated Web and
Realtime processes and does not reuse an already running server. Leave their
selected ports free. The suite seeds its database in `global-setup`, then drives
a real browser. Use only disposable test data.

The ordinary command excludes the two gated Agent HTTP release files. Their
dedicated command below runs both required phases in order.

```bash
bun run test:e2e
```

E2E covers the things unit tests cannot: drag and drop on the board, two tabs
seeing the same update, attachments actually uploading, the doc editor.

`same-user-tabs.spec.ts` and `second-workspace-realtime.spec.ts` are the ones
worth reading if you touch the realtime layer, since they are what catch a
scope that delivers to the wrong people.

## Agent release checks

Use a unique `ORBIT_TEST_LANE` and isolated PostgreSQL, Redis and storage
resources. Do not set `TEST_DATABASE_URL` to a shared database: an explicit URL
takes precedence over lane naming. Agent migration acceptance must use the
ordered `bun run db:release` path and `bun run db:check-drift`, not only
`db:push`. If a push-generated fixture lacks required constraints or lifecycle
guards, prepare migration-built templates in the disposable test environment;
do not weaken the assertions or replace another test run's databases.

The release command creates a private temporary directory outside the checkout,
then starts Playwright twice. The first run sets all four gates to `true` and
seeds the lane database. After Playwright stops its Web and Realtime processes,
the second run starts fresh processes with only `ORBIT_AGENT_ISSUE_WRITE=false`
and `ORBIT_E2E_SKIP_SEED=true`. Both runs use the same lane, database, origin
and private token file. A failed first run stops the sequence. The command
removes the temporary directory on success, failure, Ctrl+C and CI termination.

Set a new unique lane for each run. Set `ORBIT_E2E_BASE_URL` and
`ORBIT_E2E_REALTIME_PORT` to unused loopback ports if the defaults are occupied.
The test environment must use disposable PostgreSQL, Redis and storage resources.
The lane template `orbit_test_web` must already exist, normally through
`bun run db:test-setup`.

PowerShell on Windows:

```powershell
$env:ORBIT_TEST_LANE = "issue215-release-$([guid]::NewGuid().ToString('N').Substring(0,8))"
$env:ORBIT_E2E_BASE_URL = "http://127.0.0.1:23000"
$env:ORBIT_E2E_REALTIME_PORT = "23101"
bun run test:e2e:agent-release
```

Bash on Linux:

```bash
export ORBIT_TEST_LANE="issue215-release-$(bun -e 'console.log(crypto.randomUUID().slice(0, 8))')"
export ORBIT_E2E_BASE_URL=http://127.0.0.1:23000
export ORBIT_E2E_REALTIME_PORT=23101
bun run test:e2e:agent-release
```

The first phase covers discovery, dynamic registration, PKCE consent, token
exchange, real HTTP tool calls, attribution and lifecycle invalidation. The
second phase proves Agent reads work, Agent issue writes are denied, and Human
issue creation still works. `mcp-settings.spec.ts` also exercises MCP through
in-process helpers; that is not evidence that the HTTP `/mcp` route works.

The dedicated Playwright config disables tracing and stores its results under
the temporary directory. The handoff token is never printed or uploaded, and
the temporary directory is removed even when either phase fails. Ordinary E2E
may upload Playwright traces on failure, but its OAuth settings test disables
tracing because it handles token exchange responses. CI runs the same two
commands as local use, in one job and one lane. Local loopback checks do not
validate production DNS, TLS, reverse proxies or live provider credentials.

### Storage integration

`packages/services/tests/storage/round-trip.test.ts` runs its five actual S3
checks only when `S3_BUCKET` is configured. A green run with those tests skipped
is not storage acceptance. Use a disposable bucket with read, write, list,
delete and CORS support, with the origin expected by the fixture. Configure
`S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID` and
`S3_SECRET_ACCESS_KEY` for that bucket, then run:

```bash
bun --env-file=.env test packages/services/tests/storage/round-trip.test.ts
```

The tests include CORS behavior, byte-preserving uploads/downloads and rejection
of a payload larger than its signed length. With LocalStack 4.5.0, explicitly
set `S3_SKIP_SIGNATURE_VALIDATION=0` on the LocalStack service and restart that
service before testing. Setting it only on the Bun test process does not change
the emulator. Otherwise the default signature bypass accepts an invalid upload
and cannot establish this contract. Keep the original assertion intact.

Record unsupported emulator APIs separately from application failures. A
successful emulator run does not certify the production storage provider.

## Documentation checks

```bash
bun test docs/tests/navigation.test.ts
bun run docs:build
```

The navigation test checks the public documentation table and sidebar. Update
its expected entries when changing that table. VitePress checks local links;
published pages must not link to ignored `extras/` notes or machine-specific
paths. Neither these checks nor Playwright is included in `bun run verify`.

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

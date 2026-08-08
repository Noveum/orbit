# Contributing to Orbit

Thanks for being here. Orbit is free because a task manager is infrastructure,
and infrastructure should not cost 18 dollars per person per month. Every
contribution keeps it that way.

This guide covers everything from a first typo fix to a feature that touches the
database, the realtime hub and the MCP server at once.

## Table of contents

- [Ways to contribute](#ways-to-contribute)
- [Set up your machine](#set-up-your-machine)
- [Find something to work on](#find-something-to-work-on)
- [The development loop](#the-development-loop)
- [The rules that are not negotiable](#the-rules-that-are-not-negotiable)
- [Writing tests](#writing-tests)
- [Editor and assistant setup](#editor-and-assistant-setup)
- [Sending a pull request](#sending-a-pull-request)
- [Review and merge](#review-and-merge)
- [Reporting bugs](#reporting-bugs)
- [Proposing features](#proposing-features)
- [Getting help](#getting-help)

## Ways to contribute

You do not need to write TypeScript to make Orbit better.

| Contribution | Where it goes |
| --- | --- |
| Fix a bug | A pull request, ideally with a failing test first |
| Improve the docs | Anything under `docs/`, or the README |
| Report a bug | [New bug report](https://github.com/Noveum/orbit/issues/new?template=bug_report.yml) |
| Suggest a feature | [New feature request](https://github.com/Noveum/orbit/issues/new?template=feature_request.yml) |
| Translate the interface | Not wired up yet, and we want it. See the roadmap |
| Improve accessibility | Always welcome, always merged fast |
| Answer a question | [Discussions](https://github.com/Noveum/orbit/discussions) |
| Design | Open an issue with a screenshot or a Figma link |

## Set up your machine

You need [Bun](https://bun.sh) 1.3 or newer and Docker. That is the whole list.
Bun replaces npm, pnpm, yarn, ts-node, jest and turbo, so do not install any of
them.

```bash
git clone https://github.com/Noveum/orbit.git
cd orbit
bun install
cp .env.example .env
bun run infra:up        # postgres, redis and minio in docker
bun run db:push         # create the schema
bun run db:test-setup   # create the six test databases
bun run db:seed         # load a demo workspace you can click around in
bun run dev             # web on :3000, realtime on :3100
```

Open <http://localhost:3000>. `ORBIT_DEV_LOGIN=1` is set in `.env.example`, so
the login screen lists the seeded users and signs you in with one click. Start
as `pulkit@noveum.ai`, who is an admin on all three seeded teams.

If any of that fails, [docs/troubleshooting.md](docs/troubleshooting.md) covers
the failures we actually hit rather than the ones we imagine.

### Do not skip db:test-setup

Each package tests against its own database. Without that command `bun run
verify` fails on a clean checkout with connection errors that look like broken
tests, and you will spend an hour debugging the wrong thing.

### Running two things at once

If you have two worktrees or two agents running tests against the same Postgres,
set `ORBIT_TEST_LANE` to something unique in each. Without it both runs truncate
the same tables and you get deadlocks and foreign key violations that look like
real failures.

```bash
ORBIT_TEST_LANE=my-branch bun run test
ORBIT_TEST_LANE=my-branch bun run db:test-lanes-drop   # clean up that lane afterwards
```

The cleanup drops only the lane you name, so it cannot take out a run someone
else has going. Without `ORBIT_TEST_LANE` it refuses instead of guessing. Pass
`--all` when you really do want every lane on that Postgres gone.

## Find something to work on

- [Good first issues](https://github.com/Noveum/orbit/labels/good%20first%20issue)
  are scoped small and have the file paths written into the description.
- [Help wanted](https://github.com/Noveum/orbit/labels/help%20wanted) is
  everything we would like a hand with.
- [The roadmap](docs/roadmap.md) is where the bigger pieces live.

Comment on the issue before you start so two people do not build the same thing.
We will assign it to you. If you go quiet for two weeks we will unassign it and
say so on the thread, with no hard feelings, because a stalled assignment blocks
everyone else.

For anything larger than a bug fix, open an issue and agree the shape before you
write the code. A rejected pull request is a bad day for everybody, and it is
almost always avoidable with a five line comment beforehand.

## The development loop

```bash
bun run dev                          # everything, hot reloading
bun run verify                       # lint, comment policy, types, tests
bun run lint:fix                     # fix what Biome can fix
cd packages/shared && bun test       # one package, fast
bun run test:e2e                     # Playwright, needs dev running
```

`bun run verify` is the same set of checks CI runs. Run it before you push and
CI will almost never surprise you.

### Where things live

```
apps/web                  Next.js app: UI, REST handlers, auth, /api/ws, /mcp
apps/realtime             Local-only WebSocket host, never deployed
packages/realtime-server  Connection hub: tickets, scopes, presence, Redis fan-out
packages/mcp-server       MCP tools and the fetch handler behind /mcp
packages/core             Domain operations shared by REST, MCP and the hub
packages/services         Markdown, storage, email, notifications, Slack, GitHub
packages/db               Drizzle schema, migrations, client, seed
packages/shared           Zod validators, domain types, event contracts, policy
scripts/                  Repo tooling, TypeScript, run with bun
```

If two apps need a piece of code it belongs in `packages/shared`, never copied
into both. [docs/architecture.md](docs/architecture.md) explains how a single
keystroke travels from the browser to Postgres to every other open tab.

## The rules that are not negotiable

These are enforced by tooling, so you will find out either way. Knowing them up
front saves a review round.

**1. Bun is the package manager and the script runner.** No npm, no pnpm, no
yarn, no turbo. If you see a `package-lock.json` in your diff, delete it.

**2. Shipped server code must not import a Bun built-in.** Orbit runs on
Vercel's node runtime, because that is the only runtime where a function can
upgrade a websocket, and `/api/ws` needs that. Anything imported from `bun`
fails there with `Cannot find module 'bun'`.

| Need | Use | Never |
| --- | --- | --- |
| Postgres | `postgres.js` via `drizzle-orm/postgres-js` | `Bun.SQL`, `pg` |
| Redis | `ioredis` | `Bun.RedisClient` |
| Object storage | `@aws-sdk/client-s3` | `Bun.S3Client` |
| Files | `node:fs/promises` | `Bun.file()`, `Bun.write()` |
| Password hashing | `@node-rs/argon2` | `Bun.password`, `bcrypt` |
| Sortable ids | `randomUUIDv7()` from `@orbit/shared/utils` | `ulid`, `nanoid` |
| Tests | `bun test` | `vitest`, `jest` |

Test files and `apps/realtime` are exempt, because they only ever run under Bun.
`packages/realtime-server` is not exempt, because the web app imports it.

**3. No comments in code.** `bun run check-comments` fails the build on any
comment that is not a functional directive such as `@ts-expect-error` or
`biome-ignore`. This is not a style preference. A comment drifts from the code
it describes and then lies to the next reader. Put the meaning in the name:

```ts
// Wrong
// check if the user can edit
if (r === 'admin' || r === 'member') { }

// Right
if (canEdit(role)) { }
```

Prose belongs in `docs/`, in the pull request description, and in commit
messages, where it is dated and attributed and nobody mistakes it for truth
about the current line.

**4. Strict types only.** `any` is a lint error. Non-null assertions are a lint
error. `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` are on. Parse
every external input with a Zod schema from `@orbit/shared`, never trust a
request body, and never reach for a cast to make the compiler quiet.

**5. No em-dash characters** in code, copy, docs or commit messages. Use a
comma, a colon, or two sentences.

**6. Authorization goes through `packages/shared/src/policy`.** Server routes
enforce it. The UI reads the same policy to hide buttons, never as the only
gate. A check that exists only in a React component is not a check.

**7. Motion stays cheap.** Nothing that triggers reflow may animate. Entrance,
exit and gesture motion is transform and opacity only. Everything respects
`prefers-reduced-motion`, nothing runs longer than 200ms, and durations and
easings come from the shared tokens in `apps/web/src/lib/interaction.ts` rather
than being hand written at the call site.

**8. Never hardcode a colour.** Light and dark are both first class. Use the CSS
custom properties.

**9. No AI attribution** in commits, branches, pull requests, code or docs. Use
whatever tools you like, and sign your own work.

## Writing tests

A feature is not done until it has a test that would fail if the feature broke.
That is the bar, and it is the one thing reviewers push back on most.

- Tests live in each package's own `tests/` tree, mirroring `src/`. `src/a/b/thing.ts`
  is tested by `tests/a/b/thing.test.ts`. Never beside the code.
- Import from `bun:test`, never from `vitest`.
- Database tests run against the real Postgres in a transaction that rolls back.
  `scripts/test-env.ts` refuses to run against a database whose name does not
  contain `test`, so you cannot wipe your dev data by accident.
- Bun's scanner skips directories whose name starts with a dot. A test for
  something under `src/app/.well-known/` goes in `tests/app/well-known/` or it
  silently never runs, and a test that never runs is worse than no test.
- End to end tests are Playwright, in `apps/web/e2e`.

[docs/testing.md](docs/testing.md) has the longer version.

## Editor and assistant setup

Use whatever tooling you like. The repository carries its own context files so
that an editor or assistant picks up the conventions without you explaining them
every time.

- [`CLAUDE.md`](CLAUDE.md) is the full context file: architecture, hard rules,
  the toolchain table, the conventions.
- [`AGENTS.md`](AGENTS.md) points at the same file for tools that look for that
  name instead.
- Orbit's own MCP server can expose the board to a connected editor. See
  [docs/mcp.md](docs/mcp.md).

Whatever you use, you are the author of what you send. Read your own diff first,
and run `bun run verify` before you push rather than leaving the reviewer to find
it. The comment policy and the strict type settings reject a lot of generated
code, so this is where that shows up.

## Sending a pull request

Branch from `main`, one unit of work per branch, several small commits inside it.

```bash
git checkout -b feat/board-drag-reorder
```

Commit subjects are imperative and scoped:

```
feat(issues): add board drag reorder
fix(realtime): drop connections whose session expired
docs(mcp): explain the scope a write tool needs
test(policy): cover the guest role on private views
chore(deps): move biome to 2.5.5
```

Scopes we use: `issues`, `docs`, `sprints`, `cycles`, `projects`, `realtime`,
`mcp`, `auth`, `web`, `db`, `policy`, `deps`, `ci`.

Then:

1. Run `bun run verify` and get all four checks green.
2. Push and open a pull request into `main`.
3. Fill in the template. The part reviewers actually read is what you changed
   and how you know it works.
4. Link the issue with `Closes #123`.
5. Add screenshots or a short screen recording for anything visual. Both themes
   if you touched styling.

Small pull requests get reviewed in hours. A 2000 line one waits for a weekend.
If a change is genuinely large, split it: schema first, then the API, then the
UI. Each one merges on its own and none of them is scary.

## Review and merge

Two bots review this repository. Greptile carries the most weight, so work
through its findings first. CodeRabbit is secondary, and it sometimes reports
`Review rate limited`, which is not a real review. When that happens, re-run it
and wait rather than merging on the rate limited result.

Every thread ends one of two ways, and both are fine:

- Fix the code, push, resolve the thread.
- Disagree, reply explaining why the finding does not apply, resolve the thread.

What is not fine is merging with a thread left open, or resolving one silently.
A merge state of `UNSTABLE` means a review has not finished, so it is a block
and not a warning.

Before merging, merge current `main` into your branch and let every check run
again. A branch that is green against the `main` it forked from proves nothing
about the `main` it is about to land on.

Maintainers squash on merge. Your commits stay in the pull request, and `main`
keeps one commit per unit of work.

## Reporting bugs

Use the [bug report form](https://github.com/Noveum/orbit/issues/new?template=bug_report.yml).
The three things that decide whether a bug gets fixed this week or next quarter:

1. Exact steps to reproduce, starting from the seeded demo workspace.
2. What you expected, and what happened instead.
3. Whether it reproduces on <https://orbit.noveum.ai> or only on your machine.

For realtime bugs, say how many tabs and browsers were open and whether the
"Reconnecting to live updates" banner appeared, since that one line separates
two completely different causes.

**Never put a security issue in a public issue.** See
[SECURITY.md](SECURITY.md).

## Proposing features

Orbit is opinionated on purpose. It says no to plenty, and it will keep saying
no, because a task manager that does everything is the reason people are looking
for a replacement in the first place.

A proposal lands well when it explains the workflow that is currently painful,
rather than the widget you want. "I cannot see which issues are blocked before
standup" gets built. "Add a Gantt chart" gets a question back.

Three things are permanently off the table:

- **Pricing, billing, plans, seats, usage limits, or any code that counts what a
  workspace is allowed to do.** There are no paid tiers, and there is no
  scaffolding for a future paid tier.
- **Telemetry that phones home.** Your data stays in your Postgres.
- **A second way to do something Orbit already does.** We would rather fix the
  first way.

## Getting help

- [Discussions](https://github.com/Noveum/orbit/discussions) for questions and
  ideas.
- [Issues](https://github.com/Noveum/orbit/issues) for bugs and concrete work.
- [docs/](docs/README.md) for everything else.

Ask early. A question on a Tuesday beats a rewrite on a Friday.

By contributing you agree that your contribution is licensed under the
[Apache License 2.0](LICENSE), and that you have the right to license it.

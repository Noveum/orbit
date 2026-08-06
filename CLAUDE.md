# Orbit

Free, realtime, keyboard-first work tracker. Linear-grade UX, Plane-grade breadth, plus docs, files, notifications, Slack, and an MCP server. No pricing, no billing, no paid tiers anywhere.

## Hard rules

1. **Bun is the package manager and the script runner.** There is no pnpm, no npm, no yarn, no Turbo, and no `node_modules` produced by anything but `bun install`. Every command in this file starts with `bun`. The deployed runtime is node, so shipped code must not import a Bun built-in.
2. **No comments in code.** Ever. `bun run check-comments` fails the build on any comment that is not a functional directive (`@ts-*`, `biome-ignore`, `eslint-*`, `/*! license */`). Make names and structure carry meaning.
3. **No AI attribution.** Never mention Claude, Anthropic, Codex, or AI tooling in commits, branches, PRs, code, or docs.
4. **No em-dash characters** in code, copy, docs, or commit messages. Use commas, colons, or separate sentences.
5. **Strict types only.** `any` is a lint error. Non-null assertions are a lint error. `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` are on. Validate every external input with Zod.
6. **Every check green before you finish.** `bun run verify` runs lint, comment policy, typecheck, and tests.

## Bun is the toolchain, not the runtime

Bun installs, runs scripts, and runs tests. Shipped server code must not call a
Bun built-in, because the web app runs on Vercel's node runtime: that is the only
runtime where a Vercel function can upgrade a websocket, and `/api/ws` needs it.
Anything imported from `bun` fails there with `Cannot find module 'bun'`.

| Need | Use | Never use |
| --- | --- | --- |
| Postgres | `postgres.js` through `drizzle-orm/postgres-js` | `Bun.SQL`, `drizzle-orm/bun-sql`, `pg` |
| Redis and pub/sub | `ioredis` | `Bun.RedisClient`, `node-redis` |
| Object storage | `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` | `Bun.S3Client` |
| Reading and writing files | `node:fs/promises` | `Bun.file()`, `Bun.write()` |
| Hashing passwords | `@node-rs/argon2` (argon2id) | `Bun.password`, `bcrypt` |
| Sortable ids | `randomUUIDv7()` from `@orbit/shared/utils` | `Bun.randomUUIDv7()`, `ulid`, `nanoid` |
| WebSocket server | `ws`, upgraded by `@vercel/functions` | `Bun.serve({ websocket })` in shipped code |
| Running TypeScript | `bun file.ts` | `tsx`, `ts-node` |
| Tests | `bun test` | `vitest`, `jest` |
| Subprocesses | `Bun.spawn`, `Bun.$` | `node:child_process` |
| Workspace script running | `bun run --filter '<pattern>' <script>` | `turbo`, `nx`, `lerna` |
| Env files | `bun --env-file=...` | `dotenv` |

Test files and `apps/realtime` may use Bun built-ins, because both only ever run
under Bun. `packages/realtime-server` is imported by the web app, so it may not.

Bun does not implement `process.loadEnvFile`. Load the repository `.env` with `bun --env-file=../../.env` in the script, never from inside a config file.

Bun does not load a parent directory `.env`, so a script running with its cwd inside a workspace package needs `--env-file=../../.env` to see the repository environment.

## Layout

```
apps/web                  Next.js 16 app: UI, REST route handlers, auth, webhooks,
                          the realtime socket at /api/ws and the MCP server at /mcp
apps/realtime             Bun.serve WebSocket host, local development only, never deployed
packages/realtime-server  Connection hub: tickets, scopes, presence, Redis fan-out
packages/mcp-server       MCP tools and the fetch handler behind /mcp
packages/db               Drizzle schema, migrations, client, seed
packages/shared           Zod validators, domain types, event contracts, pure utils
scripts/                  repo tooling, written in TypeScript and run with bun
extras/                   working notes, task board, demo artifacts (not shipped)
```

Everything ships as one Next.js app on a single Vercel project. The realtime hub
and the MCP tools live in packages so the app stays thin and both keep their own
test suites. `apps/realtime` exists only so local development has a socket server,
because a Vercel function cannot upgrade a connection under `next dev`.

Cross-app code lives in `packages/shared`. If two apps need it, it belongs there, never duplicated.

## Commands

```
bun install          install every workspace dependency
bun run infra:up     start postgres, redis, minio
bun run db:push      apply schema to the dev database
bun run db:seed      load demo org, teams, members, issues, comments
bun run db:test-setup create the per package test databases and push the schema
bun run dev          run web, realtime, and mcp together
bun run verify       lint + comment policy + typecheck + tests
bun test             run one package's tests from inside that package
```

Ports: web 3000, realtime 3100, postgres 5434, redis 6380, minio 9010. The realtime
port is development only. In production the socket is always served from the web app
at `/api/ws` on the page's own origin: `configuredRealtimeUrl()` ignores
`NEXT_PUBLIC_REALTIME_URL` whenever `NODE_ENV` is `production`, so the variable is a
local development override and nothing else. Never set it on a deployed environment.
A value left over from the standalone realtime host sends the browser to a dead
origin, and because the ticket still comes from the app the failure looks like an
endless "Reconnecting to live updates" banner rather than an error.

Email goes out through Resend only. Set `RESEND_API_KEY` and an `EMAIL_FROM` on a
domain verified in Resend, otherwise every send fails.

## Conventions

- **Naming.** Files kebab-case. React components PascalCase. Hooks `use-*.ts`. Zod schemas `xSchema`, inferred types `X`. Database tables singular snake_case.
- **Imports.** Use workspace aliases `@orbit/db`, `@orbit/shared`. Inside `apps/web` use `@/`.
- **Validation.** Every route handler parses input with a Zod schema from `@orbit/shared`. Never trust a request body.
- **Errors.** Throw typed domain errors from `@orbit/shared/errors`. Route handlers map them to responses. Never swallow an error silently.
- **Server state.** TanStack Query for fetching, with optimistic mutations. The realtime stream invalidates and patches the cache; it never triggers a full refetch of a list the user is looking at.
- **Realtime.** Every mutation writes to Postgres, bumps `sync_id`, and publishes a `SyncAction` to Redis. The realtime server fans it out to subscribed clients. Contract lives in `packages/shared/src/events`.
- **Auth.** better-auth. Passkeys, Google, GitHub, magic link. Email and password is
  optional, off unless `ORBIT_PASSWORD_AUTH=true`, hashed with `@node-rs/argon2` (argon2id),
  rate limited, and never a replacement for the passwordless methods.
- **MCP auth.** OAuth only, no API keys. The web app hosts the OAuth server through the better-auth
  `mcp` plugin: discovery under `/.well-known/oauth-*`, dynamic client registration, PKCE, and a
  consent screen at `/oauth/authorize` where the user picks a workspace and re-verifies a passkey. The
  standalone MCP server validates the access token against the shared database (`verifyMcpAccessToken`)
  and returns a `WWW-Authenticate` challenge on `401`. A `mcp_grant` row binds a client and user to the
  chosen workspace.
- **Email domains.** `ALLOWED_EMAIL_DOMAINS` is a comma-separated allowlist enforced on invite
  creation and on user creation, so it covers every provider. Empty means no restriction. A
  workspace can narrow it further with its own `allowedEmailDomains`.
- **Permissions.** All authorization goes through `packages/shared/src/policy`. Server routes enforce it. The UI reads the same policy to hide affordances, never as the only gate.
- **Motion.** No layout animation on the critical path, ever: nothing that triggers reflow may animate. Entrance, exit and gesture motion is transform and opacity only. Hover and focus state changes may additionally transition colour, which is what the measured Linear behaviour does, but only through the shared tokens in `apps/web/src/lib/interaction.ts` so the set stays auditable, never hand-rolled at a call site. Micro-interactions such as row and item highlights may go as fast as 80ms; nothing exceeds 200ms; everything respects `prefers-reduced-motion`.
- **Theming.** Light and dark both first class, driven by CSS custom properties and `next-themes`. Never hardcode a hex value in a component.
- **Accessibility.** Keyboard operable everywhere, visible focus rings, real semantics from Radix primitives.

## Testing

- Unit and integration: `bun test`. Tests live in each package's own `tests/` tree, mirroring the
  layout of `src/`, never beside the code. `src/a/b/thing.ts` is tested by `tests/a/b/thing.test.ts`.
  Bun's scanner skips directories whose name starts with a dot, so a test for something under
  `src/app/.well-known/` goes in `tests/app/well-known/` or it silently never runs.
- Import test helpers from `bun:test`, never from `vitest`.
- A package that needs environment or a DOM configures it in its own `bunfig.toml` with a `tests-preload.ts`. DOM tests register happy-dom in that preload.
- Database tests run against the real Postgres from docker compose, in a transaction that rolls back. `scripts/test-env.ts` refuses to run against a database whose name does not contain `test`.
- Each package owns an isolated database (`orbit_test_core`, `orbit_test_svc`, `orbit_test_rt`, `orbit_test_rts`, `orbit_test_mcp`, `orbit_test_web`). Run `bun run db:test-setup` once after `bun run infra:up`, otherwise `bun run verify` fails on a clean checkout with connection errors rather than test failures.
- Two test runs at once need two lanes. Set `ORBIT_TEST_LANE` to anything unique and the suite uses `orbit_test_core_<lane>` instead, where the lane is a readable stub plus a digest of the raw value so two lanes that normalise alike stay apart, cloned from the base database on first use, so a `resetDatabase` in one run cannot truncate tables out from under another. Without the variable nothing changes. This matters whenever several agents or worktrees run tests against the same Postgres: sharing one database shows up as deadlocks and foreign key violations that look like real failures. `bun run db:test-lanes-drop` removes every lane database and leaves the six base ones alone.
- End to end: Playwright in `apps/web/e2e`.
- A feature is not done until it has tests that would fail if the feature broke.

## Deployment

Orbit is one Vercel project. The root directory is `apps/web`, the build runs
`bun run build` there, and functions serve on the node runtime. Nothing is
containerised and nothing runs in Kubernetes.

The node runtime is not optional. `/api/ws` upgrades through
`experimental_upgradeWebSocket` from `@vercel/functions`, and Vercel only injects
that upgrade bridge on node. Setting `bunVersion` in `apps/web/vercel.json` moves
every function to the bun runtime, where the upgrade silently never happens and
the client just retries against a socket that never opens.

Upgrade before doing any other work in that route. Awaiting redis, the database
or anything else first stops the handshake reaching a 101, so attach the hub
after the socket is open and buffer whatever arrives in between.

Migrations are applied locally against the target database, never by a job in the
platform, so any schema change must be pushed before the code that depends on it
ships.

## Git

- Branch per unit of work, PR into `main`, several small commits per PR.
- Commit subject in imperative mood, scoped: `feat(issues): add board drag reorder`.
- Never commit `.env`, uploads, or recordings.

## Review before merge

Two bots review this repository. **Greptile carries the most weight**: treat its
findings as the primary gate and work through them first. CodeRabbit is
secondary. It sometimes reports `Review rate limited`, which is not a real
review: when that happens, re-run it and wait for it to complete rather than
merging on the rate-limited result. Both reviews should complete before merge;
Greptile is the one whose findings are weighted most heavily.

Never merge while a review is still running, and never merge with a thread left
open. Green CI is not enough on its own. A merge state of `UNSTABLE` means a
review has not finished, so treat it as a block rather than a warning.

Before merging, merge the current `main` into the branch and let every check run
again against that merged state. A branch that is green against the `main` it
forked from proves nothing about the `main` it is about to land on, and with
several streams in flight `main` moves under all of them.

Each thread ends one of two ways, and both are acceptable:

- Fix the code, push the change, and resolve the thread.
- Disagree, reply on the thread explaining why the finding does not apply, and
  resolve it.

What is not acceptable is merging with a thread left open, or resolving one
silently without either a fix or a reply.

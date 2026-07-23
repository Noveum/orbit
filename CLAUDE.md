# Orbit

Free, realtime, keyboard-first work tracker. Linear-grade UX, Plane-grade breadth, plus docs, files, notifications, Slack, and an MCP server. No pricing, no billing, no paid tiers anywhere.

## Hard rules

1. **Bun is the runtime, the package manager, and the script runner.** There is no pnpm, no npm, no yarn, no Node runtime, no Turbo, and no `node_modules` produced by anything but `bun install`. Every command in this file starts with `bun`. Reach for a Bun built-in before adding a dependency.
2. **No comments in code.** Ever. `bun run check-comments` fails the build on any comment that is not a functional directive (`@ts-*`, `biome-ignore`, `eslint-*`, `/*! license */`). Make names and structure carry meaning.
3. **No AI attribution.** Never mention Claude, Anthropic, Codex, or AI tooling in commits, branches, PRs, code, or docs.
4. **No em-dash characters** in code, copy, docs, or commit messages. Use commas, colons, or separate sentences.
5. **Strict types only.** `any` is a lint error. Non-null assertions are a lint error. `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` are on. Validate every external input with Zod.
6. **Every check green before you finish.** `bun run verify` runs lint, comment policy, typecheck, and tests.

## Bun first

Prefer the built-in over the package. These are the ones this repo already relies on, and new code must use them rather than reintroducing an SDK:

| Need | Use | Never use |
| --- | --- | --- |
| Postgres | `Bun.SQL` through `drizzle-orm/bun-sql` | `pg`, `postgres.js` |
| Redis and pub/sub | `Bun.RedisClient` (`subscribe`, `unsubscribe`, `publish`) | `ioredis`, `node-redis` |
| WebSocket server | `Bun.serve({ websocket })` and its native topic pub/sub | `ws`, `socket.io` |
| Object storage | `Bun.S3Client` (`write`, `file`, `presign`, `stat`, `delete`) | `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner` |
| Reading and writing files | `Bun.file()`, `Bun.write()` | `node:fs` |
| Running TypeScript | `bun file.ts` | `tsx`, `ts-node` |
| Bundling a service | `bun build --target=bun` | `esbuild`, `rollup` |
| Tests | `bun test` | `vitest`, `jest` |
| Subprocesses | `Bun.spawn`, `Bun.$` | `node:child_process` |
| Hashing passwords | `Bun.password` (argon2id) | `bcrypt`, `argon2` |
| Sortable ids | `Bun.randomUUIDv7()` | `ulid`, `uuid`, `nanoid` |
| Env files | `bun --env-file=...` | `dotenv` |
| Workspace script running | `bun run --filter '<pattern>' <script>` | `turbo`, `nx`, `lerna` |

Bun does not implement `process.loadEnvFile`. Load the repository `.env` with `bun --env-file=../../.env` in the script, never from inside a config file.

Bun's `S3Client` reads ambient `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` and
`AWS_SESSION_TOKEN` and snapshots them when the process starts. Deleting them from
`process.env` or `Bun.env` afterwards does nothing, and passing an empty or
undefined `sessionToken` does not suppress them either. When explicit keys are also
configured the ambient session token is still attached to the signature and every
request fails with `InvalidTokenId`, which is exactly how a broken PDF upload
presents. `S3StorageDriver` therefore presigns a probe URL at construction and
refuses to start if a session token leaked in. If you hit that error locally,
start the process with the variable unset:

```
env -u AWS_SESSION_TOKEN -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY bun run dev
```

Bun does not load a parent directory `.env`, so a script running with its cwd inside a workspace package needs `--env-file=../../.env` to see the repository environment.

## Layout

```
apps/web         Next.js 16 app: UI, REST route handlers, auth, webhooks
apps/realtime    Bun.serve WebSocket server, fans out deltas from Redis pub/sub
apps/mcp         MCP server over streamable HTTP
packages/db      Drizzle schema, migrations, client, seed
packages/shared  Zod validators, domain types, event contracts, pure utils
scripts/         repo tooling, written in TypeScript and run with bun
extras/          working notes, task board, demo artifacts (not shipped)
```

Cross-app code lives in `packages/shared`. If two apps need it, it belongs there, never duplicated.

## Commands

```
bun install          install every workspace dependency
bun run infra:up     start postgres, redis, minio
bun run db:push      apply schema to the dev database
bun run db:seed      load demo org, teams, members, issues, comments
bun run dev          run web, realtime, and mcp together
bun run verify       lint + comment policy + typecheck + tests
bun test             run one package's tests from inside that package
```

Ports: web 3000, realtime 3100, mcp 3200, postgres 5434, redis 6380, minio 9010.

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
  optional, off unless `ORBIT_PASSWORD_AUTH=true`, hashed with `Bun.password` (argon2id),
  rate limited, and never a replacement for the passwordless methods.
- **Email domains.** `ALLOWED_EMAIL_DOMAINS` is a comma separated allowlist enforced on invite
  creation and on user creation, so it covers every provider. Empty means no restriction. A
  workspace can narrow it further with its own `allowedEmailDomains`.
- **Permissions.** All authorization goes through `packages/shared/src/policy`. Server routes enforce it. The UI reads the same policy to hide affordances, never as the only gate.
- **Motion.** Transform and opacity only, 120 to 200ms, respect `prefers-reduced-motion`. No layout animation on the critical path.
- **Theming.** Light and dark both first class, driven by CSS custom properties and `next-themes`. Never hardcode a hex value in a component.
- **Accessibility.** Keyboard operable everywhere, visible focus rings, real semantics from Radix primitives.

## Testing

- Unit and integration: `bun test`. Colocate as `*.test.ts` beside the unit under test.
- Import test helpers from `bun:test`, never from `vitest`.
- A package that needs environment or a DOM configures it in its own `bunfig.toml` with a `tests-preload.ts`. DOM tests register happy-dom in that preload.
- Database tests run against the real Postgres from docker compose, in a transaction that rolls back. `scripts/test-env.ts` refuses to run against a database whose name does not contain `test`.
- End to end: Playwright in `apps/web/e2e`.
- A feature is not done until it has tests that would fail if the feature broke.

## Deployment

Every image is built `FROM oven/bun` and runs `bun` as its entrypoint. There is no
`turbo prune`: each Dockerfile copies the root `package.json`, `bun.lock` and every
workspace `package.json`, runs `bun install --frozen-lockfile`, then copies sources.

`bun install --frozen-lockfile` exits 0 when there is no lockfile at all, so a
`.dockerignore` mistake would silently produce a floating dependency tree instead
of failing. Every Dockerfile asserts `test -s bun.lock` before installing. Keep
that line.

Bun's resident memory for the Next.js server runs roughly 60 to 80 percent above
Node's, and Bun has no equivalent of `--max-old-space-size`, so there is no heap
ceiling to set. The web pod is sized for that: 512Mi requested, 2Gi limit. Watch
RSS after a deploy rather than assuming it plateaus.

Rolling the web service back to Node means editing `apps/web/Dockerfile` (runner
stage to `node:24-alpine`, `CMD` to `node`). Editing only the k8s manifest does
nothing: in `oven/bun` images `node` is a symlink to `bun`, so
`command: [..., "node", ...]` still runs Bun, silently.

CodeBuild does not trigger automatically. Deploy by hand:

```
KUBE_API_SERVER=http://127.0.0.1:8080 ./extras/scripts/docker-build-push.sh -y
```

Name services to narrow it, for example `... docker-build-push.sh web mcp -y`.

## Git

- Branch per unit of work, PR into `main`, several small commits per PR.
- Commit subject in imperative mood, scoped: `feat(issues): add board drag reorder`.
- Never commit `.env`, uploads, or recordings.

## Review before merge

Never merge a pull request while a CodeRabbit review thread is unresolved, and
never merge while its review is still running. Green CI is not enough on its
own: wait for the review to finish, then deal with every thread it opens.

Each thread ends one of two ways, and both are acceptable:

- Fix the code, push the change, and resolve the thread.
- Disagree, reply on the thread explaining why the finding does not apply, and
  resolve it.

What is not acceptable is merging with a thread left open, or resolving one
silently without either a fix or a reply. A merge state of `UNSTABLE` means the
review has not finished, so treat it as a block rather than a warning.

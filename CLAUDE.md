# Orbit

Free, realtime, keyboard-first work tracker. Linear-grade UX, Plane-grade breadth, plus docs, files, notifications, Slack, and an MCP server. No pricing, no billing, no paid tiers anywhere.

## Hard rules

1. **No comments in code.** Ever. `pnpm check-comments` fails the build on any comment that is not a functional directive (`@ts-*`, `biome-ignore`, `eslint-*`, `/*! license */`). Make names and structure carry meaning.
2. **No AI attribution.** Never mention Claude, Anthropic, Codex, or AI tooling in commits, branches, PRs, code, or docs.
3. **No em-dash characters** in code, copy, docs, or commit messages. Use commas, colons, or separate sentences.
4. **Strict types only.** `any` is a lint error. Non-null assertions are a lint error. `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` are on. Validate every external input with Zod.
5. **Every check green before you finish.** `pnpm verify` runs lint, comment policy, typecheck, and tests.

## Layout

```
apps/web         Next.js 16 app: UI, REST route handlers, auth, webhooks
apps/realtime    Node WebSocket server, fans out deltas from Redis pub/sub
apps/mcp         MCP server over streamable HTTP
packages/db      Drizzle schema, migrations, client, seed
packages/shared  Zod validators, domain types, event contracts, pure utils
scripts/         repo tooling
extras/          working notes, task board, demo artifacts (not shipped)
```

Cross-app code lives in `packages/shared`. If two apps need it, it belongs there, never duplicated.

## Commands

```
pnpm infra:up        start postgres, redis, minio
pnpm db:push         apply schema to the dev database
pnpm db:seed         load demo org, teams, members, issues, comments
pnpm dev             run web, realtime, and mcp together
pnpm verify          lint + comment policy + typecheck + tests
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
- **Auth.** better-auth. Passkeys, Google, GitHub, magic link. Passwords are disabled and must stay disabled.
- **Permissions.** All authorization goes through `packages/shared/src/policy`. Server routes enforce it. The UI reads the same policy to hide affordances, never as the only gate.
- **Motion.** Transform and opacity only, 120 to 200ms, respect `prefers-reduced-motion`. No layout animation on the critical path.
- **Theming.** Light and dark both first class, driven by CSS custom properties and `next-themes`. Never hardcode a hex value in a component.
- **Accessibility.** Keyboard operable everywhere, visible focus rings, real semantics from Radix primitives.

## Testing

- Unit and integration: Vitest. Colocate as `*.test.ts` beside the unit under test.
- Database tests run against the real Postgres from docker compose, in a transaction that rolls back.
- End to end: Playwright in `apps/web/e2e`.
- A feature is not done until it has tests that would fail if the feature broke.

## Git

- Branch per unit of work, PR into `main`, several small commits per PR.
- Commit subject in imperative mood, scoped: `feat(issues): add board drag reorder`.
- Never commit `.env`, uploads, or recordings.

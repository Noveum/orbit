# Agent instructions

Read [`CLAUDE.md`](CLAUDE.md) first. It is the full context file for this
repository and it is kept current: architecture, layout, the toolchain table,
the conventions and the hard rules. This file exists so that assistants which
look for `AGENTS.md` rather than `CLAUDE.md` find their way there.

[`CONTRIBUTING.md`](CONTRIBUTING.md) covers the human side: how to pick work,
how to test, and how a pull request is reviewed.

## The short version

Orbit is a free, realtime, keyboard-first work tracker. One Next.js app on
Vercel's node runtime, with the realtime hub and the MCP tools in workspace
packages.

```bash
bun install
cp .env.example .env
bun run infra:up
bun run db:push && bun run db:test-setup && bun run db:seed
bun run dev
bun run verify     # lint, comment policy, types, tests
```

## Rules that will fail the build

1. **Bun only.** No npm, pnpm, yarn or turbo. Every command starts with `bun`.
2. **Shipped server code must not import a Bun built-in.** The deployed runtime
   is node. Use `postgres.js`, `ioredis`, `@aws-sdk/client-s3`,
   `node:fs/promises`, `@node-rs/argon2` and `randomUUIDv7()` from
   `@orbit/shared/utils`. Test files and `apps/realtime` are exempt.
3. **No comments in code.** `bun run check-comments` fails on anything that is
   not a functional directive such as `@ts-expect-error` or `biome-ignore`. Put
   the meaning in names and structure. Explanations go in the pull request or in
   `docs/`.
4. **No em-dash characters** anywhere, including commit messages.
5. **No AI attribution** in commits, branches, pull requests, code or docs.
6. **Strict types.** `any` and non-null assertions are lint errors.
   `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` are on. Parse
   external input with a Zod schema from `@orbit/shared`.
7. **Tests live in each package's `tests/` tree**, mirroring `src/`, never
   beside the code. Import from `bun:test`.
8. **Authorization goes through `packages/shared/src/policy`** and is enforced
   on the server. A check that exists only in a component is not a check.

## Before you report a task finished

Run `bun run verify` and get all four checks green. Then check the diff for
comments you added out of habit and for em-dashes, since those two are the most
common reasons an otherwise good change bounces in review.

A feature is not done until it has a test that would fail if the feature broke.

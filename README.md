<h1>
  <img src="apps/web/public/logo.png" alt="" height="30" valign="middle" />
  Orbit
</h1>

A free, realtime, keyboard-first work tracker. Issues, cycles, projects, and docs that update the moment anyone changes anything, with markdown everywhere, file attachments, notifications, Slack, and an MCP server for AI tooling.

No pricing, no billing, no paid tiers.

[Bun](https://bun.sh) is the toolchain: it installs the workspace, runs every
script, executes the TypeScript and runs the tests. Orbit ships as a single
Next.js app on Vercel's node runtime, which is the runtime that can upgrade the
websocket at `/api/ws`.

```bash
bun install
cp .env.example .env
bun run infra:up
bun run db:push
bun run db:test-setup
bun run db:seed
bun run dev
```

| Service | Port |
| --- | --- |
| web | 3000 |
| realtime (development only) | 3100 |
| postgres | 5434 |
| redis | 6380 |
| minio | 9010 |

`bun run verify` runs lint, the comment policy, types, and tests. All four must be
green before a pull request.

<h1>
  <img src="apps/web/public/logo.png" alt="" height="30" valign="middle" />
  Orbit
</h1>

A free, realtime, keyboard-first work tracker. Issues, cycles, projects, and docs that update the moment anyone changes anything, with markdown everywhere, file attachments, notifications, Slack, and an MCP server for AI tooling.

No pricing, no billing, no paid tiers.

Orbit runs on [Bun](https://bun.sh) end to end: Bun installs the workspace, runs
every script, executes the TypeScript, serves the WebSockets, talks to Postgres,
Redis and S3 through Bun built-ins, runs the tests, and is the runtime inside
every container image.

```bash
bun install
cp .env.example .env
bun run infra:up
bun run db:push
bun run db:seed
bun run dev
```

| Service | Port |
| --- | --- |
| web | 3000 |
| realtime | 3100 |
| mcp | 3200 |
| postgres | 5434 |
| redis | 6380 |
| minio | 9010 |

`bun run verify` runs lint, the comment policy, types, and tests. All four must be
green before a pull request.

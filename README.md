# Orbit

A free, realtime, keyboard-first work tracker. Issues, cycles, projects, docs, files, notifications, Slack, and an MCP server for AI tooling.

## Quick start

```bash
pnpm install
cp .env.example .env
pnpm infra:up
pnpm db:push
pnpm db:seed
pnpm dev
```

Open http://localhost:3000.

## Services

| Service   | Port | Notes                       |
| --------- | ---- | --------------------------- |
| web       | 3000 | Next.js app and REST API    |
| realtime  | 3100 | WebSocket delta fan-out     |
| mcp       | 3200 | MCP streamable HTTP server  |
| postgres  | 5434 | primary datastore           |
| redis     | 6380 | pub/sub and queues          |
| minio     | 9010 | S3 compatible object store  |
| mailpit   | 8025 | captured outbound email     |

## Checks

```bash
pnpm verify
```

Runs Biome lint and format, the no-comment policy, TypeScript, and the test suites. Biome is the only linter and formatter in this repo.

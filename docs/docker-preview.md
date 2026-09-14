# Docker Compose preview

This template packages Orbit's standalone Node application with Postgres, Redis,
and MinIO for evaluation on your own computer. It is not a production deployment
contract. Realtime still requires Vercel, so refresh other clients to see changes.
Use [the Vercel guide](self-hosting.md#deploy-on-vercel) for realtime deployment.

## Complete dependency map

| Capability | Dependency | Template behavior |
| --- | --- | --- |
| Tasks, workspaces, document content, document history, attachment metadata | Postgres 18 | Persistent named volume, health check, manually applied migrations |
| Cache, rate limits, event publication | Redis 8 | Private Compose network, persistent append-only volume |
| Uploaded files, images and attachments | S3-compatible object storage | MinIO with a persistent volume and private `orbit-uploads` bucket |
| Browser uploads and previews | Browser-reachable S3 endpoint and CORS | `http://orbit-storage.localhost:9000`, CORS scoped to `http://127.0.0.1:33170` |
| First sign-in | Password, Google, GitHub, or configured Resend | Password sign-up enabled; fresh secrets generated locally |
| Email OTP, invitations, password-reset email, email notifications | Resend and a verified sender domain | Not configured; supply your own credentials to enable |
| Realtime, presence, live updates | Vercel Node WebSocket upgrade context | Unavailable in standalone Docker |
| Notification retries and sprint rollover | Scheduled authenticated HTTP requests | Not scheduled in this local preview |
| Analytics snapshots and retention cleanup | Scheduled authenticated HTTP requests | Not scheduled in this local preview |
| GitHub integration | GitHub App credentials and webhook secret | Optional, not configured |
| Slack integration | Slack app credentials and feature flag | Optional, disabled |
| Remote MCP | This application's `/mcp` route and OAuth | Embedded in web; no additional MCP container or external API key |

Orbit's document editor does not require Notion, an external document database,
or a separate editor server. Document data is in Postgres; uploaded files are in
MinIO. Back up both together. A database-only backup does not preserve file bytes.

## Start a fresh evaluation

Install Bun 1.3.14 or newer and Docker with Compose v2. Run from the repository root.
Docker needs enough free memory for a full Next.js build in addition to the
database and storage services. Concurrent builds can exhaust Docker Desktop's
memory even when the host still has free memory. The tooling container uses CPU
cores 0 and 1 to bound Next.js worker fan-out. On a single-core Docker engine, add
`ORBIT_PREVIEW_BUILD_CPUS=0` to `.env.docker.local`.

```bash
bun run preview:init
bun run preview:tools
bun run preview:infra
bun run preview:migrate
bun run preview:build
bun run preview:up
bun run preview:status
```

Open `http://127.0.0.1:33170`, create an account with email and password, and
complete workspace onboarding. No demo users or public passwords are installed.
This is a separate Compose project from the development stack.

Initialization creates `.env.docker.local` with three independent random secrets
and owner-only file permissions. It refuses to overwrite an existing file, because
changing a database password in an environment file does not rotate an existing
database. Keep the file private and preserve it across restarts and upgrades.

The tooling image installs with Bun and builds Linux-native dependencies. The
operator runs migrations explicitly before building. The runtime image contains
the standalone output and runs on Node 22 as a non-root user. It does not install
dependencies, migrate the database, or start a development server on boot.

Both web and storage bind to loopback. Postgres and Redis expose no host ports.
The MinIO console is not exposed. The storage hostname is a Docker network alias
inside containers and a loopback hostname in the browser, so signatures use the
same URL on both sides. If your OS does not resolve `orbit-storage.localhost`, add
`127.0.0.1 orbit-storage.localhost` to its hosts file. Ports 33170 and 9000 must be free.

## Verify docs and files

After onboarding, create a document with a heading and paragraph, reload it,
and confirm the content persists. Upload a small image, a PDF and a text file;
open each preview and download it. Restart the stack and confirm both document
content and file downloads remain available.

The storage probe exercises Orbit's actual storage driver, presigned PUT and GET,
object metadata, and CORS using temporary objects that it deletes afterward:

```bash
bun run preview:storage-check
```

A healthy `/api/health` response alone does not prove sign-in, database access,
document persistence, or file uploads. Do those checks before relying on the setup.

## Stop and upgrade

```bash
bun run preview:down
bun run preview:up
```

`preview:down` preserves all named volumes. Do not use `down -v` unless you intend
to erase the evaluation database and files. To upgrade, back up the database and
bucket, update the checkout, then repeat `preview:tools`, `preview:migrate`,
`preview:build` and `preview:up`. Run one build at a time. A failed build does not
replace the currently running image.

## Publishing a provider template

This directory is an evaluation template, not a ready-made Railway, Render,
Coolify or Docker Hub production listing. A public deployment must replace the
loopback origins with HTTPS URLs, route object storage to a browser-reachable
hostname, configure scoped CORS, use appropriately restricted storage credentials,
complete real authentication, and provide backups and an upgrade procedure.

Scheduled jobs are declared in `apps/web/vercel.json`: notifications and sprint
rollover every minute, analytics snapshots every six hours, and pruning daily at
04:00 UTC. A non-Vercel deployment needs its own scheduler and a fresh `CRON_SECRET`
shared with the web service. Each job makes a GET request with
`Authorization: Bearer <CRON_SECRET>`. Never expose that secret in a public template.

Optional credentials must be supplied to both tooling and web through the shared
environment mapping when they affect build-time authentication. Keep
`ORBIT_DEV_LOGIN` and `NEXT_PUBLIC_REALTIME_URL` unset. Adding infrastructure alone
does not provide Vercel's WebSocket upgrade context; portable realtime remains a
separate prerequisite for a full production template.

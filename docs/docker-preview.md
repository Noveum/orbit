# Docker Compose preview

This template packages Orbit's standalone Node application with Postgres, Redis,
and MinIO for evaluation on your own computer. It is not a production deployment
contract. A Node realtime service and gateway serve same-origin WebSockets,
and a maintenance scheduler calls the application's authenticated cron routes.

## Complete dependency map

| Capability | Dependency | Template behavior |
| --- | --- | --- |
| Tasks, workspaces, document content, document history, attachment metadata | Postgres 18 | Persistent named volume, health check, manually applied migrations |
| Cache, rate limits, event publication | Redis 8 | Private Compose network, persistent append-only volume |
| Uploaded files, images and attachments | S3-compatible object storage | MinIO with a persistent volume and private `orbit-uploads` bucket |
| Browser uploads and previews | Browser-reachable S3 endpoint and CORS | `http://orbit-storage.localhost:9000`, CORS scoped to `http://127.0.0.1:33170` |
| First sign-in | Password, Google, GitHub, or configured Resend | Password sign-up enabled; fresh secrets generated locally |
| Email OTP, invitations, password-reset email, email notifications | Resend and a verified sender domain | Not configured; supply your own credentials to enable |
| Realtime, presence, live updates | Node WebSocket host, Redis and gateway | Same-origin `/api/ws`, origin checks and shared ticket authorization |
| Notification retries and sprint rollover | Scheduled authenticated HTTP requests | Every minute through the scheduler service |
| Analytics snapshots and retention cleanup | Scheduled authenticated HTTP requests | Every six hours and daily at 04:00 UTC |
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
memory even when the host still has free memory. The tooling container sets
`ORBIT_PREVIEW_BUILD=1`, which limits Next.js to one build worker without pinning
the container to particular CPU cores. Single-CPU hosts and engines without
cpuset support use the same commands. Hosted builds retain their normal settings.

```bash
bun run preview:start
```

This command checks Docker, generates credentials only when absent, builds the
tooling image, starts storage and databases, applies migrations, builds the web
image, waits for service health, and tests storage uploads and downloads. It stops
at the first failure. Retrying preserves existing credentials and data. Run only
one startup at a time. The same steps can also be run individually:

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

Initialization creates `.env.docker.local` with four independent random secrets
and owner-only file permissions. It refuses to overwrite an existing file, because
changing a database password in an environment file does not rotate an existing
database. Keep the file private and preserve it across restarts and upgrades.
`preview:start` adds a missing scheduler secret to older installations without
rotating their existing credentials.

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

When upgrading an installation that predates the scheduler, run `preview:start`
instead of those individual steps. It adds the required scheduler secret before
Compose loads the configuration, while preserving existing credentials.

The web, realtime and scheduler services share an image tagged with the Compose
project name. Keep `COMPOSE_PROJECT_NAME` stable across upgrades. Separate
installations must use different project names and host ports so their images,
networks and persistent volumes remain independent.

## Publishing a provider template

This directory is an evaluation template, not a ready-made Railway, Render,
Coolify or Docker Hub production listing. A public deployment must replace the
loopback origins with HTTPS URLs, route object storage to a browser-reachable
hostname, configure scoped CORS, use appropriately restricted storage credentials,
complete real authentication, and provide backups and an upgrade procedure.

Scheduled jobs are declared in `apps/web/vercel.json`: notifications and sprint
rollover every minute, analytics snapshots every six hours, and pruning daily at
04:00 UTC. The Docker scheduler uses the same UTC schedule and a fresh `CRON_SECRET`
shared with the web service. Each job makes a GET request with
`Authorization: Bearer <CRON_SECRET>`. Never expose that secret in a public template.

Optional credentials must be supplied to both tooling and web through the shared
environment mapping when they affect build-time authentication. Keep
`ORBIT_DEV_LOGIN` and `NEXT_PUBLIC_REALTIME_URL` unset. Run exactly one scheduler
per installation. Failed calls are logged and attempted at the next scheduled
interval; downtime is not replayed. Check scheduler logs and test a change in two
browser windows before relying on background work and live updates.

## Public VPS evaluation

Run `bun run preview:init` first, then add these values to the private
`.env.docker.local` before building:

```dotenv
ORBIT_APP_URL=https://orbit.example.com
ORBIT_STORAGE_URL=https://files.example.com
ORBIT_PASSWORD_AUTH=true
```

The Compose template forwards the app URL to authentication and the web app,
and scopes MinIO CORS to that origin. Both the browser and containers must reach
the storage URL. Terminate HTTPS at a reverse proxy forwarding the app to
`127.0.0.1:33170` and storage to `127.0.0.1:9000`. Keep the MinIO console,
Postgres and Redis private. Changing a public URL requires a rebuild.

The shared environment mapping also forwards Resend, Google sign-in, GitHub
sign-in, GitHub App, Slack and scheduler configuration from this file. Add
`RESEND_API_KEY` and `EMAIL_FROM` with a verified sender to enable email codes,
invites, password resets and email notifications. Configure the provider's
callback and webhook URLs for this installation, not another Orbit deployment.
Slack additionally requires `SLACK_ENABLED=true`.

After sign-up and workspace creation, open **Settings > Deployment setup** as a
workspace admin. It reports configuration presence without displaying secrets.
It does not test external credentials or turn this preview into a production
deployment. Follow the [first-run checklist](first-run.md) and verify each
capability against the running installation.

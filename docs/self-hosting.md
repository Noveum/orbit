# Self-hosting Orbit

> **Status: Preview.** This page documents the current Noveum AI deployment and
> evaluation paths. Orbit does not yet publish a provider-neutral production
> support, migration, rollback, backup, or compatibility contract. Review the
> [readiness tracker](open-source-readiness.md) before deploying important data.

Orbit is one Next.js app. It needs Postgres, Redis and an S3-compatible bucket,
and that is the whole architecture. There is nothing to containerise and nothing
to orchestrate.

Everything below has a free tier, so a small team can run Orbit for nothing.

## Pick your route

| Route | Effort | Best for |
| --- | --- | --- |
| [Vercel](#deploy-on-vercel) | About 20 minutes | Almost everyone. This is what we run |
| [Docker on your own server](#run-it-on-your-own-server) | About 30 minutes | Teams who want it inside their own network |

Both need the same four things.

## What Orbit needs

| Piece | What we use | Alternatives |
| --- | --- | --- |
| Postgres 16 or newer | [Supabase](https://supabase.com) | Neon, Railway, RDS, your own |
| Redis | [Upstash](https://upstash.com) | Any Redis 7 or newer, ElastiCache, your own |
| S3-compatible storage | Cloudflare R2 | AWS S3, Backblaze B2, MinIO, Supabase Storage |
| Transactional email | [Resend](https://resend.com) | None. Orbit only supports Resend |

Email is used for magic links and invites. Orbit will boot without it, but
users who rely on those flows will not be able to sign in or accept invites.

## Deploy on Vercel

### 1. Create the database

On [Supabase](https://supabase.com), create a project, then take the connection
string from **Project settings**, **Database**, **Connection string**, in URI
form.

Use the **connection pooler** string on port `6543` for `DATABASE_URL`, not the
direct one on `5432`. Serverless functions open a lot of short lived
connections, and the direct endpoint will run out of them under any real load.

Keep the direct `5432` string somewhere too. You need it once, to apply the
schema.

Any Postgres works. Neon and Railway are equally fine, and so is a Postgres you
run yourself. Orbit uses `postgres.js` through Drizzle, and no
provider-specific extensions beyond what `bun run db:push` installs itself.

### 2. Create Redis

On [Upstash](https://upstash.com), create a Redis database in the same region as
your Vercel functions, and copy the `rediss://` URL.

Redis carries the realtime fan-out. Every mutation publishes there, and the
socket layer subscribes. Region matters more than size: a Redis on another
continent adds its round trip to every live update anyone sees.

### 3. Create the bucket

Cloudflare R2 is the cheapest of these because it does not charge for egress.
Create a bucket, then create an API token with object read, write, list, and
delete permissions. AWS S3 deployments also need `s3:ListBucketVersions` and
`s3:DeleteObjectVersion` so workspace deletion removes recoverable historical
versions instead of leaving them behind.

R2 gives you an endpoint like
`https://<account-id>.r2.cloudflarestorage.com`, and the region is `auto`.

Uploads go straight from the browser to the bucket through a presigned PUT, so
the bucket has to allow your origin. Apply the CORS policy:

```bash
sed 's|__ORBIT_ORIGIN__|https://orbit.example.com|' infra/s3-cors.json > /tmp/cors.json
aws s3api put-bucket-cors --bucket "$S3_BUCKET" --cors-configuration file:///tmp/cors.json
```

Skip this and uploads fail in the browser with a CORS error while the server
logs look completely healthy.

### 4. Set up email

Create a [Resend](https://resend.com) account, verify a domain, and create an
API key. `EMAIL_FROM` has to be on the domain you verified. If it is not, every
send fails and the only symptom is that invites never arrive.

### 5. Apply the schema

**Migrations are applied from your machine, never by the platform.** There is no
migration job in the build, deliberately: a schema change that runs during a
deploy can leave you with half-migrated code serving traffic.

So push the schema before the code that needs it ships:

```bash
DATABASE_URL="postgres://...direct connection on 5432..." bun run db:push
```

Use the **direct** connection string here, not the pooler. Schema changes need a
session the pooler will not give you.

### 6. Import the project into Vercel

Import the repository, then set:

| Setting | Value |
| --- | --- |
| Framework preset | Next.js |
| Root directory | `apps/web` |
| Build command | `bun run build` |
| Install command | `bun install` |
| Node.js version | 22.x or newer |

**Do not set `bunVersion` in `apps/web/vercel.json`.** It moves every function
to the Bun runtime, where `experimental_upgradeWebSocket` silently never fires.
The app looks fine and the browser retries forever against a socket that never
opens. This is the single most expensive mistake you can make here, because
nothing errors.

### 7. Set the environment variables

In **Settings**, **Environment Variables**:

```bash
DATABASE_URL=postgres://...pooler on 6543...
REDIS_URL=rediss://...

BETTER_AUTH_SECRET=<a fresh 32+ character random string>
BETTER_AUTH_URL=https://orbit.example.com
NEXT_PUBLIC_APP_URL=https://orbit.example.com

S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
S3_REGION=auto
S3_BUCKET=orbit-uploads
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...

RESEND_API_KEY=re_...
EMAIL_FROM="Orbit <orbit@example.com>"
```

Generate the secret with `openssl rand -base64 32`. Never reuse the one from
`.env.example`, which is public.

Two variables must **not** be set:

- **`NEXT_PUBLIC_REALTIME_URL`.** In production the socket is always served from
  the page's own origin at `/api/ws`. `configuredRealtimeUrl()` ignores this
  variable when `NODE_ENV` is `production`, so it is a local development
  override and nothing else. A value left over from a standalone realtime host
  sends browsers to a dead origin, and because the ticket still comes from the
  app the failure looks like an endless "Reconnecting to live updates" banner
  rather than an error.
- **`ORBIT_DEV_LOGIN`.** It signs anyone in as any user with one click.

### 8. Deploy and check

Deploy, then:

```bash
curl https://orbit.example.com/api/health
```

You want `{"status":"ok","service":"web"}`.

Then open the app in two browser windows and change something in one. If the
other updates without a refresh, the websocket, Redis and the database are all
wired up correctly. That single test covers more than any health check.

### 9. Sign in for the first time

The first person to sign in becomes the owner of a new workspace, and onboarding
walks through naming it and creating the first team.

Set up at least one sign-in method before you invite anyone. See
[Configuration](configuration.md#authentication) for Google, GitHub, passkeys
and magic links.

## Run it on your own server

If you want Orbit inside your own network, run the Next.js standalone build
behind a reverse proxy.

```bash
git clone https://github.com/Noveum/orbit.git
cd orbit
bun install
cp .env.example .env      # then edit it for production
bun run db:push
bun run build
```

The build produces a standalone server in `apps/web/.next/standalone`. Run it
with node, not Bun:

```bash
cd apps/web
node .next/standalone/apps/web/server.js
```

Node matters for the same reason it does on Vercel: the websocket upgrade at
`/api/ws` needs it.

Your reverse proxy has to pass websocket upgrades through. In nginx:

```nginx
location /api/ws {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_read_timeout 3600s;
}

location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

The long `proxy_read_timeout` is not optional. The default is 60 seconds, which
drops every idle socket once a minute and produces a reconnect banner that comes
and goes on a timer.

You can run Postgres, Redis and MinIO from the bundled `docker-compose.yml`, but
change every credential in it first. It is written for local development and its
passwords are in this repository.

## Keeping it running

### Upgrading

```bash
git pull
bun install
bun run db:push        # against the production database, before deploying
bun run build
```

Always apply the schema before the code that depends on it goes live. Orbit
ships continuously from `main` and there is no backporting, so track `main` or a
recent tag.

Watch the [releases](https://github.com/Noveum/orbit/releases) for anything
labelled `breaking change`.

### Backups

Back up Postgres. That is where everything lives except uploaded files, which
are in the bucket. Redis holds no durable state, so losing it costs you nothing
except a reconnect.

Supabase and Neon both take automatic backups. If you run your own Postgres,
`pg_dump` on a schedule, and restore it somewhere once so you know it works.

### Scaling

Orbit is fine on the smallest tier of everything for a team of twenty. The
things that give out first, roughly in order:

1. **Postgres connections.** Use the pooler.
2. **Redis latency**, if it is in another region from the functions.
3. **Function concurrency**, which Vercel handles on its own.

## Security before you go public

Read [SECURITY.md](../SECURITY.md), which has the full checklist. The short
version:

- Fresh `BETTER_AUTH_SECRET`.
- `ORBIT_DEV_LOGIN` unset.
- `NEXT_PUBLIC_REALTIME_URL` unset.
- Postgres, Redis and storage not reachable from the internet.
- Every default credential from `docker-compose.yml` changed.
- `ALLOWED_EMAIL_DOMAINS` set if only your organisation should get in.
- Bucket CORS scoped to your origin.
- HTTPS, because sessions and the socket ticket both depend on it.

## When it does not work

| Symptom | Cause |
| --- | --- |
| Endless "Reconnecting to live updates" | `NEXT_PUBLIC_REALTIME_URL` is set in production, or the proxy is not passing upgrades |
| Live updates never arrive, no banner | `REDIS_URL` is wrong, or Redis is unreachable from the functions |
| Uploads fail in the browser, server looks fine | Bucket CORS does not allow your origin |
| Invites and magic links never arrive | `EMAIL_FROM` is not on a domain verified in Resend |
| Connection pool exhausted | `DATABASE_URL` points at the direct endpoint instead of the pooler |
| Sign-in loops back to the login screen | `BETTER_AUTH_URL` does not exactly match the origin you are visiting |
| Websocket never reaches 101 | `bunVersion` is set in `apps/web/vercel.json`, so functions run on Bun |

More in [Troubleshooting](troubleshooting.md).

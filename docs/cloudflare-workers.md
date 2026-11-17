# Running Orbit on Cloudflare Workers

The web app builds two ways from the same source. `bun run build` produces the
Next.js output that Vercel and the Docker image serve. `bun run build:workers`
produces a Cloudflare Worker with [vinext](https://github.com/cloudflare/vinext).
Nothing in `src/app` differs between the two.

This page covers what the Worker is made of, how to run it locally, how to
deploy it, and what to check before pointing a domain at it.

## What changes on Workers

| Concern | Node (Vercel, Docker) | Workers |
| --- | --- | --- |
| Build | `next build` | `vite build` with vinext, entry `apps/web/worker/index.ts` |
| Realtime socket | `/api/ws` route, hub in the function, Redis pub/sub fan-out | `/api/ws` goes to the `RealtimeHubObject` Durable Object, no Redis |
| Publishing deltas | `PUBLISH` to Redis | `fetch` to the Durable Object |
| Auth rate limits | Redis with a Lua script | `AuthRateLimiterObject` Durable Object with SQLite storage |
| Crons | `vercel.json` crons, or the Docker scheduler | Cron Triggers calling the same `/api/cron/*` routes |
| Postgres | one pool per process | one pool per request, through Hyperdrive when bound |
| Password hashing | `@node-rs/argon2` (native) | `@noble/hashes` argon2id (pure JavaScript) |
| AI provider calls | Node sockets with a pinned DNS lookup | `fetch` |
| Email templates | `react-dom/server` loaded by Node | a Vite plugin resolves the email modules to the client React build |
| Client address | `x-forwarded-for` set by the platform | `cf-connecting-ip`, copied over `x-forwarded-for` at the entry |

### Realtime

One Durable Object, addressed by the name `global`, runs the same hub code as
the Node build (`packages/realtime-server`). The client protocol is unchanged.
The differences are in what surrounds the hub:

- The hub takes a `RealtimeBus`. Node uses the Redis bus. The object uses the
  loopback bus, because every socket is in the one object and there is nothing
  to fan out to.
- Sockets are accepted with the hibernation API. Each authenticated
  connection's principal, scopes and watermark are written to the object's
  storage whenever they change, and restored when the object wakes. A wake with
  open sockets rebuilds every connection before handling the event.
- An alarm every 30 seconds sends each socket an unsolicited `pong` frame as a
  keepalive, sweeps expired presence, and every 60 seconds drops sockets whose
  session is gone. Workers cannot send protocol pings, and the client already
  accepts `pong`.
- Presence and the issue team boundary cache live in memory only. While either
  holds entries the object keeps a timer pending so it is not evicted, then
  lets itself hibernate once they expire.
- The object is created with the `apac` location hint so it sits near the
  database. Change `NEAR_THE_DATABASE` in `apps/web/worker/bindings.ts` if your
  database is elsewhere.

One object carries every workspace. That is the right size for a deployment
with hundreds of concurrent sockets. Sharding by organization is the path if it
ever is not: the ticket already names the organization, so the entry would need
it in the socket URL to route before the upgrade.

### Email

Route handlers on vinext are bundled under React's server component condition,
where `react-dom/server` refuses to load. `apps/web/vite.config.ts` therefore
resolves `react`, `react/jsx-runtime` and `react-dom/server` to their client
builds for `@react-email/*` and `packages/services/src/email`. Keep email
templates free of imports from the app's own components, or they would mix the
two builds.

### Postgres

A Worker cannot reuse a socket across requests, so `@orbit/db` gives each
request its own pool. `withRequestScopedDatabase` wraps every request and cron
run, and the `db` export resolves to the pool of the request it is called in.
Outside a scope, which is every Node deployment, `db` is the process pool it
always was.

Workers TCP sockets validate TLS against public roots and take no custom CA.
A database whose certificate is signed by a private CA, which includes the
Supabase pooler, therefore needs **Hyperdrive**: it holds the CA, verifies the
origin, and pools connections near the database. When a `HYPERDRIVE` binding
exists the Worker connects scoped pools to it and sends no TLS options on that
hop. Without the binding it connects to `DATABASE_URL` directly, which works
for a database with a publicly trusted certificate.

Keep `DATABASE_POOL_MAX` at 5 or lower. A Worker request may hold six
connections open at once, and storage and provider calls need some of them.

### Limits that matter

| Limit | Value | Where Orbit stands |
| --- | --- | --- |
| Worker size | 64 MiB uncompressed | about 18 MiB |
| Startup | 1 second | checked by every deploy |
| CPU per request | 30 seconds default, 5 minutes with `limits.cpu_ms` | set to 5 minutes |
| CPU per cron run | 30 seconds for schedules under an hour | the minute crons wait on IO |
| Wall time per cron run | 15 minutes | Vercel allowed 5 |
| Wall time per request | none while the client is connected | Vercel allowed 5 minutes |
| Memory | 128 MB per isolate | argon2id takes 64 MB while it runs |

Every route that set `maxDuration` waits on Postgres, GitHub, Slack or Resend
rather than on CPU, so none of them is near the CPU limit.

## Local run

Node 24 is required for the build. Older releases skip `src/app/.well-known`
when routes are scanned, and `vite.config.ts` refuses to start on them.

Copy the variables the Worker needs from `.env` into `apps/web/.dev.vars`, then:

```
cd apps/web
bun run build:workers
bun run preview:workers
```

`.dev.vars` is read by `wrangler dev` and is ignored by git. Set
`BETTER_AUTH_URL` and `NEXT_PUBLIC_APP_URL` to `http://localhost:8787` in it and
in the shell that builds, because `NEXT_PUBLIC_*` values are compiled in.
`REDIS_URL` is not needed.

Run a cron by hand:

```
curl "http://localhost:8787/cdn-cgi/handler/scheduled?cron=*+*+*+*+*"
```

## Deploy

```
cd apps/web
bun run build:workers
bun run deploy:workers
```

`wrangler.jsonc` names no account. Set `CLOUDFLARE_ACCOUNT_ID` in the shell or
the build settings when the login can reach more than one.

For Workers Builds, set the root directory to `apps/web`, the build command to
`bun run build:workers`, the deploy command to
`bunx wrangler deploy --config dist/server/wrangler.json`, and `NODE_VERSION`
to `24`. Set `ORBIT_REQUIRE_SCHEMA_GUARD=1` and `DATABASE_URL` as build
variables on the production branch so a build fails when the database is behind
the schema, the same guard the Vercel build has.

### Bindings

Declared in `apps/web/wrangler.jsonc`:

| Binding | Kind | Purpose |
| --- | --- | --- |
| `ASSETS` | static assets | client bundles under `/_next/static` |
| `REALTIME_HUB` | Durable Object, `RealtimeHubObject` | websocket hub |
| `AUTH_RATE_LIMITER` | Durable Object, `AuthRateLimiterObject` | auth rate limits |
| `HYPERDRIVE` | Hyperdrive, add it yourself | Postgres through a verified, pooled connection |

Migration `v1` creates both classes with SQLite storage. Later class changes
need a new migration tag.

### Hyperdrive for a database behind a private CA

```
npx wrangler cert upload certificate-authority --ca-cert ./database-ca.pem --name orbit-database-ca
npx wrangler hyperdrive create orbit-database --connection-string="postgres://USER:PASSWORD@HOST:5432/DATABASE" --ca-certificate-id <ID FROM THE FIRST COMMAND> --sslmode verify-full
```

Use the session mode port, not a transaction pooler, because Hyperdrive pools
for you. Then add the binding to `wrangler.jsonc`:

```
"hyperdrive": [{ "binding": "HYPERDRIVE", "id": "<ID FROM THE SECOND COMMAND>" }]
```

The CA file must hold a single certificate. Hyperdrive opens up to about 100
origin connections on the paid plan, so check that against the database's own
connection limit.

### Variables and secrets

`NODE_ENV=production` is set in `wrangler.jsonc`, because better-auth only
rate limits in production and Workers do not set it. Everything else is a
secret, set with `wrangler secret put NAME` or `wrangler secret bulk`:

- Required: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`,
  `NEXT_PUBLIC_APP_URL`, `CRON_SECRET`, `EMAIL_FROM`, `RESEND_API_KEY`.
- Storage: `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`,
  `S3_SECRET_ACCESS_KEY`.
- As used: the Google, GitHub, GitHub App and Slack variables, `OAUTH_PROXY_SECRET`,
  `ORBIT_AUTH_ALLOWED_HOSTS`, `ORBIT_PASSWORD_AUTH`, `ORBIT_PUBLIC_URL`,
  `DATABASE_POOL_MAX`, the notification flags.
- Not used on Workers: `REDIS_URL`, `DATABASE_TLS_CA_PEM` and
  `DATABASE_REQUIRE_TLS` when Hyperdrive is bound, every `VERCEL_*` variable.

`NEXT_PUBLIC_*` values are compiled into the client bundle, so they must also be
present when `build:workers` runs.

### Object storage on R2

R2 speaks the S3 API the app already uses:

```
S3_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
S3_REGION=auto
S3_BUCKET=<bucket>
S3_ACCESS_KEY_ID=<R2 token access key>
S3_SECRET_ACCESS_KEY=<R2 token secret>
```

Give the bucket the CORS policy from [object storage](object-storage.md), with
the app's origin, or browser uploads fail. To move an existing bucket, copy it
with the dashboard's R2 data migration or with `rclone sync` from the old
remote to the R2 remote, switch the five variables, then run the copy once more
to pick up objects written in between. Keys do not change, so no database rows
need rewriting.

## Before pointing a domain at it

1. `bun run db:release` against the production database, as for any deploy.
2. Deploy and open the `workers.dev` URL. `/api/health` and
   `/api/realtime/health` both answer 200.
3. Sign in, open the same issue in two browsers, rename it in one.
4. Update the OAuth callback URLs at Google, GitHub and Slack only if the
   hostname changes. Moving the same hostname needs no change.
5. Remove the crons from the old platform at the moment the Cron Triggers take
   over, so no job runs twice against the same database.

## What is different or missing

- Password sign-in costs about 1.8 seconds of CPU per attempt, against about
  40 ms natively. It only applies when `ORBIT_PASSWORD_AUTH=true`.
- `after()` work runs under `waitUntil`, which Workers end 30 seconds after
  the response. The pull request backfill on `/pulls` and the Slack event
  handler were allowed up to 5 minutes and 60 seconds on Vercel.
- The AI provider transport does not pin the resolved address. Literal private
  hosts are still refused and redirects are not followed.
- `/api/realtime/health` reports `redisConfigured: true` for a healthy hub. The
  field now means that a fan-out transport is configured.
- Preview deployments per pull request are not set up.

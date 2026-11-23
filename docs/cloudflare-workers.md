# Running Orbit on Cloudflare Workers

Orbit's hosted deployment runs on Cloudflare Workers. The web app builds two
ways from the same source. `bun run build:workers` produces a Cloudflare Worker
with [vinext](https://github.com/cloudflare/vinext). `bun run build` produces the
standalone Next.js output that the Docker image serves. Nothing in `src/app`
differs between the two. Vercel is no longer used.

This page covers what the Worker is made of, how to run it locally, how to
deploy it with Workers Builds, how pull request previews work, and what to check
before pointing a domain at it.

## What changes on Workers

| Concern | Node (Docker) | Workers |
| --- | --- | --- |
| Build | `next build` | `vite build` with vinext, entry `apps/web/worker/index.ts` |
| Realtime socket | `/api/ws` routed by the gateway to the Node realtime host, Redis pub/sub fan-out | `/api/ws` goes to the `RealtimeHubObject` Durable Object, no Redis |
| Publishing deltas | `PUBLISH` to Redis | `fetch` to the Durable Object |
| Auth rate limits | Redis with a Lua script | `AuthRateLimiterObject` Durable Object with SQLite storage |
| Crons | the Docker maintenance scheduler | Cron Triggers calling the same `/api/cron/*` routes |
| Long background work | `after()` in the Node process | an alarm on the `DeferredWorkObject` Durable Object |
| Postgres | one pool per process | one pool per request, through Hyperdrive when bound |
| Password hashing | `@node-rs/argon2` (native) | `@noble/hashes` argon2id (pure JavaScript) |
| AI provider calls | Node sockets with a pinned DNS lookup | `fetch` |
| Email templates | `react-dom/server` loaded by Node | a Vite plugin resolves the email modules to the client React build |
| Client address | `x-forwarded-for` set by the gateway | `cf-connecting-ip`, copied over `x-forwarded-for` at the entry |

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
- The object is created with the `apac-ne` location hint so it sits near the
  database. A hint is a preference, not a placement: of the objects created
  from a Worker placed in Tokyo, about four in five landed in Tokyo (3 ms from
  the Worker) and the rest in Osaka (10 ms), with or without a hint. An object
  never moves once created. Change `NEAR_THE_DATABASE` in
  `apps/web/worker/bindings.ts` if your database is elsewhere.

One object carries every workspace. That is the right size for a deployment
with hundreds of concurrent sockets. Sharding by organization is the path if it
ever is not: the ticket already names the organization, so the entry would need
it in the socket URL to route before the upgrade.

### Background work

A Worker may keep running `waitUntil` work for 30 seconds after the response is
sent, and `after()` is `waitUntil` here. Two pieces of work can take longer, so
they do not run that way on Workers:

- the pull request backfill that `/pulls` starts, which walks every open pull
  request of up to five repositories and only marks a repository done when it
  reaches the end. Measured at about 20 ms and 15 database round trips for each
  pull request, a repository with several hundred open pull requests would be
  cut off at the same point on every visit and never finish.
- the history refresh that a pull request page starts, which reads every
  comment, review and check from GitHub.

`deferWork` in `apps/web/src/lib/background/defer.ts` hands both to a
`DeferredWorkObject`, one object for each workspace or pull request. The object
stores the work and sets an alarm for now, and the alarm handler runs it. An
alarm may run for 15 minutes. If the invocation is interrupted or the work
throws, the work stays stored and Cloudflare runs the alarm again, up to six
times with a growing delay. On Node nothing is registered, so the same call
runs under `after()` as before.

The Slack link unfurl stays on `after()`. It is a few queries and one Slack
call with a 10 second timeout, so it cannot reach the limit.

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

The realtime Durable Object keeps a lazy pool for the lifetime of its active
instance. Its socket events and alarms share that pool, idle connections close
after five seconds, and a new instance after hibernation or eviction starts
with a fresh scope. See [persistent connections in Durable Objects](https://developers.cloudflare.com/hyperdrive/concepts/connection-lifecycle/#durable-objects-and-persistent-connections).

Workers TCP sockets validate TLS against public roots and take no custom CA.
A database whose certificate is signed by a private CA, which includes the
Supabase pooler, therefore needs **Hyperdrive**: it holds the CA, verifies the
origin, and pools connections near the database. When a `HYPERDRIVE` binding
exists the Worker connects scoped pools to it and sends no TLS options on that
hop. Without the binding it connects to `DATABASE_URL` directly, which works
for a database with a publicly trusted certificate.

The Hyperdrive client and its health probe use prepared statements, as required
by [Hyperdrive's Postgres.js driver guidance](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-drivers-and-libraries/postgres-js/).
`DATABASE_PREPARED_STATEMENTS` controls direct database connections.

Keep `DATABASE_POOL_MAX` at 5 or lower. A Worker request may hold six
connections open at once, and storage and provider calls need some of them.

### Speed

A Worker placed next to the database is still not inside the database's cloud.
Every query crosses from Cloudflare to the provider and back, so the number of
round trips decides how fast a request is. Measured from a Worker placed in
Tokyo against a Supabase database in `ap-northeast-1`:

| What | Time |
| --- | --- |
| One query on an open connection, Hyperdrive to the Supabase pooler | 9 ms |
| One query on an open connection, Hyperdrive straight to Postgres | 4 ms |
| A fresh connection, then five parameterised queries, as the driver ships | about 120 ms |
| The same with the two changes below, through the pooler | about 58 ms |
| The same, straight to Postgres | about 29 ms |

Three things keep the round trips down, and all three matter:

- **Connect Hyperdrive directly to Postgres.** Hyperdrive
  already pools. In the Tokyo measurement above, a warm query took 4 ms through
  a direct connection and 9 ms through the pooler. On Supabase the direct host
  is `db.<project>.supabase.co:5432`. Use the database role configured for
  Orbit with the privileges its runtime needs.
- **Request scoped pools do not fetch types.** The driver otherwise spends one
  round trip on each new connection reading the array types, and a Worker
  opens a new connection for every request. Drizzle parses and writes array
  columns itself, so nothing is lost. Raw SQL on a request path must not pass
  a JavaScript array as a parameter or expect one back.
- **The Workers build sends a parameterised query in one round trip.** As
  shipped, the driver waits for the server to describe each statement a
  connection has not seen before it binds any string parameter, which doubles
  every query on a fresh connection. `apps/web/vite.config.ts` rewrites that one
  decision in the driver's connection module so a pool that does not fetch
  types sends strings as text in the same round trip as the parse and describe,
  as the driver already does for numbers. A query with a `Date`, boolean,
  `Buffer` or array parameter still waits for the description. The build checks
  the installed driver before rewriting it and verifies the resulting condition
  in the compiled server bundle.

Cron Triggers do not follow placement. Three samples started in Paris and
Chicago. The default configuration runs each job on the Worker that receives
the scheduled event. To run jobs in the placed region, deploy the Worker once
with the schedules disabled, then add a service binding to that deployment's
Wrangler configuration. This example targets a Worker named `orbit-staging`.

```json
"services": [{ "binding": "SELF", "service": "orbit-staging" }]
```

Set the target to the exact Worker name for each environment before rebuilding
or renaming it. Wrangler's `--name` override changes the deployed Worker name
and leaves the literal service target intact. The binding receives that
environment's authenticated cron requests. Keep the schedules disabled until
the scheduler handoff described below. With the binding enabled, the scheduled
handler sends each job through the placed fetch handler.

A Durable Object lands where Cloudflare chooses. From a Worker placed in
Tokyo, about four in five landed in Tokyo and the rest in Osaka, 3 ms and
10 ms from the Worker.

The first request a new isolate serves is slow, 0.6 to 1.5 seconds in most
samples and 2.7 seconds in one, because the bundle starts and the route
loads. Warm requests are what the table above describes.

Where a visitor enters Cloudflare matters as much as any of this. A zone on
the Free plan is not always served from the nearest data center. Check with
`curl https://<your host>/cdn-cgi/trace` from where your users are and read
the `colo` line.

### Limits that matter

| Limit | Value | Where Orbit stands |
| --- | --- | --- |
| Worker size | 64 MiB uncompressed | about 18 MiB |
| Startup | 1 second | about 0.7 seconds, measured by a deploy |
| CPU per request | 30 seconds default, 5 minutes with `limits.cpu_ms` | set to 5 minutes |
| CPU per cron run | 30 seconds for schedules under an hour | the minute crons wait on IO |
| Wall time per cron run | 15 minutes | the minute crons finish in seconds |
| Wall time per request | none while the client is connected | routes keep their `maxDuration` of 5 minutes or less |
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

If the config includes a `HYPERDRIVE` binding, export
`CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` in the shell that
runs `preview:workers`. Point it at a development database. Wrangler's local
proxy connects directly to this address for queries and health probes. For a
remote development database, include `sslmode=verify-full` in that URL and,
when required, `sslrootcert` with the path to its CA certificate. The local
proxy obtains TLS settings from its connection string. See
[local Hyperdrive configuration](https://developers.cloudflare.com/hyperdrive/configuration/local-development/).

Run a cron by hand:

```
curl "http://localhost:8787/cdn-cgi/handler/scheduled?cron=*+*+*+*+*"
```

## Deploy

`apps/web/wrangler.jsonc` has three layers:

- The top level is a generic configuration for anyone self-hosting. Build it
  with `bun run build:workers` and deploy it with `bun run deploy:workers`.
- `env.production` is Noveum's deployment: Worker `orbit`, the custom domain
  `orbit.noveum.ai`, its Hyperdrive configuration, the `SELF` binding and the
  four Cron Triggers.
- `env.preview` is the pull request preview Worker `orbit-pr`: no routes, no
  Cron Triggers, no `SELF` binding, its own Durable Objects and a Hyperdrive
  configuration for the preview database. See [Preview deployments](#preview-deployments).

The vite plugin reads `CLOUDFLARE_ENV` when it builds and flattens the chosen
environment into `dist/server/wrangler.json`, which is what Wrangler deploys.

`wrangler.jsonc` names no account. Set `CLOUDFLARE_ACCOUNT_ID` in the shell or
the build settings when the login can reach more than one.

### First deployment

When replacing another production scheduler, stage the first Worker with
`"triggers": { "crons": [] }` in the block you build: `env.production.triggers`
for `CLOUDFLARE_ENV=production`, or the top-level `triggers` otherwise. Make
the change in the deployment checkout's `apps/web/wrangler.jsonc` before
building. Keep this setting for every staged
build until the scheduler handoff below.

For the first deployment, prepare a secrets file outside the checkout with the
runtime values listed below and point `WORKER_SECRETS_FILE` at its absolute path.

```
cd apps/web
CLOUDFLARE_ENV=production bun run build:workers
bun run deploy:workers --secrets-file "$WORKER_SECRETS_FILE"
```

Leave `CLOUDFLARE_ENV` unset to build the generic top-level configuration.
Subsequent deployments can use `bun run deploy:workers`.

### Workers Builds

Production and previews deploy from Git through two Workers Builds connections
on the same repository. Both use the package scripts `build:workers:ci` and
`deploy:workers:ci` (`apps/web/scripts/workers-ci.ts`). They read
`WORKERS_CI_BRANCH`, which Workers Builds sets, and choose the target:

| Branch | `CLOUDFLARE_ENV` | Target | Deploy |
| --- | --- | --- | --- |
| `main` | unset or `production` | Worker `orbit` | `wrangler deploy` |
| `main` | `preview` | Worker `orbit-pr` itself | `wrangler deploy` |
| any other | unset or `preview` | a Worker Preview of `orbit-pr` named after the branch | `wrangler preview --name <alias>` |
| any other | `production` | refused | none |

Before deploying, the script checks that the bundle was built for the Worker
the branch targets and, inside Workers Builds, that it matches the Worker the
connection belongs to (`WRANGLER_CI_OVERRIDE_NAME`). A preview connection that
somehow built for `orbit` stops there instead of deploying production code to
the wrong Worker.

Workers Builds cannot reach the database, so no build there checks the schema.
Without `DATABASE_URL` the guard in `build:workers` says so and lets the build
through, as it does anywhere else. Before merging code that depends on a schema
change, run the release and the guard from a machine with database access, as
described in [database releases](database-releases.md):

```
DIRECT_URL="postgres://..." bun run db:release
DATABASE_URL="postgres://..." bun run db:check-drift
```

Settings for the Worker **`orbit`**:

| Setting | Value |
| --- | --- |
| Git branch (production) | `main` |
| Preview builds for non-production branches | off |
| Root directory | `apps/web` |
| Build command | `cd ../.. && bun install --frozen-lockfile && cd apps/web && bun run build:workers:ci` |
| Deploy command | `bun run deploy:workers:ci` |
| Build variables | `NODE_VERSION=24`, `BUN_VERSION=1.3.14`, `CLOUDFLARE_ENV=production`, `NEXT_PUBLIC_APP_URL=https://orbit.noveum.ai`, `ORBIT_PASSWORD_AUTH=true` |
| Build secrets | none |

The build command installs from the repository root because `bun.lock` lives
there, not in `apps/web`. The build scripts load `../../.env` when it exists
and carry on without it, so a clean checkout needs no `.env`.

`next.config.ts` refuses a production build that has no usable first sign-in
method: `ORBIT_PASSWORD_AUTH=true`, a Google pair, a GitHub pair, or Resend with
a real `EMAIL_FROM`. Production runs with `ORBIT_PASSWORD_AUTH=true`, so that
build variable is enough and no sign-in secret is needed at build time. Build
variables are not runtime variables. Runtime secrets stay under the Worker's
Settings, Variables and Secrets.

Settings for the Worker **`orbit-pr`**:

| Setting | Value |
| --- | --- |
| Git branch (production) | `main` |
| Preview builds for non-production branches | on |
| Root directory | `apps/web` |
| Build command | `cd ../.. && bun install --frozen-lockfile && cd apps/web && bun run build:workers:ci` |
| Deploy command | `bun run deploy:workers:ci` |
| Preview command | `bun run deploy:workers:ci` |
| Build variables | `NODE_VERSION=24`, `BUN_VERSION=1.3.14`, `CLOUDFLARE_ENV=preview` |
| Build secrets | none |

A push to `main` on this connection redeploys `orbit-pr` itself from `main`, so
`https://orbit-pr.<subdomain>.workers.dev` follows `main` against the preview
database. Every other branch becomes a Worker Preview. The preview build takes
`ORBIT_PASSWORD_AUTH` and the other public values from `env.preview.vars`, so it
needs no build secrets.

## Preview deployments

Each branch gets a [Worker Preview](https://developers.cloudflare.com/workers/previews/)
of `orbit-pr` at `https://<alias>-orbit-pr.<subdomain>.workers.dev`, plus a
unique URL for every deployment of it. Previews use Worker Previews rather than
`wrangler versions upload --preview-alias`, because Cloudflare does not generate
version preview URLs for a Worker that implements a Durable Object. A version
uploaded that way has `has_preview: false`. Worker Previews give each preview
its own Durable Object namespaces instead.

A branch name that is already a valid label, such as `fix-login`, is the alias
as it is. Any other name is lowercased, every character outside `[a-z0-9-]`
becomes a dash, repeated dashes collapse, a `b-` prefix is added when it would
not start with a letter, and six characters of the branch name's SHA-256 are
appended, so `fix/login` becomes `fix-login-5e870e` and never shares a preview
with `fix-login`. When `<alias>-orbit-pr` would exceed the 63 character DNS
label limit, the alias is cut short before the digest. The alias stays the same
for every push to a branch.

The preview build compiles `NEXT_PUBLIC_APP_URL` as the preview's own address,
and the deploy step passes `BETTER_AUTH_URL` and `NEXT_PUBLIC_APP_URL` for that
address with `--var`. `env.preview` sets `ORBIT_AUTH_ALLOWED_HOSTS` to
`*-orbit-pr.<subdomain>.workers.dev` so the unique deployment URLs are accepted
too, and `ORBIT_PASSWORD_AUTH=true` so people sign up with an email and a
password. See [Preview authentication](preview-authentication.md).

Worker Previews do not inherit the Worker's settings. Their bindings and
variables come from the `previews` block inside `env.preview`, and their secrets
from the preview base config, which applies to every new preview:

```
cd apps/web
CLOUDFLARE_ENV=preview bun run build:workers
bunx wrangler preview base-config secret bulk "$PREVIEW_SECRETS_FILE" --config dist/server/wrangler.json
```

The preview Worker and its previews need only `DATABASE_URL`,
`BETTER_AUTH_SECRET` and `CRON_SECRET`, with values made for previews. Do not
copy production secrets. Slack, the GitHub App, Resend, Google, GitHub sign-in
and object storage stay unset, so those features are unavailable on previews.

All previews share the preview database. Its schema follows `main`: run
`DIRECT_URL=<preview database> bun run db:release` after a migration merges. A
pull request that adds a migration needs that migration applied to the preview
database before its preview works, which affects every other preview, so do it
only for a migration that is backward compatible.

`workers.dev` on this account sits behind Cloudflare Access, so a preview URL
first asks for the team login. Delete a finished preview with
`bunx wrangler preview delete --name <alias> --config dist/server/wrangler.json`.
Cloudflare also removes the oldest previews automatically at the plan's limit.

### Bindings

Declared in `apps/web/wrangler.jsonc`:

| Binding | Kind | Purpose |
| --- | --- | --- |
| `ASSETS` | static assets | client bundles under `/_next/static` and the files in `public/`, served from the data center nearest the visitor without running the Worker |
| `REALTIME_HUB` | Durable Object, `RealtimeHubObject` | websocket hub |
| `AUTH_RATE_LIMITER` | Durable Object, `AuthRateLimiterObject` | auth rate limits |
| `DEFERRED_WORK` | Durable Object, `DeferredWorkObject` | background work that outlives a response |
| `HYPERDRIVE` | Hyperdrive, add it yourself | Postgres through a verified, pooled connection |
| `SELF` | optional service binding to this deployment | scheduled jobs run in the placed location when configured |

Migration `v1` creates the first two classes with SQLite storage and `v2` adds
`DeferredWorkObject`. Later class changes need a new migration tag.

### Hyperdrive for a database behind a private CA

```
bunx wrangler cert upload certificate-authority --ca-cert ./database-ca.pem --name orbit-database-ca
bunx wrangler hyperdrive create orbit-database --connection-string="postgres://USER:PASSWORD@HOST:5432/DATABASE" --ca-certificate-id <ID FROM THE FIRST COMMAND> --sslmode verify-full --caching-disabled
```

`--caching-disabled` is not optional. Hyperdrive caches the result of read
queries by default, and Orbit reads rows straight after writing them and
pushes changes over the socket, so a cached read shows stale data.

Connect to Postgres itself where the provider allows it, because Hyperdrive
pools connections. On Supabase use `db.<project>.supabase.co` on port 5432.
Supabase shows `postgres` as its default role. A dedicated application role
with the required Orbit permissions also works. The direct host
has an IPv6 address only, which Hyperdrive reaches. If you must use a pooler,
use its session mode port, never the transaction one. Each Hyperdrive configuration
has its own origin connection pool. On a Workers Paid plan you can configure
up to 1,500 connections per configuration. Pass `--origin-connection-limit`
for each configuration. These are soft limits. Budget the old and new pools
together during a cutover, including direct database clients, and leave
headroom below Postgres `max_connections`. [Cloudflare’s November 2026 limits update](https://developers.cloudflare.com/changelog/post/2026-11-11-hyperdrive-raised-limits/).

Add the binding to `wrangler.jsonc`.

```
"hyperdrive": [{ "binding": "HYPERDRIVE", "id": "<ID FROM THE SECOND COMMAND>" }]
```

### Hyperdrive for a database on a private address

A database with no public address is reached through a Cloudflare Tunnel run
next to it, a Workers VPC service that names the database behind the tunnel,
and a Hyperdrive config that points at the service. Use the database hostname
from its TLS certificate. The tunnel host must resolve it to the private address.

```
bunx wrangler tunnel create orbit-database
```

Run the tunnel on a host inside the private network, as a service or in a
separate terminal. The foreground process must stay running.

```
bunx wrangler tunnel run orbit-database
```

Continue configuring the service from the setup terminal.

```
bunx wrangler cert upload certificate-authority --ca-cert ./database-ca.pem --name orbit-database-ca
bunx wrangler vpc service create orbit-database --type tcp --app-protocol postgresql --tunnel-id <TUNNEL ID> --hostname <DATABASE HOSTNAME> --tcp-port 5432 --cert-verification-mode verify_full --certificate-authority <CA ID>
bunx wrangler hyperdrive create orbit-database --service-id <SERVICE ID> --database <DATABASE> --origin-user <USER> --origin-password <PASSWORD> --caching-disabled
```

Two things stop the last command if they are missing. The database must accept TLS:
Hyperdrive refuses an origin that does not. And a certificate from a private CA
is only trusted once that CA is uploaded and named on the VPC service. The
upload takes a CA certificate, not the server's own self signed certificate.

The CA file must hold a single certificate. Set the origin connection limit
to fit the database's available connection budget.

### Variables and secrets

`NODE_ENV=production` is set in `wrangler.jsonc`, because better-auth only
rate limits in production and Workers do not set it. On `orbit` everything else
is a secret. `env.preview` also sets its public values (`BETTER_AUTH_URL`,
`NEXT_PUBLIC_APP_URL`, `ORBIT_AUTH_ALLOWED_HOSTS`, `ORBIT_PASSWORD_AUTH`) as
variables, so they must not also exist as secrets on `orbit-pr`.

The first deploy has to carry the required secrets with it, as
`wrangler deploy --secrets-file <file>`. Cloudflare runs the Worker's startup
code while it accepts an upload, and the app validates `BETTER_AUTH_SECRET` and
reads `DATABASE_URL` at startup, so an upload without them is rejected. After
that, `wrangler secret put NAME` and `wrangler secret bulk` work as usual.

- Required: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`,
  `NEXT_PUBLIC_APP_URL`, `CRON_SECRET`, `EMAIL_FROM`, `RESEND_API_KEY`.
- Storage: `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`,
  `S3_SECRET_ACCESS_KEY`.
- As used: the Google, GitHub, GitHub App and Slack variables, `OAUTH_PROXY_SECRET`,
  `ORBIT_AUTH_ALLOWED_HOSTS`, `ORBIT_PASSWORD_AUTH`, `ORBIT_PUBLIC_URL`,
  `DATABASE_POOL_MAX`, the notification flags.
- Not used on Workers: `REDIS_URL`, and `DATABASE_TLS_CA_PEM` and
  `DATABASE_REQUIRE_TLS` when Hyperdrive is bound.

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
from the old remote into a dedicated, empty R2 bucket. Pause object writes
and deletions on the old deployment and let outstanding uploads finish. Run
the final `rclone sync` from the old remote to R2, verify the result, then
switch the five variables and resume writes on R2. Keys stay the same.

## Before pointing a domain at it

1. `bun run db:release` against the production database, as for any deploy.
2. Deploy and open the `workers.dev` URL. `/api/health` and
   `/api/realtime/health` both answer 200.
3. Sign in, open the same issue in two browsers, rename it in one.
4. Update the OAuth callback URLs at Google, GitHub and Slack only if the
   hostname changes. Moving the same hostname needs no change.
5. Disable the old scheduler, record the last completed run of each job, and let
   active runs finish. Restore the four checked-in schedules in the deployment
   checkout, rebuild and deploy the Worker. Allow up to 15 minutes for the
   triggers to propagate. Check the Worker events against the recorded runs
   and invoke any missed maintenance job once using its authenticated cron
   route. See [Cron Trigger propagation](https://developers.cloudflare.com/workers/configuration/cron-triggers/).

## What is different or missing

- Password sign-in costs about 1.8 seconds of CPU per attempt, against about
  40 ms natively. It only applies when `ORBIT_PASSWORD_AUTH=true`.
- A failed cron run is not retried. The next run happens on schedule. Failed
  runs are listed under the Worker's Settings, Trigger Events, View events, and
  in Workers Logs. Cloudflare sends no alert for one unless you set one up.
- AI requests use HTTPS on `api.openai.com` and `api.anthropic.com`. Custom
  provider origins require a deployment that pins the resolved address, or an
  operator who has explicitly enabled `ALLOW_PRIVATE_AI_ENDPOINTS`. The latter
  also permits private destinations. Redirects are disabled.
- `/api/realtime/health` reports `redisConfigured: true` for a healthy hub. The
  field now means that a fan-out transport is configured.
- Worker Previews are in open beta. Routes and Cron Triggers always target the
  Worker's own deployment, so scheduled jobs never run on a preview.

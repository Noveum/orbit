# Self-hosting Orbit

> **Status: Preview.** This page documents the current Noveum AI deployment and
> evaluation paths. Orbit does not yet publish a provider-neutral production
> support, migration, rollback, backup, or compatibility contract. Review the
> [readiness tracker](open-source-readiness.md) before deploying important data.

Orbit is one Next.js app. It needs Postgres, Redis and an S3-compatible bucket,
plus a usable sign-in method. A Docker Compose preview packages the standalone
application and those dependencies for local evaluation.

Everything below has a free tier, so a small team can run Orbit for nothing.

## Pick your route

| Route | Effort | Best for |
| --- | --- | --- |
| [Vercel](#deploy-on-vercel) | About 20 minutes | Almost everyone. This is what we run |
| [Standalone Node (Preview)](#run-standalone-node-preview) | About 30 minutes | Evaluation inside your own network, without realtime |
| [Docker Compose (Preview)](docker-preview.md) | Local image build and setup | Evaluation with bundled infrastructure, realtime and maintenance |

All routes need the same infrastructure plus one complete first-login method.

## What Orbit needs

| Piece | What we use | Alternatives |
| --- | --- | --- |
| Postgres 16 or newer | [Supabase](https://supabase.com) | Neon, Railway, RDS, your own |
| Redis | [Upstash](https://upstash.com) | Any Redis 7 or newer, ElastiCache, your own |
| S3-compatible storage | Cloudflare R2 | AWS S3, Backblaze B2, MinIO, Supabase Storage |
| Transactional email (optional with password or OAuth) | [Resend](https://resend.com) | None. Orbit only supports Resend |

Email is used for sign-in codes and invites. It is optional when password, Google
or GitHub sign-in is configured. Production build and startup refuse to proceed
when none of those methods can bootstrap the first user.

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

Set `DATABASE_PREPARED_STATEMENTS=false` for this transaction pooler. Other
providers use different ports, so use the runtime connection string they
recommend and choose this setting from the endpoint's prepared-statement
capability, not its port number.

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

### 4. Set up email or another sign-in method

Create a [Resend](https://resend.com) account, verify a domain, and create an
API key. `EMAIL_FROM` has to be on the domain you verified. If it is not, every
send fails and the only symptom is that invites never arrive. You can omit
Resend when password, Google or GitHub sign-in is configured, but invitations
and email OTP will remain unavailable.

### 5. Apply the schema

**Migrations are applied from your machine, never by the platform.** There is no
migration job in the build. Schema changes are completed and verified before the
new application is deployed.

So push the schema before the code that needs it ships:

```bash
DIRECT_URL="postgres://...direct connection on 5432..." bun run db:release
```

Use the **direct** connection string here, not the transaction pooler. The release
command takes a database lock, verifies every recorded migration hash, applies the
pending migrations and then verifies the complete required catalog. A compatible
database created before Orbit had a migration ledger is baselined without changing
application rows. A partial legacy schema is refused until its matching catchup
scripts have been applied.

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
DATABASE_PREPARED_STATEMENTS=false
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

The example above uses Resend as the required first-login path. You can instead
set `ORBIT_PASSWORD_AUTH=true`, both Google OAuth variables, or both GitHub OAuth
variables. Passkeys cannot bootstrap a new installation, and `ORBIT_DEV_LOGIN`
is deliberately ignored in production.

Two variables must **not** be set:

- **`NEXT_PUBLIC_REALTIME_URL`.** In production the socket is always served from
  the page's own origin at `/api/ws`. `configuredRealtimeUrl()` ignores this
  variable when `NODE_ENV` is `production`, so it is a local development
  override and nothing else. Leave it unset so the deployment configuration
  reflects the production topology.
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

Each person who creates a workspace becomes its admin, and onboarding walks
through naming it and creating the first team. The first account has no special
server-wide privileges. There is no default administrator account. See the
[first-run setup guide](first-run.md) for registration, invitation verification,
email setup and the deployment checks available to workspace admins.

The production preflight has already confirmed that at least one first-login
method is configured. See [Configuration](configuration.md#authentication) for
Google, GitHub, password authentication, passkeys and email OTP.

Complete one real sign-in before inviting anyone. The preflight cannot validate
remote OAuth credentials or a Resend domain. Passkeys become available after an
authenticated user registers one; they cannot create the first session.

## Run standalone Node (Preview)

If you want to evaluate Orbit inside your own network, run the Next.js
standalone build behind a reverse proxy. This standalone path is Preview only:
Running only the Next HTTP server serves routes and assets. The complete
[Docker Compose preview](docker-preview.md) also starts a Node WebSocket host,
a same-origin gateway and a maintenance scheduler. Use that stack to evaluate
live updates and background work on a VPS.

The packaged start command requires Node.js 22 or newer. Bun remains required
for installing dependencies, applying the schema, and building the app.

```bash
git clone https://github.com/Noveum/orbit.git
cd orbit
bun install
cp .env.example .env      # then edit it for production
bun run db:push
bun run build
```

The build produces a portable standalone server in `apps/web/.next/standalone`,
including the public and Next static assets. Run it with the package command,
which loads the repository `.env`:

```bash
cd apps/web
bun run start
```

Your reverse proxy only needs to forward ordinary HTTP requests to the
standalone server. In nginx:

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

For a complete evaluation stack, use the [Docker Compose preview](docker-preview.md).
It supplies Postgres, Redis and MinIO with generated private credentials and
persistent volumes. The root `docker-compose.yml` is for local development only;
its published passwords must never be used for a deployed installation.

## Keeping it running

### Upgrading

```bash
git pull
bun install
DIRECT_URL="postgres://...direct connection..." bun run db:release
DATABASE_URL="postgres://...direct connection..." bun run db:check-drift
bun run build
```

Always complete the database release before the code that depends on it goes live.
The production Vercel build refuses to deploy when the configured database cannot
be verified or is missing a required schema object. Additional legacy tables and
indexes are reported and preserved. Orbit ships continuously from `main`. We
also publish automated weekly dated tags and GitHub releases, with manual
workflow dispatch available when needed, so you can track `main` or a recent
dated tag for deployed versions.

Watch the [releases](https://github.com/Noveum/orbit/releases) for anything
labelled `breaking change` and follow the upgrade notes in the associated release.

The Docker and catalog templates run PostgreSQL 19. A Docker volume created by
an earlier PostgreSQL 18 template needs the
[PostgreSQL 18 to 19 upgrade](runbooks/postgres-major-upgrade.md). A managed
database needs nothing: Orbit runs on PostgreSQL 16 or newer.

Upgrades across this release drop four tables the app never displayed: `module`,
`module_member`, `module_issue` and `module_link`. A Plane import before #287
filled them and nothing has read them since, so the migration removes them.
Databases that materialized their schema without a migration ledger can remove
them with `packages/db/catchup/drop-module-tables-catchup.sql`.

### Backups

Capture PostgreSQL and stored attachments together with the supported backup CLI.
Use a direct database connection, compatible PostgreSQL client tools, explicit
storage endpoints and protected key custody. The [operator runbooks](runbooks/README.md)
define the current command contracts and recovery limitations.

```bash
bun --env-file=/etc/orbit/orbit.env run backup:create \
  --destination /var/backups/orbit \
  --encrypt \
  --encryption-key-file=/etc/orbit/master.key \
  --json
```

Before selecting a file, remove or blank an old ORBIT_BACKUP_ENCRYPTION_KEY from
the inherited environment and loaded files: a nonempty inline key overrides even
an explicit file flag. The file must contain a 32-byte key encoded as hex/base64
and be readable by the capture operator with private ownership and permissions.
A helper command is another supported source, but key files take precedence and
helpers run without shell expansion. A key ID labels the archive; it does not
select a historical key automatically.

Keep the exact returned backupDir and manifest. The destination is a parent, not
an archive, and no latest alias is created. Successful encrypted archives contain
database.dump.enc and encrypted objects keyed by storage key. Unencrypted capture
failures may leave .incomplete siblings; encrypted failures remove their work
directory rather than retaining plaintext. Validate recoverability with a full
isolated restore, not manifest inspection alone.

### Guarded restore and validation

Follow [the isolated restore runbook](runbooks/routine-restore-test-environment.md)
using a separate database, bucket, Redis and outbound-integration configuration.
A missing confirmation is rejected by the CLI before identity calculation; a
valid archive plus a deliberately nonmatching confirmation displays the required
identity without authorizing a restore. The full restore checks archived payloads,
reconciles objects and controls recovery readiness.

Standalone backup:validate reports relational/ledger/catalog checks and configured
Redis connectivity. Its CLI supplies no storage driver, so zero storage counts do
not prove attachment integrity. It does not validate archive checksums, measure
Redis emptiness or change readiness. Keep traffic fenced after a failure and use
the [validation failure runbook](runbooks/validation-failure-after-restore.md).

### Retention and automation

Preview the complete effective policy before allowing deletion:

```bash
bun --env-file=/etc/orbit/orbit.env run backup:prune \
  --destination /var/backups/orbit \
  --keep-count 30 \
  --keep-days 14 \
  --max-bytes 50GB \
  --dry-run \
  --json
```

Count, age and GFS rules select a union; the quota can then remove older unpinned
selections. The newest checksum-valid backup and active pin/legal holds remain
protected. Read the [routine backup runbook](runbooks/routine-backup.md) for failure
cleanup, stale monitoring and scheduler prerequisites.

Packaged systemd units use /opt/orbit as their working directory and
/etc/orbit/orbit.env for their environment. Explicitly configure encryption and a
key source there, verify the orbit user can read them, and complete capture plus
isolated recovery before enabling timers. A cron wrapper invocation must explicitly
change to the repository root; an absolute script path alone does not do so.

### Recovery drill and upgrade matrix

These commands are destructive and belong only on disposable targets. Configure
the dedicated ORBIT_DRILL_DATABASE_URL, ORBIT_DRILL_REDIS_URL, S3 bucket/credentials
and all ambient database/Redis variables for the same isolated environment.
Confirm the database/bucket identity and Redis identity independently:

```bash
bun --env-file=/etc/orbit/drill.env run backup:recovery-drill \
  --confirm-destructive="disposable-host:5432/db/orbit_drill#bucket:orbit-drill-uploads" \
  --confirm-redis-target="redis://disposable-host:6379/db/0" \
  --json
bun --env-file=/etc/orbit/drill.env run backup:upgrade-matrix \
  --confirm-destructive="disposable-host:5432/db/orbit_drill#bucket:orbit-drill-uploads" \
  --json
```

Replace the example identities with those independently verified for your targets.
The fresh-install matrix creates and removes its own empty database, requiring
database-creation permission. Review every scenario result; a skipped scenario is
not verification of that path. Never run these commands against production.

The drill uses its own unique child under --destination or the temporary directory.
Without --clean that child remains for inspection. With --clean only that child is
removed after success or failure; unrelated parent contents remain. Promoting
recovered database/storage/Redis resources into service removes them from any
disposable teardown list.

Current manifests use format 1.0.0. Restore requires a supported format and
compatible migration ledger; a future ledger or unsupported format is refused.
Supported pending migrations are applied by restore. Preserve applied migration
bytes and historical keys needed by retained archives.


### Scaling

Orbit is fine on the smallest tier of everything for a team of twenty. The
things that give out first, roughly in order:

1. **Postgres connections.** Use the pooler.
2. **Redis latency**, if it is in another region from the functions.
3. **Function concurrency**, which Vercel handles on its own.

## Security before you go public

Read [SECURITY.md](https://github.com/Noveum/orbit/blob/main/SECURITY.md), which has the full checklist. The short
version:

- Fresh `BETTER_AUTH_SECRET`.
- `ORBIT_DEV_LOGIN` unset.
- `NEXT_PUBLIC_REALTIME_URL` unset.
- A real production sign-in completed successfully.
- Postgres, Redis and storage not reachable from the internet.
- Every default credential from `docker-compose.yml` changed.
- `ALLOWED_EMAIL_DOMAINS` set if only your organisation should get in.
- Bucket CORS scoped to your origin.
- HTTPS, because sessions and the socket ticket both depend on it.

## When it does not work

| Symptom | Cause |
| --- | --- |
| Endless "Reconnecting to live updates" | Check the Docker realtime service and gateway, or the Vercel websocket route, and Redis configuration |
| Live updates never arrive, no banner | `REDIS_URL` is wrong, or Redis is unreachable from the functions |
| Uploads fail in the browser, server looks fine | Bucket CORS does not allow your origin |
| Invites and sign-in codes never arrive | `EMAIL_FROM` is not on a domain verified in Resend |
| Build or startup says a first-login method is required | Configure password auth, a complete Google or GitHub pair, or Resend with a non-local sender |
| Connection pool exhausted | `DATABASE_URL` points at the direct endpoint instead of the pooler |
| Sign-in loops back to the login screen | `BETTER_AUTH_URL` does not exactly match the origin you are visiting |
| Websocket never reaches 101 | `bunVersion` is set in `apps/web/vercel.json`, so functions run on Bun |

More in [Troubleshooting](troubleshooting.md).

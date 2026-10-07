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

Upgrades across this release drop four tables the app never displayed: `module`,
`module_member`, `module_issue` and `module_link`. A Plane import before #287
filled them and nothing has read them since, so the migration removes them.
Databases that materialized their schema without a migration ledger can remove
them with `packages/db/catchup/drop-module-tables-catchup.sql`.

### Backups

Back up Postgres and object storage together. Orbit ships a coordinated backup
CLI (`bun run backup:create`) that exports a single repeatable-read PostgreSQL
snapshot, runs `pg_dump` against it, and downloads all referenced attachment
objects into an atomic backup archive.

```bash
# Capture a backup into ./backups
bun run backup:create --destination ./backups

# Pass a direct database connection explicitly
DIRECT_URL="postgres://user:pass@host:5432/orbit" bun run backup:create -d ./backups

# Machine-readable output for cron or orchestrators
bun run backup:create --json --destination /var/backups/orbit
```

#### CLI flags and environment variables

| Flag | Env variable | Default | Description |
| --- | --- | --- | --- |
| `--destination`, `-d` | `ORBIT_BACKUP_DESTINATION` | `./backups` | Target directory where the backup folder is published |
| `--database-url` | `DIRECT_URL`, `DATABASE_URL` | none | Direct connection string to PostgreSQL |
| `--pg-dump-path` | `PG_DUMP_PATH` | `pg_dump` | Path to the local `pg_dump` binary |
| `--orbit-version` | `ORBIT_VERSION` | `0.1.0` | Orbit version string stamped into `manifest.json` |
| `--source-revision` | `SOURCE_REVISION`, `VERCEL_GIT_COMMIT_SHA` | `unknown` | Git commit SHA stamped into `manifest.json` |
| `--encrypt` | `ORBIT_BACKUP_ENCRYPT` | `false` | Enable AES-256-GCM envelope encryption |
| `--encryption-key-file` | `ORBIT_BACKUP_ENCRYPTION_KEY_FILE` | none | Path to file containing 256-bit encryption key |
| `--encryption-command` | `ORBIT_BACKUP_ENCRYPTION_COMMAND` | none | Command to retrieve encryption key from KMS or secret vault |
| `--encryption-key-id` | `ORBIT_BACKUP_ENCRYPTION_KEY_ID` | `default` | Key identifier stamped in manifest for key rotation |
| `--json` | none | `false` | Emit JSON status on stdout and stderr |

#### Prerequisites

1. **`pg_dump` installed locally:** The backup runner invokes `pg_dump` directly.
   Its version must match or exceed the version of the PostgreSQL server being
   backed up. Configure `PG_DUMP_PATH` or `--pg-dump-path` if `pg_dump` is not in
   `PATH`.
2. **Direct database connection:** `DIRECT_URL` must point directly to PostgreSQL,
   not through a transaction-mode connection pooler such as PgBouncer or Supabase's
   transaction pooler (port 6543). The coordinated snapshot requires
   `pg_export_snapshot()`, which requires an open transaction session.
3. **Object storage credentials:** Storage environment variables (`S3_BUCKET`,
   `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, etc.) must be
   accessible to the command so it can download attachment files.

#### Output structure and atomicity

Each backup creates an isolated directory named `orbit-backup-<timestamp>-<hash>/`:

```
orbit-backup-2026-09-10T19-36-31-839Z-68a1dddb/
├── manifest.json      # Schema ledger, checksums, counts, safe config allowlist
├── database.dump      # pg_dump custom format (-Fc) archive (or database.dump.enc)
└── objects/           # Captured attachments keyed by storage key
    └── org_xxx/issue/att_yyy/file.png
```

Backups write to a temporary `.tmp` directory first. If `pg_dump`, preflight
validation, or object capture fails, the working directory is renamed to
`.incomplete` and the command exits with code 1. Only a fully verified backup
is published to its final path.

#### Backup encryption and secret handling

Backups contain sensitive application data, password hashes, OAuth tokens, and
attachments. Orbit supports operator-managed AES-256-GCM envelope encryption
before data leaves the host.

To prevent credential leakage in shell history, process listings (`ps aux`), or
manifests, encryption keys must never be passed as CLI arguments. Supported
secret sources:

1. **Environment variable:** `ORBIT_BACKUP_ENCRYPTION_KEY`
2. **Key file:** `--encryption-key-file=/etc/orbit/backup.key` or `ORBIT_BACKUP_ENCRYPTION_KEY_FILE`
3. **KMS / secret helper command:** `--encryption-command="aws kms decrypt ..."` or `ORBIT_BACKUP_ENCRYPTION_COMMAND`

Each backup generates a random 256-bit Data Encryption Key (DEK). The DEK is
encrypted with the Key Encryption Key (KEK) using AES-256-GCM and stored in the
manifest alongside its IV, authentication tag, and key ID. Database dumps and
attachment objects are encrypted with the DEK.

```bash
# Capture an encrypted backup using a key file
bun run backup:create --destination ./backups --encryption-key-file /etc/orbit/backup.key

# Capture with KMS helper command and specific key ID
ORBIT_BACKUP_ENCRYPTION_COMMAND="op read op://infra/orbit-backup/key" \
ORBIT_BACKUP_ENCRYPTION_KEY_ID="prod-2026-q3" \
bun run backup:create --destination /var/backups/orbit
```

##### Key rotation and custody

- **Key rotation:** When rotating to a new master key, new backups are encrypted
  with the new key ID. Restore does not look up keys automatically by `keyId`,
  so the operator must supply the corresponding master key that matches the archive's
  encryption key ID when restoring an older backup.
- **Recovery custody:** Store recovery keys in an offsite secret manager (e.g.
  AWS KMS, HashiCorp Vault, 1Password, or hardware security module). Orbit never
  uploads backups or keys to Noveum infrastructure.
- **Distinction from image signatures:** Encrypted backup archives protect customer
  data at rest. Container image provenance and signatures (e.g. Cosign) protect
  executable code and supply-chain integrity, and operate independently.

#### Backup limitations

- **Online object capture:** The database snapshot guarantees consistent relational
  state, and object storage capture fetches all attachments present when the
  snapshot began. If external tooling deletes an object from storage while Orbit
  is running, the backup fails rather than publishing a partial archive.
- **Local scratch disk space:** The destination directory must have enough disk
  capacity to hold the uncompressed PostgreSQL dump and all attachment objects.
  When encryption is enabled, additional temporary scratch space is required while
  the raw dump and the encrypted ciphertext file (`database.dump.enc`) coexist during
  encryption. Similarly, restore decrypts the full database dump into a temporary
  directory before passing it to `pg_restore`.

#### Guarded restore and validation

Orbit provides a guarded restore engine (`bun run backup:restore`) that validates
archive integrity, checks database compatibility, prevents accidental production
overwrites, restores Postgres and storage objects, and gates readiness.

```bash
# Preview required target identity
DIRECT_URL="postgres://user:pass@test-db:5432/orbit_staging" \
bun run backup:restore /var/backups/orbit/orbit-backup-2026-09-10T...

# Execute destructive restore with explicit target confirmation
bun run backup:restore /var/backups/orbit/orbit-backup-2026-09-10T... \
  --confirm-destructive-restore-target="test-db:5432/db/orbit_staging#bucket:orbit-uploads-staging" \
  --database-url="postgres://user:pass@test-db:5432/orbit_staging" \
  --encryption-key-file=/etc/orbit/backup.key
```

#### Scheduled retention and pruning

Manage backup disk consumption and lifecycle with `bun run backup:prune`.

```bash
# Keep 30 newest backups, retain up to 14 days, enforce 50GB quota
bun run backup:prune \
  --destination /var/backups/orbit \
  --keep-count 30 \
  --keep-days 14 \
  --max-bytes 50GB \
  --stale-alert-hours 26

# Preview pruning actions without deleting files
bun run backup:prune --destination ./backups --keep-count 10 --dry-run
```

##### Retention guarantees and policies

1. **Protection of newest known-good backup:** The prune engine never deletes the
   newest valid backup, even if `--keep-count=0` or storage exceeds `--max-bytes`.
2. **Incomplete and stale cleanup:** Cleans orphaned `.incomplete` and `.tmp`
   directories left by failed runs.
3. **Legal hold / operator pinning:** Any backup with a `.pinned`, `.hold`, or
   `legal-hold.json` marker file, or `metadata.pinned: "true"`, is permanently
   preserved and immune from deletion.
4. **Stale backup monitoring:** When `--stale-alert-hours=<N>` is set, `backup:prune`
   exits with code 2 and writes an alert if the newest backup exceeds the threshold.

#### Automated scheduling with systemd

Do not run backup cron jobs inside every web replica. Use an external
orchestration mechanism such as systemd timers on the host running the backup tools.

Install `deploy/backup/systemd/orbit-backup.timer` and `orbit-backup-prune.timer`:

```bash
sudo cp deploy/backup/systemd/orbit-backup.* /etc/systemd/system/
sudo cp deploy/backup/systemd/orbit-backup-prune.* /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now orbit-backup.timer orbit-backup-prune.timer
```

Alternatively, invoke `deploy/backup/run-backup-and-prune.sh` from a single external
cron job on a dedicated administration host.

#### Continuous recovery drill and upgrade matrix

Orbit includes an automated continuous recovery drill and a 7-scenario upgrade
matrix executed in CI:

```bash
# Run automated recovery drill:
bun run backup:recovery-drill --json

# Run 7-scenario upgrade matrix:
bun run backup:upgrade-matrix --json
```

The recovery drill seeds representative application state (users, organizations,
teams, issues, comments, docs, MCP grants, and uploaded attachments), captures an
encrypted snapshot, wipes the target environment and Redis, restores the snapshot,
and asserts byte-for-byte attachment integrity and authorization boundaries.

##### Measured recovery time and storage examples

The following numbers represent measured performance from the automated recovery drill
in CI and local test environments. These figures are illustrative examples rather than
operational guarantees:

| Metric | Example measurement | Notes |
| --- | --- | --- |
| Backup capture duration | ~1.4 seconds | Coordinated PostgreSQL dump and S3 object capture |
| Restore duration | ~2.8 seconds | Unpack, decryption, `pg_restore`, and S3 reconciliation |
| Database dump size | ~1.2 MB uncompressed | Custom-format PostgreSQL archive (`-Fc`) |
| Object store payload | ~4.5 MB | Representative file attachments encrypted with AES-256-GCM |
| Post-restore validation | ~650 ms | Ledger verification, catalog drift, referential integrity |

Actual production recovery times scale with relational row counts, total attachment
byte volume, and network latency to your S3 provider.

##### Format version policy and upgrade window

- **Format version:** Current backups use format `1` (`CURRENT_BACKUP_FORMAT_VERSION = 1`).
  Manifests include format version, source Git SHA, database engine version, and image digests.
- **Direct upgrades:** Restoring a backup created on an earlier supported release
  into a newer Orbit release automatically applies pending schema migrations.
- **Downgrade refusal:** Orbit explicitly refuses restoring a backup whose migration
  ledger is ahead of the running release (downgrade attempt), protecting relational state
  from silent corruption.

#### Operator runbooks

Detailed operational runbooks for emergency response, disaster recovery, and migrations
are located in the [Operator runbooks directory](runbooks/README.md):

1. [Routine backup](runbooks/routine-backup.md)
2. [Routine restore into test environment](runbooks/routine-restore-test-environment.md)
3. [Complete host loss](runbooks/complete-host-loss.md)
4. [Database corruption](runbooks/database-corruption.md)
5. [Object storage loss](runbooks/object-storage-loss.md)
6. [Leaked backup encryption key](runbooks/leaked-backup-encryption-key.md)
7. [Failed migration](runbooks/failed-migration.md)
8. [Accidental deletion recovery](runbooks/accidental-deletion-recovery.md)
9. [Region and provider migration](runbooks/region-provider-migration.md)
10. [Validation failure after restore](runbooks/validation-failure-after-restore.md)

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

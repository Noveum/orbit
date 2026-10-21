# Routine restore into test environment runbook

This runbook describes how to restore a production backup into an isolated staging
or test environment to verify recoverability without endangering live production data.

## Prerequisites

- Verified backup archive (e.g. `/var/backups/orbit/orbit-backup-<timestamp>`)
- Matching master encryption key (`/etc/orbit/master.key` or `ORBIT_BACKUP_ENCRYPTION_KEY`)
- Isolated test PostgreSQL instance or database (e.g. `orbit_staging`)
- Isolated test S3 bucket (e.g. `orbit-uploads-staging`)
- `pg_restore` available locally

## Step 1: Provision isolated staging infrastructure

Create a blank database and S3 bucket dedicated to test recovery:

```bash
# Create staging database
createdb -h staging-db -p 5432 -U orbit orbit_staging

# Ensure staging S3 bucket exists
aws s3 mb s3://orbit-uploads-staging --endpoint-url "$S3_ENDPOINT"
```

## Step 2: Determine target identity string

Orbit enforces a target-identity guard before any mutation occurs. If you invoke
restore without confirmation, Orbit reports the exact required identity and safely exits:

```bash
DIRECT_URL="$STAGING_DATABASE_URL" \
S3_BUCKET="orbit-uploads-staging" \
bun run backup:restore /var/backups/orbit/orbit-backup-2026-09-20T12-00-00-abc123
```

Output:
```
Refusing to restore into target "staging-db:5432/db/orbit_staging#bucket:orbit-uploads-staging".
Pass --confirm-destructive-restore-target=staging-db:5432/db/orbit_staging#bucket:orbit-uploads-staging to confirm this destructive operation.
```

## Step 3: Execute guarded restore

Provide the target confirmation, S3_BUCKET environment, and master encryption key:

```bash
DIRECT_URL="$STAGING_DATABASE_URL" \
S3_BUCKET="orbit-uploads-staging" \
bun run backup:restore /var/backups/orbit/orbit-backup-2026-09-20T12-00-00-abc123 \
  --confirm-destructive-restore-target="staging-db:5432/db/orbit_staging#bucket:orbit-uploads-staging" \
  --encryption-key-file=/etc/orbit/master.key \
  --json
```

During execution, Orbit:
1. Verifies pre-mutation checksums of the database dump and object payloads.
2. Checks migration ledger compatibility and prevents unsupported downgrades.
3. Acquires an advisory lock on the target database.
4. Decrypts and restores the PostgreSQL dump via `pg_restore`.
5. Applies any pending migrations if the target Orbit release is newer.
6. Reconciles and uploads stored attachment objects into the staging bucket.
7. Executes application-aware integrity checks.

## Step 4: Run application validation check

Confirm that all referential integrity checks and object checksums pass:

```bash
DIRECT_URL="$STAGING_DATABASE_URL" \
S3_BUCKET="orbit-uploads-staging" \
bun run backup:validate --json
```

Output should confirm:
- `valid`: `true`
- Referential integrity: 0 dangling members, teams, issues, or documents
- Storage check: 0 missing objects, 0 size mismatches

## Step 5: Teardown staging environment

Once recovery verification is complete, drop the staging database:

```bash
dropdb -h staging-db -p 5432 -U orbit orbit_staging
aws s3 rm s3://orbit-uploads-staging --recursive --endpoint-url "$S3_ENDPOINT"
```

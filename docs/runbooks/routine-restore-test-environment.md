# Routine restore into a test environment

Restore a full archive into disposable resources before trusting it for recovery.
Follow the [shared preparation](README.md#preparation-shared-by-every-procedure).

Provision an empty recovery database, a separate object bucket and separate Redis.
Configure only their endpoints and credentials in /etc/orbit/recovery.env, including
S3_ENDPOINT for custom storage. Keep outbound integrations disabled in the isolated
application so restored tokens cannot send messages or reconcile production work.
Use the matching encoded key and the exact archive child returned at capture.

## Confirm the target without mutation

The CLI rejects a missing confirmation before it can display the computed identity.
To inspect that identity, use a valid archive and a deliberately nonmatching value:

```bash
bun --env-file=/etc/orbit/recovery.env run backup:restore \
  /var/backups/orbit/orbit-backup-EXACT-ID \
  --confirm-destructive-restore-target=inspect-only \
  --json
```

Expect a nonzero exit and a mismatch error naming the required target identity.
No restore is authorized by that probe. Independently compare the database and
bucket with the disposable resources you provisioned.

## Restore the database and objects

For a recovery environment configured as staging-db:5432/orbit_staging and bucket
orbit-uploads-staging, the confirmation is:

```bash
bun --env-file=/etc/orbit/recovery.env run backup:restore \
  /var/backups/orbit/orbit-backup-EXACT-ID \
  --confirm-destructive-restore-target="staging-db:5432/db/orbit_staging#bucket:orbit-uploads-staging" \
  --encryption-key-file=/etc/orbit/master.key \
  --json
```

Replace the example identity with the one verified for your environment. Apply
the key-source precedence checks in the index before using a file-based key.

The engine verifies archive checksums and compatible migration history, decrypts
the dump, acquires its target lock, replaces the target database, applies supported
pending migrations, reconciles objects and runs integrated validation. A successful
result has `status: "ok"`, `databaseRestored: true` and `validation.valid: true`.
Review `objectsReconciled` and `validation.storage` rather than assuming a fixed
number of objects.

## Validate the application

```bash
bun --env-file=/etc/orbit/recovery.env run backup:validate --json
```

Require `validation.valid` true and no validation errors. This additional standalone
check is relational and Redis-aware; its storage counters are zero because the CLI
does not supply a storage driver. The preceding full restore supplies object checks.
Download representative attachments, inspect complete relationships, sign in as
restored users, and verify ordinary/private-team access and revoked credentials.

Only remove resources still classified as disposable after testing. If any database,
bucket or Redis instance is promoted into live use, exclude it from teardown and
record its new owner and retention obligations.

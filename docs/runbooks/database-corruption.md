# Database corruption recovery runbook

This runbook guides operators through recovering from relational database corruption,
unrecoverable table corruption, hardware storage failure, or failed PostgreSQL transactions.

## Triage and symptoms

Database corruption typically manifests as:
- PostgreSQL errors such as `ERROR: invalid page in block`, `ERROR: could not read block`, or `tuple concurrently updated`
- `bun run db:check-drift` reporting missing catalogs, broken check constraints, or corrupted system catalogs
- Application crashing on specific issue, user, or organization queries

## Step 1: Isolate application traffic

Prevent corrupted writes or cascading errors by pausing public traffic:

```bash
# Return maintenance 503 at your reverse proxy or gateway, or stop web workers:
sudo systemctl stop orbit-web
```

## Step 2: Inspect newest verified backup

Locate the newest known-good backup:

```bash
# Inspect backup manifest metadata:
cat /var/backups/orbit/latest/manifest.json | jq '{createdAt, databaseVersion, counts}'
```

Ensure the selected backup completed cleanly without an `.incomplete` marker.

## Step 3: Prepare a fresh PostgreSQL database

Do not attempt to write directly over a corrupted database cluster. Create a clean
database instance or schema:

```bash
# Create a fresh replacement database
PGPASSWORD="$PGPASSWORD" createdb -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" orbit_recovered
```

## Step 4: Restore relational data

Run guarded restore targeting the new database:

```bash
bun run backup:restore /var/backups/orbit/latest \
  --database-url="postgres://$PGUSER:$PGPASSWORD@$PGHOST:$PGPORT/orbit_recovered" \
  --confirm-destructive-restore-target="$PGHOST:$PGPORT/db/orbit_recovered#bucket:$S3_BUCKET" \
  --encryption-key-file=/etc/orbit/master.key \
  --skip-object-restore \
  --json
```

The `--skip-object-restore` flag skips re-uploading file attachments that already exist
in your intact S3 bucket, saving egress and recovery time.

## Step 5: Run application validation

Verify that the recovered database has 0 dangling foreign keys and that all attachment
records correspond to live files in the bucket:

```bash
DIRECT_URL="postgres://$PGUSER:$PGPASSWORD@$PGHOST:$PGPORT/orbit_recovered" \
bun run backup:validate --json
```

If the validator reports missing attachment objects created after the backup snapshot,
review the generated report and determine whether those objects should be pruned or restored.

## Step 6: Swap database endpoints and resume service

Update `DATABASE_URL` and `DIRECT_URL` in your deployment environment or rename the database:

```bash
# Rename corrupted database to archive and promote recovered database:
psql -h "$PGHOST" -U "$PGUSER" -d postgres -c "ALTER DATABASE orbit RENAME TO orbit_corrupted_archive;"
psql -h "$PGHOST" -U "$PGUSER" -d postgres -c "ALTER DATABASE orbit_recovered RENAME TO orbit;"

# Flush Redis cache
redis-cli -u "$REDIS_URL" flushdb

# Restart the application
sudo systemctl start orbit-web
```

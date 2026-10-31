# Region and provider migration runbook

This runbook guides operators through migrating an active Orbit deployment across
cloud regions or infrastructure providers (e.g. Supabase to self-hosted PostgreSQL,
or AWS S3 to Cloudflare R2).

## Planning and downtime window

Because durable application state lives in PostgreSQL and object storage, migrating
between providers requires capturing a consistent snapshot during a scheduled
maintenance window to guarantee zero data loss.

## Step 1: Pre-migration preparation

1. Lower the DNS TTL on your Orbit domain to 300 seconds (5 minutes) at least 24 hours in advance.
2. Provision the destination PostgreSQL database, Redis instance, and S3 bucket in the new region.
3. Configure bucket CORS on the destination bucket using `infra/s3-cors.json`.

## Step 2: Enable maintenance mode and capture final snapshot

1. Pause public traffic to prevent incoming writes during cutover:

```bash
# Return 503 at reverse proxy or stop application processes
sudo systemctl stop orbit-web
```

2. Capture a final, coordinated backup snapshot:

```bash
bun run backup:create \
  --destination /var/backups/orbit/migration-cutover \
  --encryption-key-file /etc/orbit/master.key \
  --json
```

3. Note the exact backup directory and generated manifest checksums.

## Step 3: Transfer archive to new host/region

Transfer the encrypted backup directory to the destination environment:

```bash
# Example rsync or aws s3 sync:
aws s3 sync /var/backups/orbit/migration-cutover/ s3://migration-transit-bucket/cutover/
```

On the destination host, retrieve the archive:

```bash
aws s3 sync s3://migration-transit-bucket/cutover/ /var/backups/orbit/migration-cutover/
```

## Step 4: Execute guarded restore on destination

Compute and confirm the destination target identity:

```bash
# Execute restore targeting the new database and new S3 bucket with destination storage credentials:
S3_BUCKET="$NEW_S3_BUCKET" \
S3_ENDPOINT="$NEW_S3_ENDPOINT" \
S3_REGION="$NEW_S3_REGION" \
S3_ACCESS_KEY_ID="$NEW_S3_ACCESS_KEY_ID" \
S3_SECRET_ACCESS_KEY="$NEW_S3_SECRET_ACCESS_KEY" \
bun run backup:restore /var/backups/orbit/migration-cutover \
  --database-url="postgres://$NEW_DB_USER:$NEW_DB_PASSWORD@$NEW_DB_HOST:5432/$NEW_DB_NAME" \
  --confirm-destructive-restore-target="$NEW_DB_HOST:5432/db/$NEW_DB_NAME#bucket:$NEW_S3_BUCKET" \
  --encryption-key-file=/etc/orbit/master.key \
  --json
```

This restores the PostgreSQL dump and re-uploads all attachments to the destination bucket.

## Step 5: Validate target environment

Run the restore validator to confirm catalog drift, ledger compatibility, and attachments:

```bash
DIRECT_URL="postgres://$NEW_DB_USER:$NEW_DB_PASSWORD@$NEW_DB_HOST:5432/$NEW_DB_NAME" \
S3_BUCKET="$NEW_S3_BUCKET" \
REDIS_URL="$NEW_REDIS_URL" \
bun run backup:validate --json
```

Confirm that validation reports `status: "ok"`.

## Step 6: Update configuration and switch DNS

1. Update the application `.env` on the new host with the new database, Redis, and storage endpoints.
2. Start the Orbit web and realtime services on the new host:

```bash
bun run build
PORT=3000 bun run start
```

3. Update your DNS A/CNAME record to point to the new IP or CDN origin.
4. Verify end-to-end functionality (user sign-in, issue loading, attachment downloads, live websocket updates).
5. Once verified, decommission the old infrastructure.

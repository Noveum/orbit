# Object storage loss recovery runbook

This runbook covers restoring uploaded attachments, avatars, and file objects when
the primary S3 bucket is accidentally deleted, corrupted, or unavailable.

## Triage and symptoms

- Users report broken image avatars, failed document attachment downloads, or 404 errors on `/api/uploads`
- Browser console reports S3 `NoSuchBucket` or `AccessDenied` errors during direct presigned uploads
- `bun run backup:validate` reports missing stored objects referenced by database rows

## Step 1: Recreate bucket and configure CORS

Recreate the target S3 bucket in your storage provider (Cloudflare R2, AWS S3, MinIO, or Supabase):

```bash
# Create bucket
aws s3 mb "s3://$S3_BUCKET" --region "$S3_REGION"

# Apply required CORS configuration for browser direct uploads:
sed "s|__ORBIT_ORIGIN__|https://orbit.example.com|" infra/s3-cors.json > /tmp/cors.json
aws s3api put-bucket-cors --bucket "$S3_BUCKET" --cors-configuration file:///tmp/cors.json
```

## Step 2: Restore objects from backup archive

The backup directory stores all attachment objects inside the `objects/` directory.
When encryption is enabled, they are decrypted using the master key during restore.

To restore objects without overwriting your live PostgreSQL database, create a temporary
disposable database to receive the dump portion while S3 uploads are reconciled into the repaired bucket:

```bash
# Create temporary disposable database:
createdb -h localhost -p 5432 -U orbit orbit_disposable_restore

# Configure DIRECT_URL (or DATABASE_URL with DIRECT_URL unset) for the disposable target:
export DIRECT_URL="postgres://orbit:secret@localhost:5432/orbit_disposable_restore"

# Restore objects into the clean bucket:
bun run backup:restore /var/backups/orbit/latest \
  --confirm-destructive-restore-target="localhost:5432/db/orbit_disposable_restore#bucket:$S3_BUCKET" \
  --encryption-key-file=/etc/orbit/master.key \
  --json

# Clean up disposable database:
dropdb -h localhost -p 5432 -U orbit orbit_disposable_restore
```

The restore engine decrypts each object, validates its SHA-256 digest against the
backup manifest, and re-uploads it into the target bucket under its original storage key.

## Step 3: Validate storage referential integrity

Run the Orbit validator to ensure that every attachment row in PostgreSQL corresponds
to a readable object in S3 with the expected byte length:

```bash
bun run backup:validate --json
```

Verify that the output contains:
```json
"storageCheck": {
  "checkedObjects": 142,
  "missingObjects": 0,
  "sizeMismatches": 0,
  "errors": []
}
```

## Step 4: Verify end-user downloads

1. Open Orbit in a web browser.
2. Navigate to an issue with known attachments and confirm images render properly.
3. Download a document attachment and verify its integrity.

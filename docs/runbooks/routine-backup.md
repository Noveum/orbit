# Routine backup runbook

This runbook covers capturing consistent point-in-time snapshots of Orbit relational
data and uploaded attachments, encrypting the output, verifying archive integrity,
and scheduling automated retention.

## Prerequisites

- Access to the target database via `DIRECT_URL` or `DATABASE_URL`
- `pg_dump` available on the host (PostgreSQL 16 or newer)
- S3 credentials configured (`S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`)
- 256-bit AES master encryption key (stored in a file or secret manager)
- Dedicated backup storage volume with adequate capacity for database dumps and objects

## Step 1: Capture an encrypted backup

Orbit generates a coordinated snapshot: taking a transactional PostgreSQL dump and
retrieving all file attachments referenced by application records.

```bash
# Using a master key file:
bun run backup:create \
  --destination /var/backups/orbit \
  --encryption-key-file /etc/orbit/master.key \
  --json

# Or using a secret retrieval command (e.g. AWS Secrets Manager or 1Password CLI):
ORBIT_BACKUP_ENCRYPTION_COMMAND="aws secretsmanager get-secret-value --secret-id orbit-backup-key --query SecretString --output text" \
bun run backup:create \
  --destination /var/backups/orbit \
  --json
```

A successful backup creates a timestamped directory containing:
- `manifest.json`: Versioned manifest with checksums, migration ledger, counts, and encrypted DEK
- `database.dump.enc`: AES-256-GCM encrypted PostgreSQL custom-format dump
- `objects/`: Encrypted copies of all stored file attachments

If any phase fails, the directory is marked with `.incomplete` and the command exits nonzero.

## Step 2: Verify backup archive integrity

Check that the manifest is intact and all files match their SHA-256 digests:

```bash
# Inspect the generated manifest:
cat /var/backups/orbit/orbit-backup-<timestamp>-<hash>/manifest.json | jq .

# Verify archive file checksums match manifest digests:
node -e '
const fs = require("node:fs");
const crypto = require("node:crypto");
const path = require("node:path");

const backupDir = process.argv[1];
const manifest = JSON.parse(fs.readFileSync(path.join(backupDir, "manifest.json"), "utf8"));

function verifyFile(fileRel, expectedSha256) {
  const buf = fs.readFileSync(path.join(backupDir, fileRel));
  const actual = crypto.createHash("sha256").update(buf).digest("hex");
  if (actual !== expectedSha256) {
    throw new Error(`Digest mismatch for ${fileRel}: expected ${expectedSha256}, got ${actual}`);
  }
}

verifyFile(manifest.checksums.databaseDump.file, manifest.checksums.databaseDump.sha256);
for (const obj of manifest.checksums.objects) {
  verifyFile(path.join("objects", obj.key), obj.sha256);
}
console.log("Archive checksums verified successfully.");
' /var/backups/orbit/orbit-backup-<timestamp>-<hash>
```

Verify that:
- `encryption.enabled` is `true`
- `checksums.databaseDump.file` is `database.dump.enc`
- `migrationLedger` matches the latest applied migrations in PostgreSQL
- No plaintext credentials or secrets appear in the manifest

## Step 3: Run retention and pruning

Manage disk quota and backup age using `bun run backup:prune`:

```bash
# Keep 30 backups, retain for 14 days, enforce a 50GB ceiling:
bun run backup:prune \
  --destination /var/backups/orbit \
  --keep-count 30 \
  --keep-days 14 \
  --max-bytes 50GB \
  --stale-alert-hours 26 \
  --json
```

Guarantees provided by `backup:prune`:
- The newest valid backup is never deleted, regardless of quota limits.
- Stale `.incomplete` and `.tmp` directories are purged.
- Any backup containing a `.pinned` marker is permanently preserved.

## Step 4: Automate with systemd or cron

Install the packaged systemd units from `deploy/backup/systemd/`:

```bash
sudo cp deploy/backup/systemd/orbit-backup.* /etc/systemd/system/
sudo cp deploy/backup/systemd/orbit-backup-prune.* /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now orbit-backup.timer orbit-backup-prune.timer
```

Or execute the wrapper script via crontab on a dedicated administration host:

```bash
0 * * * * /opt/orbit/deploy/backup/run-backup-and-prune.sh >> /var/log/orbit-backup.log 2>&1
```

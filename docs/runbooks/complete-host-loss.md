# Complete host loss disaster recovery runbook

This runbook guides operators through full disaster recovery when the primary host,
server, or virtual machine is completely lost or destroyed.

## Recovery requirements

- Offsite replica of the newest encrypted backup archive (e.g. from S3 cold storage or secondary site)
- Recovery Key Encryption Key (KEK) from your offsite password manager or KMS
- New host or compute instance meeting minimum requirements (Linux x86_64 or arm64, 2+ CPU cores, 4GB+ RAM)
- Network connectivity to PostgreSQL, Redis, and S3-compatible storage

## Step 1: Provision clean host and base dependencies

On the replacement instance, install required system packages:

```bash
# Install Bun
curl -fsSL https://bun.sh/install | bash
export PATH="$HOME/.bun/bin:$PATH"

# Install PostgreSQL client tools (pg_dump, pg_restore, psql)
sudo apt-get update && sudo apt-get install -y postgresql-client curl jq
```

Clone the repository or unpack the candidate release archive:

```bash
git clone https://github.com/Noveum/orbit.git /opt/orbit
cd /opt/orbit
bun install --frozen-lockfile
```

## Step 2: Retrieve backup archive and master key

Download the latest verified backup archive from your offsite repository:

```bash
mkdir -p /var/backups/orbit
aws s3 sync s3://company-cold-storage/orbit-backups/latest/ /var/backups/orbit/latest/

# Retrieve the master encryption key securely into an owner-readable file
chmod 700 /etc/orbit
aws kms decrypt --ciphertext-blob fileb://master-key.encrypted --output text --query Plaintext | base64 -d > /etc/orbit/master.key
chmod 600 /etc/orbit/master.key
```

## Step 3: Prepare configuration

Create the runtime `.env` file with new connection endpoints:

```bash
cat << 'EOF' > /opt/orbit/.env
DATABASE_URL=postgres://orbit:secret@new-postgres:5432/orbit
DIRECT_URL=postgres://orbit:secret@new-postgres:5432/orbit
REDIS_URL=redis://new-redis:6379
BETTER_AUTH_SECRET=fresh-or-preserved-32-byte-hex-secret
BETTER_AUTH_URL=https://orbit.example.com
NEXT_PUBLIC_APP_URL=https://orbit.example.com
S3_ENDPOINT=https://s3.example.com
S3_REGION=us-east-1
S3_BUCKET=orbit-uploads
S3_ACCESS_KEY_ID=access-key
S3_SECRET_ACCESS_KEY=secret-key
EOF
```

## Step 4: Restore database and object storage

Execute guarded restore targeting the new database and bucket:

```bash
# Preview target identity:
bun run backup:restore /var/backups/orbit/latest

# Execute restore with confirmation:
bun run backup:restore /var/backups/orbit/latest \
  --confirm-destructive-restore-target="new-postgres:5432/db/orbit#bucket:orbit-uploads" \
  --encryption-key-file=/etc/orbit/master.key \
  --json
```

## Step 5: Start Redis from clean state

Redis holds disposable fan-out state and starts empty without loss of durable application data:

```bash
# Ensure Redis is running and reachable
redis-cli -u "$REDIS_URL" ping
```

## Step 6: Validate restored application state

Run the validator to verify ledger integrity, referential integrity, and attachment objects:

```bash
bun run backup:validate --json
```

Verify that `status` is `ok`. This unlocks the recovery gate in PostgreSQL, allowing
the web application to transition `/api/health` from HTTP 503 to HTTP 200.

## Step 7: Start Orbit and verify user login

Launch the web application:

```bash
bun run build
PORT=3000 bun run start
```

Sanity checks:
1. Verify `/api/health` returns status `ok`.
2. Existing users can sign in with their passkeys or credentials.
3. No bootstrap window opens for unknown users.
4. Issue attachments and documents open without error.
5. Live updates propagate between two open browser tabs.

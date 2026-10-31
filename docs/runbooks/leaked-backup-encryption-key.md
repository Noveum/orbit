# Leaked backup encryption key incident runbook

This runbook defines the incident response procedure when a master backup encryption
key (KEK) is compromised, leaked in logs, inadvertently committed to version control,
or accessed by unauthorized parties.

## Threat model and scope

Orbit backups protect customer content, issue descriptions, user accounts, password
hashes, OAuth tokens, and attachment binaries using envelope encryption (AES-256-GCM).
A leaked Key Encryption Key compromises the confidentiality of all backup archives
encrypted with that key ID.

## Step 1: Containment and assessment

1. Identify where the key was leaked (e.g. public repository, application log, shell history).
2. Determine which backup archives were encrypted with the compromised key ID by inspecting
   `manifest.json` under your backup storage directory:

```bash
# Find all backups encrypted with the compromised key ID:
grep -rn "keyId" /var/backups/orbit/*/manifest.json
```

3. Remove the leaked key from public or untrusted locations immediately.

## Step 2: Generate a fresh master key

Generate a cryptographically secure 256-bit (32-byte) key in hex or base64 format:

```bash
# Generate a new 64-character hex key
openssl rand -hex 32 > /etc/orbit/master-key-new.key
chmod 600 /etc/orbit/master-key-new.key
```

Or store the key in AWS KMS, Vault, or 1Password.

## Step 3: Capture an immediate backup with the new key

Capture a fresh, verified snapshot using the new key before modifying existing archives:

```bash
bun run backup:create \
  --destination /var/backups/orbit \
  --encryption-key-file /etc/orbit/master-key-new.key \
  --encryption-key-id "prod-kek-2026-v2" \
  --json
```

## Step 4: Address historical archives and purge compromised copies

Archives created with the compromised key remain permanently exposed to anyone who obtained
the leaked key, because re-encryption protects only the local copies you control. Any previously
exfiltrated or replicated copy cannot be retroactively secured.

1. If historical backups must be preserved locally under the new key, decrypt the payload into an isolated directory and re-encrypt with the new master key.
2. Expire compromised backups from the local destination:

```bash
# Keep only the fresh backup created under the new key:
bun run backup:prune \
  --destination /var/backups/orbit \
  --keep-count 1 \
  --json
```

3. Delete compromised archives across every configured backup destination:

```bash
# Local storage deletion:
rm -rf /var/backups/orbit/orbit-backup-compromised-*

# S3 or cold-storage replica deletion:
aws s3 rm s3://company-cold-storage/orbit-backups/orbit-backup-compromised --recursive

# Secondary mirror or disaster recovery bucket deletion:
aws s3 rm s3://company-dr-storage/orbit-backups/orbit-backup-compromised --recursive
```

## Step 5: Update automated services

Update systemd timers and environment files to point to the new key:

```bash
# Update key file location in /etc/orbit/backup.env
sudo sed -i 's|/etc/orbit/master.key|/etc/orbit/master-key-new.key|' /etc/orbit/backup.env
sudo systemctl restart orbit-backup.timer
```

## Step 6: Post-incident review

- Revoke the compromised key in your KMS or password manager.
- Review access logs to determine if external IP addresses accessed the backup storage bucket.
- Record the incident in your organization's security log.

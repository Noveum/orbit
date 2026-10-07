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

## Step 4: Re-encrypt existing archives or rotate retention

To preserve older historical backups while protecting them under the new key:

1. Restore the older backup into an isolated staging directory or decrypt its payload using the old key.
2. Re-create the archive using the new master key.
3. Alternatively, if your retention policy allows, expire older compromised backups using `backup:prune`:

```bash
# Keep only the fresh backup created under the new key:
bun run backup:prune \
  --destination /var/backups/orbit \
  --keep-count 1 \
  --json
```

4. Permanently erase compromised ciphertext files from disk and offsite replicas:

```bash
# Shred compromised older backup directories:
rm -rf /var/backups/orbit/orbit-backup-compromised-*
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

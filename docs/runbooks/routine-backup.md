# Routine backup runbook

Follow the [shared preparation](README.md#preparation-shared-by-every-procedure).
Set the direct database and source storage credentials in the protected operator
environment. Ensure enough private scratch disk for plaintext and encrypted dump
copies during capture. Backup encryption does not remove the need to protect the
host, scratch disk and offsite key custody.

## Capture an encrypted archive

For a file-based key, first check that no old inline key will override it:

```bash
bun --env-file=/etc/orbit/orbit.env -e 'if (process.env["ORBIT_BACKUP_ENCRYPTION_KEY"]?.trim()) throw new Error("Remove the inline backup key before selecting a key file");'
bun --env-file=/etc/orbit/orbit.env run backup:create \
  --destination /var/backups/orbit \
  --encrypt \
  --encryption-key-file /etc/orbit/master.key \
  --json
```

Keep the returned `backupDir` and manifest. Check `manifest.encryption.enabled` is
true and `manifest.encryption.keyId` is the expected key label. Successful archives
contain manifest.json, database.dump.enc and encrypted objects under their storage
keys in objects/. Without encryption the dump is database.dump.

The command publishes a generated archive child only after capture completes.
Failed unencrypted captures may leave a sibling ending in .incomplete; encrypted
capture failures remove their working directory to avoid retaining plaintext.
Neither case produces a valid final archive.

## Verify recoverability

Use [an isolated full restore](routine-restore-test-environment.md) of the exact
returned archive. The restore engine verifies each archived ciphertext checksum
and, when encrypted, decryption/plaintext checksums before or during recovery.
Then inspect representative restored data, access rules and attachment downloads.

Do not use backup:validate to check archive files or to prove bucket byte integrity:
the standalone CLI does not supply an object storage driver. Manifest inspection
alone is not a restore test.

## Preview retention before deleting

```bash
bun --env-file=/etc/orbit/orbit.env run backup:prune \
  --destination /var/backups/orbit \
  --keep-count 30 \
  --keep-days 14 \
  --max-bytes 50GB \
  --stale-alert-hours 26 \
  --dry-run \
  --json
```

After reviewing the exact candidates, remove --dry-run to apply that policy.
Count, age and GFS selections are combined as a union. The byte quota is applied
afterward and can remove older unpinned archives selected by those rules. The
newest checksum-valid backup and pinned/legal-hold backups remain protected, even
if that prevents satisfying the quota. Pinning lasts while its marker or configured
hold remains; it is not a separate immutable-storage guarantee.

The pruner also handles abandoned .tmp/.incomplete directories under its configured
age and lock-age checks. Review those candidates, environment-provided retention
rules and legal holds before applying. A stale-backup alert exits with code 2.

## Schedule one administration runner

The packaged units in deploy/backup/systemd use WorkingDirectory=/opt/orbit,
User=orbit and EnvironmentFile=/etc/orbit/orbit.env. Install them through your host
administration process after checking the Bun path, permissions and writable backup
directory. Before enabling timers, explicitly configure:

```text
ORBIT_BACKUP_ENCRYPT=true
ORBIT_BACKUP_ENCRYPTION_KEY_FILE=/etc/orbit/master.key
ORBIT_BACKUP_ENCRYPTION_KEY_ID=prod-current
```

The inline key must be absent or blank for the file to be selected. The orbit user
must be able to read the encoded key and environment file. Test capture as that
same user, inspect encryption.enabled and the key ID, and complete an isolated
restore before relying on the schedule. The packaged service itself does not force
encryption without this configuration.

For cron, explicitly change to the repository root before the wrapper, for example
`cd /opt/orbit && ./deploy/backup/run-backup-and-prune.sh`. An absolute wrapper path
alone does not change the working directory. Configure the same protected key and
connection environment for the scheduler, and avoid overlapping runners. The wrapper
passes its extra arguments to capture and then runs retention with its own policy.

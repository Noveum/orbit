# Operator runbooks

Use these procedures with the exact Orbit release whose migrations will run during
recovery. A restore replaces the target database. A recovery drill also deletes
target data and flushes its separately confirmed Redis database. Use isolated
resources until the incident owner approves a production cutover.

## Preparation shared by every procedure

Run commands from the repository root. The examples use protected operator-owned
environment files at /etc/orbit/orbit.env for backup capture and
/etc/orbit/recovery.env for an isolated restore. Configure explicit database, Redis
and storage endpoints in each file, including S3_ENDPOINT for a custom provider.
Ensure inherited environment variables and the repository .env do not point a
recovery command at production. Existing shell variables can override env-file
values. Loading an env file with Bun does not export it into the parent shell.

Use a direct PostgreSQL connection, not a transaction-mode pooler. Install a
pg_dump version at least as new as the source server and compatible pg_restore
tools. The operator running the command, including the orbit systemd user, must
be able to read the key and environment files. Create private directories with
mode 0700 and files with mode 0600 before putting secrets in them.

For encrypted backups, use a 32-byte key encoded as 64 hex characters or 44 base64
characters. A nonempty ORBIT_BACKUP_ENCRYPTION_KEY overrides a key file, even an
explicit --encryption-key-file. Key files take precedence over helper commands.
Before selecting a key file, remove or blank an old inline key in both the
inherited environment and every loaded environment file. Never put key material
in command arguments. Key IDs are labels, not a key lookup service.

Use the exact backupDir returned by backup:create --json, or its manifest.json.
The destination is a parent containing generated archive directories. Orbit does
not create a latest alias. Replace example archive paths with that exact child.

A restore confirmation names the computed database host, port, database and bucket:
`host:port/db/database#bucket:bucket`. It is an acknowledgement of destruction,
not proof that the target is safe. Independently verify the configured endpoints,
credentials and ownership before confirming. The drill has a separate Redis
confirmation including protocol, host, port and database.

## What validation proves

| Operation | Checks and limits |
| --- | --- |
| backup:restore | Verifies archived checksums/compatibility and decrypts the dump before database replacement; decrypts and reconciles objects afterward by default; validates relational state, referenced object presence/read size, and configured Redis connectivity; records recovery readiness |
| backup:validate | Reports ledger/catalog compatibility, relational references, ownership/bootstrap checks and configured Redis connectivity; the CLI supplies no storage driver, so its zero storage counts do not prove object recovery |
| backup:recovery-drill | Exercises representative backup/restore, attachment hashes and access checks on disposable targets; does not certify every application workflow |

Standalone validation reports `status` plus `validation.valid`,
`validation.migrationStatus`, `validation.integrity`, `validation.storage`,
`validation.auth`, `validation.redis`, `validation.errors` and duration.
It does not inspect archive bytes, establish Redis emptiness or update
orbit_recovery_state. A skipped/unconfigured Redis check is not a successful ping.

Restore owns the restoring/validation_failed/ready transitions. Preflight failures
can leave the prior state unchanged. The health endpoint reports that state; keep
traffic fenced operationally until integrated recovery and user checks pass.
Do not clear readiness with SQL based only on standalone validation.

## Catalog

| Scenario | Runbook |
| --- | --- |
| Capture, encryption and scheduling | [Routine backup](routine-backup.md) |
| Isolated full restore | [Routine test restore](routine-restore-test-environment.md) |
| Total host loss | [Complete host loss](complete-host-loss.md) |
| Database corruption | [Database corruption](database-corruption.md) |
| Bucket or attachment loss | [Object storage loss](object-storage-loss.md) |
| Compromised backup key | [Leaked key](leaked-backup-encryption-key.md) |
| Interrupted migration | [Failed migration](failed-migration.md) |
| Deleted application content | [Accidental deletion](accidental-deletion-recovery.md) |
| Infrastructure cutover | [Region/provider migration](region-provider-migration.md) |
| Failed recovery checks | [Validation failure](validation-failure-after-restore.md) |

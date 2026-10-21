# Operator runbooks

These runbooks provide step-by-step procedures for routine backup administration,
staging restores, disaster recovery, security incidents, and database repairs.

Every procedure uses supported Orbit commands (`bun run backup:create`,
`bun run backup:restore`, `bun run backup:validate`, `bun run backup:prune`,
`bun run backup:recovery-drill`, and `bun run db:release`) or standard PostgreSQL
and object-storage tooling.

## Runbook catalog

| Scenario | Objective | Runbook |
| --- | --- | --- |
| Routine backup | Capture consistent, encrypted snapshots and automate retention | [Routine backup](routine-backup.md) |
| Routine test restore | Practice restores in a safe staging environment | [Routine restore into test environment](routine-restore-test-environment.md) |
| Total host loss | Rebuild a deployment from scratch using an offsite backup archive | [Complete host loss](complete-host-loss.md) |
| Database corruption | Recover relational integrity following storage or disk failure | [Database corruption](database-corruption.md) |
| Storage bucket loss | Restore uploaded file attachments and reconcile S3 state | [Object storage loss](object-storage-loss.md) |
| Leaked encryption key | Rotate master keys and re-encrypt archives following a leak | [Leaked backup encryption key](leaked-backup-encryption-key.md) |
| Failed migration | Reconcile advisory locks and forward-repair schema state | [Failed migration](failed-migration.md) |
| Accidental deletion | Recover accidentally deleted workspace or project content | [Accidental deletion recovery](accidental-deletion-recovery.md) |
| Region or cloud migration | Relocate an Orbit deployment across regions or cloud providers | [Region and provider migration](region-provider-migration.md) |
| Validation failure | Diagnose and resolve post-restore integrity errors | [Validation failure after restore](validation-failure-after-restore.md) |

## Core operator principles

1. **Target identity confirmation:** Every destructive restore requires passing
   `--confirm-destructive-restore-target=<target>`, where `<target>` matches the
   computed destination identity (`<host>:<port>/db/<database>#bucket:<bucket>`).
   This prevents accidentally restoring a snapshot into a production cluster.
2. **Envelope encryption:** Backups are encrypted before leaving the host using
   AES-256-GCM. Never pass raw encryption keys as command-line arguments. Use
   `--encryption-key-file` or the `ORBIT_BACKUP_ENCRYPTION_KEY` environment variable.
3. **Machine-readable validation:** Orbit gates deployment readiness until
   `bun run backup:validate` passes ledger checks, catalog drift, referential
   integrity, object storage byte verification, and Redis connectivity.
4. **Automated drills:** Recovery readiness is verified continuously in CI via
   `bun run backup:recovery-drill` and `bun run backup:upgrade-matrix`.

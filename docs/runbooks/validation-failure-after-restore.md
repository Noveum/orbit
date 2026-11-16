# Validation failure after restore

Keep the recovery deployment isolated and traffic fenced until the failure is
understood. Preserve the archive, exact release, target identity and redacted
command output. Do not delete attachment rows, flush shared Redis or clear the
recovery gate just to make a check pass.

## Identify which operation failed

backup:restore controls recovery readiness and can record restoring,
validation_failed or ready. A failure during an early manifest, confirmation or
checksum check can leave the previous state unchanged. backup:validate only
reports consistency and does not change orbit_recovery_state, even when it fails.

```bash
bun --env-file=/etc/orbit/recovery.env run backup:validate --json
```

The actual output has top-level status and a validation result containing:

| Field | Meaning |
| --- | --- |
| validation.valid and validation.errors | Overall result and error messages |
| validation.migrationStatus | ledgerCount, isBehind, databaseVersion |
| validation.integrity | Entity counts and referentialIntegrityPassed |
| validation.auth | accountsCount and bootstrapWindowClosed |
| validation.storage | checkedObjects, missingObjects, sizeMismatches |
| validation.redis | tested and emptyStartSafe |
| validation.durationMs | Elapsed validation time |

The standalone CLI has no storage driver, so its storage counters do not establish
that a bucket is intact. Redis tested is only a connectivity check; emptyStartSafe
does not measure whether Redis is empty.

## Resolve the reported cause

For a migration or catalog failure, use [the failed-migration procedure](failed-migration.md)
with the exact release and explicit target environment. Do not edit the migration
ledger or previously applied SQL.

For object failures reported by the integrated restore, compare the manifest and
its verified payloads with the target bucket, endpoint and credentials. A missing
archive object requires a complete good archive or provider recovery, not deletion
of its database reference. Follow [object storage loss](object-storage-loss.md).

For relational or ownership failures, inspect the named relationships without
deleting evidence. Restore from a known-good recovery point or prepare a reviewed
forward repair that preserves the complete graph.

For Redis connectivity failures, verify the isolated target URL, TLS/CA settings
and network access. Do not flush a shared instance. A skipped Redis check is not
proof of connectivity or emptiness.

## Re-establish readiness through a complete restore

After correcting the target configuration or choosing a good archive, repeat the
guarded full restore, including object reconciliation, against isolated replacement
resources. This repeats archive checks, relational checks, referenced-object checks
and configured Redis connectivity before the engine records ready.

A standalone valid result does not provide that object evidence and cannot clear
the gate. Do not directly update orbit_recovery_state as a shortcut. If preserving
manual post-restore repairs prevents repeating restore, keep the deployment fenced
and obtain a separately reviewed recovery procedure.

Inspect /api/health for readiness, then verify user sign-in, permissions, attachment
downloads and realtime behavior before reopening traffic. Health is a readiness
signal, not a substitute for operator traffic controls.

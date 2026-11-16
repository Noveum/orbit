# Object storage loss recovery

Use this procedure for lost or corrupted stored attachments. Preserve the live
database and provider audit/version history. Archived objects cover only the
selected backup's references; newer attachments may require provider version
recovery or a newer archive.

## Prepare the destination storage

Provision the replacement bucket with the actual provider endpoint, region,
credentials and application origin. For custom S3-compatible providers, pass
--endpoint-url with the configured S3_ENDPOINT to AWS CLI administration commands; an unqualified AWS CLI
command otherwise targets AWS rather than R2/MinIO or another endpoint.

The CORS template at infra/s3-cors.json contains __ORBIT_ORIGIN__. Replace it with
the actual application origin before applying it to the intended bucket. Review the
result and scope every create, list and CORS action to the same endpoint and bucket.
Use your provider's established administration procedure rather than copying an
AWS-only command for a custom endpoint.

## Restore archived objects through a disposable database

Orbit has no objects-only restore CLI. Provision a disposable database to receive
the archive's relational dump while the restore engine uploads objects into the
replacement bucket. Configure /etc/orbit/object-recovery.env with that disposable
direct database URL, replacement storage endpoint/bucket/credentials and isolated
Redis. Keep the live database URL in a separate /etc/orbit/live-readonly.env.

Use the exact generated archive child, not its parent and not a presumed latest
alias. After the [target probe and key-source checks](routine-restore-test-environment.md),
run the guarded full restore using that environment, for example:

```bash
bun --env-file=/etc/orbit/object-recovery.env run backup:restore \
  /var/backups/orbit/orbit-backup-EXACT-ID \
  --confirm-destructive-restore-target="recovery-db:5432/db/orbit_object_recovery#bucket:orbit-repaired" \
  --encryption-key-file=/etc/orbit/master.key \
  --json
```

Replace the example identity with the verified disposable database and replacement
bucket identity. The engine verifies archive checksums, decrypts and reconciles
each archived object under its original key, and performs integrated validation
against the archive's restored references.

## Compare against the live database

```bash
bun --env-file=/etc/orbit/live-readonly.env run backup:validate --json
```

This command checks the live ledger and relational state; it cannot exhaustively
validate the bucket. A valid result and zero storage counts are not proof that
all live attachments exist. Compare the live database's ready attachment keys
and sizes against the replacement bucket through the provider's inventory tools,
download representative files, and account for every attachment newer than the
archive. Use a newer archive or provider recovery for missing newer objects.

Switch the application's storage endpoint/bucket only after that reconciliation
and user-level download checks pass. Delete only the disposable database used to
receive the dump. Preserve any bucket or Redis promoted into live service and
retain the source archive and recovery evidence.

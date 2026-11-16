# Region and provider migration

Plan a maintenance window and rollback before moving a live deployment. Provision
separate destination database, Redis and bucket resources. Configure the real
storage endpoint and credentials, including S3_ENDPOINT for custom providers.
Replace __ORBIT_ORIGIN__ in infra/s3-cors.json with the actual destination origin
before applying the reviewed CORS document through the destination provider.

## Capture and transfer the final archive

Fence every writer, including web requests, cron jobs, webhooks and background
workers. Preserve the old resources throughout the rollback window. Capture from
the source configuration:

```bash
bun --env-file=/etc/orbit/orbit.env run backup:create \
  --destination /var/backups/orbit/migration-cutover \
  --encrypt \
  --encryption-key-file=/etc/orbit/master.key \
  --json
```

Apply the shared key-source precedence checks first. Record the exact returned
backupDir and transfer that child directory, including manifest and objects, to
the destination. The parent migration-cutover directory is not itself an archive.

## Restore to destination resources

Configure /etc/orbit/recovery.env with the destination direct database URL, Redis,
S3 endpoint, bucket and credentials. Follow
[the guarded full restore procedure](routine-restore-test-environment.md), replacing
its archive path with the exact transferred child and its identity with the computed
destination identity. Restore both database and objects without skip flags.

Review the integrated restore's checksum, object and relational results. Then run
the standalone relational/Redis check:

```bash
bun --env-file=/etc/orbit/recovery.env run backup:validate --json
```

A standalone valid result does not independently verify destination attachments.
Complete sign-in, permissions, object download and realtime checks before cutover.

## Cut over with a rollback window

Deploy the verified release with destination runtime endpoints, then update the
application's canonical routing/DNS through the normal deployment process. Recheck
auth origins, storage CORS and Redis reachability. Keep source writers fenced to
avoid divergent databases. Obtain incident-owner approval before reopening traffic.

Retain old resources and the final archive until the rollback window closes.
Rollback after destination writes requires a reviewed data-reconciliation decision;
pointing back to the old snapshot would otherwise lose those writes. Do not delete
destination resources after promotion under an earlier disposable-resource plan.

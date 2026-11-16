# Complete host loss recovery

Recover into newly provisioned infrastructure using an offsite archive and its
matching encoded encryption key. Follow [shared preparation](README.md) and the
[self-hosting deployment guide](../self-hosting.md). Install the exact supported
release, Bun, compatible PostgreSQL client tools and storage-provider tools.

## Prepare the replacement environment

Keep traffic fenced. Retrieve the exact archive directory with its manifest and
objects; do not assume a latest alias exists. Store the recovery key in a private
directory with mode 0700 and a file with mode 0600, owned by the operator running
restore. A root-owned 0600 file is not readable by an unprivileged orbit service.
Secret-manager output must be the supported hex/base64 text, not undecoded raw
KMS bytes.

Prepare /etc/orbit/recovery.env with the replacement database, Redis and S3 endpoint,
bucket and credentials. Preserve required application auth secrets and provider
configuration under your incident policy. Verify inherited variables cannot
override these destinations. Never source an untrusted backup manifest as shell
environment.

## Restore and verify

Follow [the isolated restore procedure](routine-restore-test-environment.md) using
the exact archive child and computed replacement-target confirmation. Restore both
database and objects; do not use --skip-object-restore for a full-host recovery.

The integrated restore validates archive bytes, recovered relational state and
referenced object presence/read sizes, plus configured Redis connectivity. Inspect
its JSON result and then run:

```bash
bun --env-file=/etc/orbit/recovery.env run backup:validate --json
```

This standalone check does not inspect storage bytes, verify Redis emptiness or
update readiness. If restore failed, follow [validation failure](validation-failure-after-restore.md);
do not manually mark the recovery ready based on this command.

Use dedicated clean Redis for the replacement. Bun loads the env file for its
child only; a separate shell redis-cli command would not automatically inherit
REDIS_URL. The integrated check reports Redis connectivity when configured.
Do not flush a shared Redis instance.

## Cut over and retain rollback

Deploy the verified release using the deployment guide, with its runtime configured
for the verified replacement resources. Keep traffic fenced until health, existing
user sign-in, permissions, attachments and live updates pass. Record the data-loss
window and obtain incident-owner approval before routing users to the replacement.

Retain the incident evidence, source archive and former infrastructure until the
rollback window closes. Once promoted, the replacement database, bucket and Redis
are live resources, not disposable cleanup targets. Retire only the old resources
explicitly approved for decommissioning.

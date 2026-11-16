# Database corruption recovery

Use this procedure for confirmed database corruption or unrecoverable storage
failure. Ordinary transaction conflicts and application errors do not by themselves
prove physical corruption. Preserve database/provider diagnostics and fence writes
before selecting a recovery point.

## Restore into a clean replacement

Provision a new database on healthy infrastructure. Preserve the damaged source
and current object store for investigation. Follow
[the isolated full restore procedure](routine-restore-test-environment.md) with a
known-good archive, separate bucket and separate Redis. Review the exact target
identity and recovery data-loss window before confirming.

A full database/object restore provides an internally matched recovery point.
If an operator instead uses --skip-object-restore to retain an intact existing
bucket, that flag also omits integrated storage validation. A subsequent standalone
backup:validate does not fill that gap: its CLI has no storage driver. That path
requires a separate inventory of the recovered database's referenced keys against
the retained bucket, byte/download verification and explicit acceptance of any
missing recovery point. Prefer the isolated full restore when those checks cannot
be established.

## Check and cut over

```bash
bun --env-file=/etc/orbit/recovery.env run backup:validate --json
```

Require no relational validation errors, review the preceding restore's storage
result, and exercise sign-in, permissions, restored relationships and attachment
downloads. Objects created after the archive need a newer archive or provider
recovery; unrelated objects in the old bucket are not evidence of corruption.

Follow [complete host loss](complete-host-loss.md#cut-over-and-retain-rollback) for
cutover. Update the runtime endpoints as a reviewed deployment change, keep a
rollback plan, and retain the damaged database. Do not rename busy databases or
flush shared Redis as an automatic recovery step.

# Issue #215 release runbook

This guide covers deployment of Agent identities, issue attribution and the
transactional issue outbox. It is an operator procedure, not evidence that a
particular deployment has passed its release checks. Orbit's self-hosting status
remains [Preview](open-source-readiness.md).

Record the exact candidate commit, target environment and command outcomes in
the release record. Deploy code that understands Agent actors before enabling
Agent issue writes. For client behavior see [MCP server](mcp.md); for Worker
setup and monitoring see [Outbox worker deployment](outbox-worker-deployment.md).

## Supported starting database states

The ordered migration release supports these states:

- An empty database. `bun run db:release` applies the full journal.
- A database with a verified, contiguous ledger prefix from the official upstream history through `0029_material_psynapse` or an earlier exact prefix. The release runner applies the official suffix and then the Agent migration `0030_green_shaman`.
- A recognized legacy catalog with no ledger, or an explicitly documented upstream historical reconciliation. The release command verifies the live catalog and reconciles known historical data before baselining. Migration 0030's Agent attribution and credential changes do not have a schema-only baseline path.
- An interrupted release that left the migration's supported progress state. Inspect the exact error and ledger, keep the same code and database, then retry `bun run db:release`. Do not edit either ledger table by hand.

The earlier #215 development migrations used a competing 0017–0029 lineage.
Databases carrying those timestamps or hashes are not supported starting
points. The release runner rejects them without changing their ledger. Preserve
such databases for investigation; do not rename or manually repair their
ledger rows.

For an unrecognized legacy database, stop and resolve the named catalog drift
first. Follow [Database releases](database-releases.md) and the
[Agent migration compatibility notes](agent-migration-compatibility.md). Apply only
the catch-up appropriate to the reported catalog state, then rerun drift and
release. Do not use `db:push` as production migration evidence.

## Required connections

Set the variables in the deployment or migration environment without placing values in shell history or logs:

| Variable | Use |
| --- | --- |
| `DIRECT_URL` | Preferred direct or session-mode PostgreSQL connection for `bun run db:release`. It must point to the intended target database. |
| `DATABASE_URL` | Web and Worker runtime connection. Also used by `bun run db:check-drift` and `bun run db:catchup`. |
| `REDIS_URL` | Same Redis deployment for Web, MCP and Worker. Use `rediss://` where supported. |

For migration verification, make `DATABASE_URL` target the same database as `DIRECT_URL`. For runtime, configure Web and Worker with the same PostgreSQL and Redis endpoints. Never pass test database URLs into production deploy settings or production URLs into a test lane.

## Database release sequence

1. Confirm the repository, branch and exact candidate commit. Confirm the target database and the provider's backup or point-in-time recovery window. Prevent concurrent schema releases.
2. Keep `ORBIT_AGENT_ISSUE_WRITE` false or unset. The web-side Agent gates should remain dark until migration and post-migration checks finish.
3. Record the target's current ledger prefix and counts for existing `mcp_grant`, `oauth_access_token`, `issue`, `issue_activity`, `audit_log`, `notification` and `issue_outbox` tables. Record a not-yet-created table as absent, not as a query failure. Keep the values in the change record, without connection strings or secrets. Notify users that legacy unbound MCP credentials will stop working during the upgrade, even while feature gates are off.
4. Apply the committed migration journal:

   ```bash
   bun run db:release
   ```

   Compare the applied and recorded counts with the candidate's committed journal
   and the captured starting ledger. An already-current database reports zero
   pending migrations. Do not reuse migration counts from another candidate.

5. Apply a catch-up only after identifying why the target needs it. The Agent compatibility catch-up is:

   ```bash
   bun run db:catchup -- packages/db/catchup/agent-actors.sql
   ```

   This script is repeatable, but it is not a substitute for the ordered release
   or a reason to ignore an unknown catalog. After any required catch-up, rerun
   `bun run db:release` before proceeding.

6. Check the runtime URL against the committed schema:

   ```bash
   bun run db:check-drift
   ```

   Expected output says that the target has every schema object and invariant required by this checkout. A required drift result blocks the release.

7. Compare the same data counts and key historical records captured in step 3. Confirm Human issue creators and assignees, Activity, audit history, notifications and subscriptions remain intact. Confirm there are no synthetic Activity, Notification or Outbox rows caused by the migration.
8. Confirm legacy unbound Grants have been frozen with `agent_identity_required`, their access tokens no longer work, and their users must reconnect through OAuth consent and select or create an Agent. Do not restore those old credentials.
9. Keep evidence of the commands, exit codes, migration count and drift result with the PR and release record.

Applied migrations are immutable. For failed DDL or an incompatible live catalog,
preserve the database and migration ledger, capture the exact error, and resolve
forward using the migration guide. If data integrity is in doubt, use the
provider's rehearsed point-in-time recovery procedure. Do not delete migration
history, restore a partial ledger manually, or run destructive Down migrations.

## Web, MCP and Worker configuration

| Setting | Web and MCP | Persistent Worker |
| --- | --- | --- |
| `DATABASE_URL` | Runtime PostgreSQL URL | Same PostgreSQL database as Web |
| `REDIS_URL` | Runtime Redis URL | Same Redis deployment as Web |
| `ORBIT_AGENT_IDENTITY_READ` | `true` to expose Agent identity/settings read paths | Not required |
| `ORBIT_AGENT_CONSENT` | `true` to accept Agent OAuth consent | Not required |
| `ORBIT_AGENT_ISSUE_WRITE` | `true` only for the final Writer enablement | Not required |
| `ORBIT_ISSUE_OUTBOX_DISPATCH` | `true` for outbox Cron recovery | `true`, required at Worker startup |
| `CRON_SECRET` | Required for the scheduled Web routes | Not required |

Use the standard Web authentication and public URL settings from [Configuration](configuration.md). Never set `ORBIT_DEV_LOGIN` on a deployed environment. Do not include credentials in a PR, transcript or image build argument.

All four Agent gates default to off and accept only the exact value `true`. `agentIssueWritesEnabled()` requires all four gates. These are process-wide environment variables. They do not support Workspace-level rollout or Workspace-level percentage canaries.

Build and supervise the Worker using [Outbox worker deployment](outbox-worker-deployment.md).
Image build success alone is not a running Worker. Keep the same release version
on Web and Worker. Cron is a recovery path, not the primary delivery process.

## Gate opening order

1. Deploy the schema-compatible Web build with `ORBIT_AGENT_ISSUE_WRITE` false. Keep the three supporting gates false until migrations are verified.
2. Start the persistent Worker with its dispatch gate true after the database is at the expected schema. Check that it connects to the same Postgres and Redis as Web and logs `issue outbox worker started`.
3. Set `ORBIT_ISSUE_OUTBOX_DISPATCH=true` on Web so Cron can recover Worker outages. Check the Cron route and queue statistics.
4. Enable `ORBIT_AGENT_IDENTITY_READ=true` and `ORBIT_AGENT_CONSENT=true` on Web. Confirm existing connection cards explain that legacy unbound connections require reconnect, then complete OAuth consent with a selected Agent identity.
5. Observe Reader, Consent and Outbox behavior with Writer still off. Run the release smoke flow and check queue metrics and redaction logs.
6. Enable `ORBIT_AGENT_ISSUE_WRITE=true` on Web only after the Worker is continuously healthy, events are reaching Redis, and all database and user-flow checks pass. This is the final gate.

## Health and monitoring

Use the [Worker monitoring checklist](outbox-worker-deployment.md#monitoring)
before and after Writer enablement. Define the delivery latency objective and
alert owner before launch, and confirm a real event reaches another authorized
browser. A running process or successful image build alone is insufficient.

## Release acceptance

- Run `bun run verify` on the final candidate with isolated test databases and
  configured object storage. Record skipped tests explicitly. Run the relevant
  Playwright tests and `bun run docs:build` separately.
- Follow [Testing](testing.md#agent-release-checks) for real HTTP MCP and the
  fresh-process Writer-off check. Test OAuth, Agent issue creation and assignment,
  queue reads, attribution, and Pause/Revoke/Delete credential invalidation.
- Rehearse an empty database release, every supported upgrade path, a repeated
  release, and drift verification in disposable databases.
- Rehearse Worker shutdown/restart and Redis outage recovery. Confirm queued
  events drain, duplicates are tolerated, and public payloads omit grant IDs.
- Before announcing production availability, repeat discovery, OAuth and MCP
  smoke checks through the intended public HTTPS origin. Verify real storage
  CORS, provider credentials, Worker supervision and alerts. Local loopback tests
  do not establish production DNS, TLS, proxy or provider compatibility.

Keep sanitized evidence with the PR and release record, not machine-specific
paths or credential-bearing artifacts in the published documentation. A focused
rerun does not supersede a failed full-workspace run.

## Legacy Grant and client impact

The migration freezes legacy Grants without an Agent identity, records `agent_identity_required`, and invalidates their old access tokens. Legacy MCP clients must reconnect and complete the OAuth consent screen again, then select or create an Agent identity. The Orbit settings page shows `Action required: reconnect and choose an agent identity.` An old token is rejected with an agent-identity or revoked-connection response. Client-specific UI wording depends on that MCP client; publish a user notice before migration and provide the reconnect steps.

## Failure response and rollback

### Database migration or drift failure

- Keep Writer off and stop the release pipeline.
- Preserve the release log, exact candidate, catalog drift output and migration ledger state.
- Do not edit applied migration files or the ledger. Retry only the same release after resolving a known transient issue or the exact documented catch-up requirement.
- Use provider point-in-time recovery only through the rehearsed recovery plan. Otherwise ship a forward repair migration and rerun release plus drift checks.

### Worker or Redis outage

- Keep Agent Writer off or turn it off if it is already enabled. Existing queued events remain available for recovery.
- Keep Web dispatch enabled when the Cron recovery path and Redis are healthy. Restart the same compatible Worker image with the configured restart policy after fixing connectivity.
- Check `attempts`, `available_at`, `lease_until`, `last_error`, backlog and redaction failures. Expired leases can be reclaimed; a publish completed before process death but not acknowledged in Postgres can be delivered again, so consumers must deduplicate on `eventId`.
- Do not remove pending Outbox rows to clear an alert. Confirm backlog drains and oldest age returns to normal before enabling Writer again.

### Application rollback

- Turn `ORBIT_AGENT_ISSUE_WRITE` off first. Keep `ORBIT_AGENT_IDENTITY_READ` on for compatible settings and existing Actor visibility. Keep `ORBIT_ISSUE_OUTBOX_DISPATCH` and the Worker on while pending events need delivery. Keep Consent on only if new or reconnecting grants should remain supported.
- Continue using a binary that understands Agent Actor rows and the additive schema. Do not roll back to a binary that cannot read Agent actors.
- Do not run a Down migration that deletes Agent history. Keep the additive schema and use a forward fix. Human issue operations must remain available with Agent Writer disabled.

## Production release choices still required

Before a production change, select the persistent Worker hosting platform,
production Postgres and Redis endpoints, secret store/config owners, backup/PITR
procedure and release window, resource limits and alert destination. Confirm the
public Web URL, OAuth configuration and storage provider. Repository tests do
not authorize a production migration or deployment.

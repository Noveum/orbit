# Actor schema compatibility phase

This expansion starts from main `0a24d57c8ddda1fef449d73f29e85276dbdc1eba`.
The official migration chain contains 0000 through 0029. Migration
`0030_actor_schema_expand` was generated against that chain. Existing migrations
and snapshots remain unchanged. Regenerate this migration if another schema
change lands first.

## Storage contract

Issue adds five nullable columns: `creator_user_id`, `creator_agent_id`,
`assignee_user_id`, `assignee_agent_id`, and `owner_user_id`. The Drizzle names
are their camelCase equivalents. Existing `creator_id`, `assignee_id`, their
foreign keys, and all application write paths remain intact.

`agent_identity` contains `id`, `organization_id`, `owner_user_id`, `client_id`,
`name`, `avatar`, `deleted_at`, `owner_name_snapshot`, `client_name_snapshot`,
`created_at`, and `updated_at`. Actor display needs the ID, name, avatar and
deleted timestamp. The other fields retain workspace, Human and OAuth client
identity plus historical names for later readers. No identity is created by
this migration or by application code in this phase.

Identity owner and client references are nullable with SET NULL. Snapshots are
required for future identity inserts. This preserves deletion of a User or
OAuth application without introducing a new restriction. Organization deletion
cascades. All five new Issue foreign keys use SET NULL. The legacy Creator
foreign key still restricts deletion as it did before.

## Legacy write protection

The migration installs `sync_issue_human_actors()` and
`issue_human_actor_compat_trigger` before backfilling Issue rows. They execute
inside the migration transaction, so an old deployment never sees the columns
without the protection. The trigger handles INSERT and UPDATE OF `creator_id`,
`assignee_id` only.

- INSERT mirrors the Human Creator and Assignee, clears their Agent columns,
  and initializes an empty Owner from the Assignee.
- Changing the legacy Creator mirrors its Human ID and clears its Agent ID.
- Changing or clearing the legacy Assignee mirrors its Human ID and clears its
  Agent ID. A non-null assignment initializes an empty Owner.
- Reassignment and clearing the Assignee preserve an existing Owner.
- Unrelated updates and FK-driven Owner clearing do not initialize an Owner.

This covers service create, update, bulk and sub-issue writes, workspace starter
content, member removal, imports and seeds. Human legacy columns are the write
authority during this phase. The trigger does not enable Agent writes.

Historical Human rows mirror the legacy IDs and initialize a missing Owner from
the current Assignee. Replaying the backfill preserves existing Owners. It does
not modify business timestamps, Sync IDs or the Sync sequence, and produces no
Activity, notifications or realtime events. No Grant, Token or Consent row is
changed, and `mcp_grant_client_user_unique` stays available for consent upsert.

## Release and baseline

Run `DIRECT_URL=... bun run db:release` before merging the schema code.
Ordinary upgrades apply the SQL migration under the existing release lock.
When tables already match the declared schema but the ledger needs baselining,
release installs the migration's function and trigger and replays its original
backfill SQL before recording completion. It does not baseline those artifacts
away. Repeated releases verify the trigger's table, function, enabled state,
events and legacy update columns, repairing a missing or disabled trigger.
They do not rerun the historical Owner backfill for a completed migration.

`db:push` does not install SQL functions or triggers. Compatibility acceptance
therefore uses a dedicated test database upgraded from the official old chain,
never a push-only database. The existing general test setup remains unchanged.
Existing incomplete legacy databases still require their existing catchup
scripts before baselining; this phase adds no generic catchup redesign.

## Verification and follow-up

`packages/db/tests/migrations/actor-schema-expand.test.ts` applies the old
migrations and ledger, seeds historical data, runs release and exercises
legacy SQL writes and deletes. Its isolated child script invokes unchanged
main Core services for new workspace starter content, Issue creation and
assignment changes, Grant upsert and MCP token validation. Release tests cover
empty installation, missing and partial ledgers, artifact repair and repeats.

The next reader phase should expose `creator`, `assignee` and `owner` from the
new columns, retain legacy Human IDs, and use `deleted_at` for Agent tombstones.
Issue Owner and identity Owner are separate relationships. The current client
Issue parser and its detail, list and board consumers need a coordinated update
to preserve the complete Actor contract; that change belongs to the reader PR.

Before enabling Agent writes, define mixed-deployment synchronization, stop
requiring legacy Human Creator IDs for Agent-created Issues, and establish
tenant and Actor constraints. Tightening deletion semantics needs its own
decision: SET NULL can lose a deleted Human's Owner association in this phase.
Remove the compatibility trigger and its release reconciliation only after all
deployed writers use the agreed new fields, backfill validation passes, and the
contract migration can safely replace the old columns. Grant binding and
credential retirement, Outbox and idempotency remain separate changes.

# Agent identity migration compatibility

The Agent schema is appended as migration `0030_green_shaman.sql` after the
official upstream migration history through `0029_material_psynapse`. Upstream
SQL files, journal entries, timestamps and snapshots through migration 0029 are
preserved verbatim. The merged migration contains the final schema changes and
the data and lifecycle SQL that Drizzle cannot generate from the schema alone.

## Supported starting points

The release runner supports a database whose Drizzle ledger is an exact,
contiguous prefix of the committed upstream migration history. It applies the
official pending suffix first, then migration 0030. That migration batches the
Human issue actor, owner, and historical principal backfills; preserves deleted
Human attribution without requiring a live User row; freezes Grants without a
valid Agent binding; removes their OAuth access tokens; and installs the Agent
identity and Grant lifecycle guards. Grant, Consent, Issue, Activity,
Notification, audit, and subscription history remains stored. The migration
does not create synthetic Activity, Notification, or Outbox rows.

The old #215 development migration lineage is not an upgrade starting point.
Its duplicate 0017–0029 timestamps and hashes are not aliases for upstream
migrations. The runner rejects those ledger rows as an invalid prefix and does
not rewrite, renumber, or repair the ledger. Do not edit an existing ledger to
make it resemble the new history. Start acceptance from a fresh database or a
database carrying an exact upstream ledger prefix.

Unknown timestamps, changed hashes, gaps, and ledgers ahead of the committed
journal fail closed. A complete catalog with an empty ledger is not enough to
reconcile migration 0030's data changes; the release runner refuses to invent
that history. Use the release command rather than `db:push` as migration
evidence.

## Retry and catch-up behavior

Migration 0030 records its exact source hash in the resumable progress table
before running bounded backfill batches. Each batch commits independently. If a
batch fails, preserve the database and both ledger tables, fix the underlying
cause, and retry the same candidate with `bun run db:release`. Do not edit
either ledger table by hand. Final constraints, Grant cleanup, lifecycle
functions, triggers, and the migration ledger row commit together.

The repeatable `agent-actors.sql` catch-up runs inside one transaction and is
safe to rerun. Compatible foreign keys and lifecycle triggers remain in place.
Legacy credentials are intentionally invalidated; their Grant and Consent
history is retained. Feature gates remain off unless explicitly enabled.

## Verification

`packages/db/tests/migration-release.test.ts` and
`packages/db/tests/migrations/agent-actor.test.ts` cover a fresh database, an
official upstream ledger prefix with representative legacy data, bounded batch
retry, migration preparation rollback, exact ledger and hash rejection,
credential invalidation, historical attribution, repeated release and
catch-up, and catalog drift.

Run schema-changing commands against a disposable database. After a successful
release, repeat the release and catch-up, then run `bun run db:check-drift`.

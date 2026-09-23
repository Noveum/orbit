# Agent identity migration compatibility

Phase 2 adds forward migrations after `0021_agent_identity_lifecycle_operators`.
Previously committed SQL, snapshots, journal timestamps and migration hashes stay
unchanged. Existing ledger rows are not replaced, renumbered or supplemented with
backdated compatibility records.

## Historical dependency order

`0019_lyrical_pet_avengers.sql` declares the composite Grant foreign key before
the unique index that PostgreSQL requires for that key. A new database cannot
execute those two statements in source order.

The release runner recognizes only that migration's exact timestamp and SHA-256
hash. When it is pending, the runner executes its unique index before its foreign
key, then records the original timestamp and hash. It does not alter the SQL file
or an existing ledger entry. A changed source hash is rejected. All pending
statements and their ledger records share a transaction, including this ordering
compatibility. An error rolls them back together.

`0017_panoramic_gravity.sql` also predates support for deleted Human principals.
After its original attribution backfill, and before its foreign keys are installed,
the runner clears only principal IDs whose User no longer exists. Actor IDs and
all historical names remain unchanged. This compatibility applies only to the
exact original migration hash; it does not rewrite the migration or its ledger.

Both `bun run db:migrate` and `bun run db:release` use this runner. Directly running
`drizzle-kit migrate` bypasses the historical ordering compatibility and is not a
supported entry point for this migration chain.

## Forward changes and catch-up

The new migrations add missing lifecycle records and strengthen binding guards.
Where an existing invariant conflicts with the required model, its replacement
is transactional and preserves business history:

- The old Client/User uniqueness rule is replaced with one active Grant per
  Identity. Revoked Grant history remains stored.
- User deletion clears historical nullable user references rather than deleting
  Identity or Grant history. Client deletion cannot cascade through that history.
- The active-binding CHECK freezes unbound Grants with the stable
  `agent_identity_required` reason, explicitly rejecting a null reason.
- The assignment history index covers both legacy `assigneeId` and canonical
  `assignee` activity fields.

The repeatable `agent-actors.sql` catch-up runs inside one transaction. Compatible
foreign keys and lifecycle triggers are retained on repeated executions. Legacy
credentials are intentionally invalidated; this does not delete their Grant or
Consent history. Feature gates remain off unless explicitly enabled.

## Verification

`packages/db/tests/migration-release.test.ts` covers an original 22-record ledger,
an injected failure during the forward upgrade, unchanged historical ledger and
Consent rows, credential invalidation, and a successful retry. Migration and
catalog tests also cover fresh databases, no-ledger legacy data, interrupted
batched catch-up, repeated catch-up and drift.

Run schema-changing commands against a disposable database first. After successful
release, repeat the release and catch-up, then run `bun run db:check-drift`.

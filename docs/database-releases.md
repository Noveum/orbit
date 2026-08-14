# Database releases

Development databases use `bun run db:push`. Production databases use ordered,
immutable migrations through `bun run db:release`.

## Before merging a schema change

1. Generate and commit the Drizzle migration and metadata.
2. Back up the target database according to the provider's recovery procedure.
3. Run the release through a direct or session-mode connection:

```bash
DIRECT_URL="postgres://..." bun run db:release
DATABASE_URL="postgres://..." bun run db:check-drift
```

4. Record the result in the pull request before merging.

The release command takes one PostgreSQL advisory lock and fails promptly when
another release already owns it. It verifies that every
applied migration has the same timestamp and SHA-256 hash as the committed file,
applies pending migrations transactionally, and checks the resulting catalog.

The catalog check covers required tables, columns, PostgreSQL types, nullability,
database defaults, generated columns, primary keys, index definitions, foreign-key
targets and delete actions, and enum values. Additional tables, indexes and foreign
keys are reported but preserved.

## Existing databases without a ledger

When the public catalog already contains Orbit tables but the Drizzle ledger is
absent, the release command first requires the full catalog check to pass. Before
recording migration hashes, it transactionally reconciles each recognized
historical data migration. Attachment expiry values are restored to the exact
historical result derived from the original creation timestamp, while cycle numbering must already match the
historical deterministic backfill. A data migration without an explicit legacy
reconciliation makes the release fail closed. A partial catalog or an unsafe data
invariant is refused and must be brought forward with the applicable scripts in
`packages/db/catchup` before retrying.

The same reconciliation applies when the ledger is a valid prefix but the live
catalog already contains the complete pending schema. This supports upgrades
that previously materialized schema through an approved catchup without
replaying destructive or conflicting DDL. The release records only the verified
missing ledger suffix. A partial pending schema is migrated normally or refused
if its catalog is incompatible.

## Deployment guard

Every production Vercel build checks the configured production database before the
application build. Missing credentials, an unreachable database or required drift
fails the deployment. This guard never applies migrations during a build.

## Rollback

Do not rewrite or delete an applied migration. Roll application code back while
leaving compatible additive schema in place. If the database itself needs repair,
restore through the provider's point-in-time recovery or ship a new forward
migration. Destructive migrations require their own backup, restore rehearsal and
explicit rollout plan.

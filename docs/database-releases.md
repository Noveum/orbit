# Database releases

Development databases use `bun run db:push`. Production databases use ordered,
immutable migrations through `bun run db:release`.

`db:push` is not a substitute for a migration when a change adds a constraint to a
table that already exists. `drizzle-kit push` does not diff check constraints on
existing tables, so the constraint is silently never added, while a fresh database
built from the same schema does have it. Generate and release a migration for
constraint changes, and run `db:check-drift` to confirm the catalog really has them.

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
targets and delete actions, enum values, and check constraints. Additional tables,
indexes, foreign keys and check constraints are reported but preserved.

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

## Notification history backfill

Keep `NOTIFICATION_PROVIDERS_PAUSED=true` and
`NOTIFICATION_CONVERSATIONS_ENABLED=false` on the deployed application while
backfilling historical notifications. Schema migration alone does not complete
this rollout.

With `DATABASE_URL` loaded securely for the intended database, run:

```bash
bun run notifications:conversations-backfill --all --batch-size=100 --source-concurrency=4
bun run notifications:conversations-verify --all
```

Source concurrency defaults to one and accepts integers from one through eight.
It bounds independent source resolution and classification work, not the number
of organizations. Start conservatively and account for the database connection
pool and live application traffic. Equivalence groups stay intact, overlapping
groups are refused, and checkpoints advance only after every started operation
in the batch settles successfully. The remaining phases keep their existing
ordering.

Run only one backfill process per organization. After an interrupted process has
stopped, rerun the same command to resume saved progress; do not erase checkpoints
or delivery history. Require the verifier to return `ok: true` with zero drift
before enabling conversation reads and resuming provider delivery. Environment
flag changes require a new deployment before they affect running functions.

## History retention

The authenticated `/api/cron/prune` job runs hourly in Vercel and through the
Docker maintenance scheduler. Operational pruning runs before history cleanup,
so a large history backlog cannot prevent webhook and telemetry retention.
Deliveries released by history cleanup become eligible on the next hourly run.

| History | Retention |
| --- | --- |
| GitHub check activity | Seven days, retaining evidence referenced by current check state or pending reconciliation |
| Obsolete GitHub check contexts | Thirty days, retaining open pull request heads and pending or processing reconciliation |
| Document versions | At most five snapshots per document and thirty days, always retaining the newest snapshot |
| Processed or ignored webhook deliveries | Thirty days, retaining check provenance and quarantined deliveries |
| Web vitals | Ninety days |

Expired GitHub audit links are detached from PR timeline entries without deleting
their visible content. Live document contents are stored separately from version
history and are never changed by retention. Pending, processing and failed
webhook deliveries remain available for retries.

History cleanup has a two-minute work budget and twenty-second statement limits.
GitHub cleanup takes the same repository lock as event ingestion and processes
at most ten repository batches per invocation, each containing up to 1,000 audit
rows and 100 obsolete contexts. A persisted `history_pruned_at` timestamp orders
repositories by their last visit, so incomplete repositories resume fairly on
later runs. Attempt timestamps are committed before cleanup, so a statement
timeout cannot roll them back and repeatedly starve later repositories. Busy
repositories are skipped, and expected timeouts are logged and reported as
deferred work. Document work receives at most thirty seconds of the total budget.
Document pruning handles at most 100 documents and 1,000 versions per document
per invocation, locking each document before ranking its snapshots. Busy
documents are skipped, and remaining eligible versions resume on a later run.

PostgreSQL reuses space reclaimed by ordinary vacuuming. Bulk incident cleanup
may additionally need a separately scheduled `VACUUM FULL` to reduce disk usage;
that operation takes an exclusive table lock and needs room for the rewritten
table. Do not use `TRUNCATE CASCADE` on GitHub audit tables, because it can remove
PR timeline and current check state through their foreign keys.

## Rollback

Do not rewrite or delete an applied migration. Roll application code back while
leaving compatible additive schema in place. If the database itself needs repair,
restore through the provider's point-in-time recovery or ship a new forward
migration. Destructive migrations require their own backup, restore rehearsal and
explicit rollout plan.

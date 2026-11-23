# Failed database migration recovery runbook

This runbook covers diagnosing, clearing, and repairing an interrupted or failed
schema migration during an Orbit release upgrade.

## Triage and symptoms

- `bun run db:release` fails with `Advisory lock is currently held` or SQL statement error
- `bun run db:check-drift` reports catalog differences between declared schema and live tables
- A production build with `ORBIT_REQUIRE_SCHEMA_GUARD=1`, such as the Cloudflare Workers Builds production build, fails at the database schema guard

## Step 1: Check advisory locks and running processes

Orbit takes an advisory lock during migrations (`releaseDatabase`) to ensure single-worker
safety. If a migration process was terminated abruptly (e.g. killed by an out-of-memory event),
a surviving backend can retain the session lock. A closed backend releases it automatically.

Inspect active PostgreSQL locks:

```sql
SELECT
  l.pid,
  d.datname AS database_name,
  ((l.classid::bigint << 32) | (l.objid::bigint & 4294967295)) AS lock_id,
  l.granted,
  a.usename,
  a.query_start,
  a.state,
  a.query
FROM pg_locks l
JOIN pg_stat_activity a ON l.pid = a.pid
LEFT JOIN pg_database d ON l.database = d.oid
WHERE l.locktype = 'advisory';
```

Verify that `database_name` matches your target database and match `lock_id` against Orbit's migration release lock key `4611358438132153` (`releaseDatabase`) before terminating any PID.

If an orphaned process is confirmed holding the lock, terminate it:

```sql
SELECT pg_terminate_backend(<pid>);
```

## Step 2: Inspect the migration ledger

Examine applied migrations in `drizzle.__drizzle_migrations`:

```sql
SELECT id, hash, created_at
FROM drizzle.__drizzle_migrations
ORDER BY created_at DESC
LIMIT 5;
```

Compare the ledger rows with committed files in `packages/db/drizzle/`:
1. Does the latest applied row match the expected migration timestamp?
2. Did the transaction fail mid-statement? (PostgreSQL rolls back DDL within failed transactions).

## Step 3: Run forward-repair with `db:release`

Use the exact committed release and a direct connection from the reviewed operator
environment. Do not assume arbitrary partially applied DDL is safe to repeat:

```bash
bun --env-file=/etc/orbit/recovery.env run db:release
```

What `db:release` does during recovery:
1. Reads the journal to locate ordered SQL migrations and their timestamps; hashes are computed from the SQL file contents, not stored in the journal.
2. Validates the applied ledger against those migrations and the explicitly supported compatibility baselines.
3. Applies pending migrations under the release lock and runs narrowly scoped reconciliation for known historical contracts. It is not a general repair tool for arbitrary missing ledger rows or partial schemas.
4. Checks the declared catalog for missing or incompatible schema. Review the actual report, including compatible extra artifacts; a zero exit does not prove an exact empty-drift result.

## Step 4: Verify zero catalog drift

Run `db:check-drift` to confirm the live database matches the codebase:

```bash
bun --env-file=/etc/orbit/recovery.env run db:check-drift
```

Ensure the command exits 0 and reports no missing or altered columns.

## Important rules

- **Never delete rows from `drizzle.__drizzle_migrations` manually.**
- **Never modify applied migration files.** If an applied migration introduced an unwanted column or index, write a new forward migration to adjust it.

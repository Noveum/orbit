# Accidental deletion recovery runbook

This runbook covers recovering accidentally deleted workspaces, projects, documents,
or user accounts where point-in-time recovery is required.

## Recovery strategy

Orbit supports cascade deletion of organizations, teams, and issues. When an organization
or project is deleted by an operator or user, the durable records are purged from PostgreSQL.
To recover deleted entities without rolling back unrelated live data across other workspaces:

1. Restore the newest backup prior to the deletion event into a staging database.
2. Selectively export the deleted entity subtree from staging.
3. Import the subtree back into the production database.

## Step 1: Restore backup to an isolated staging database

Provision a separate recovery database and restore the backup taken before the incident:

```bash
# Create staging database
createdb -h localhost -p 5432 -U orbit orbit_recovery_staging

# Restore backup snapshot into staging:
bun run backup:restore /var/backups/orbit/orbit-backup-2026-09-20T... \
  --database-url="postgres://orbit:password@localhost:5432/orbit_recovery_staging" \
  --confirm-destructive-restore-target="localhost:5432/db/orbit_recovery_staging#bucket:$S3_BUCKET" \
  --encryption-key-file=/etc/orbit/master.key \
  --skip-object-restore \
  --json
```

## Step 2: Identify the deleted entity ID

Query the staging database to confirm the deleted records:

```sql
-- Locate the deleted workspace by slug or name:
SELECT id, name, slug, created_at
FROM public.organization
WHERE slug = 'targeted-workspace';
```

Record the `organization_id` (e.g. `org_12345`).

## Step 3: Export the entity subtree

Export the organization, its members, teams, projects, issues, comments, and docs:

```bash
export ORG_ID="org_12345"

# Export workspace data to SQL script using pg_dump with data-only predicates:
psql -h localhost -U orbit -d orbit_recovery_staging -c "
  COPY (SELECT * FROM public.organization WHERE id = '$ORG_ID') TO '/tmp/org.csv' CSV HEADER;
  COPY (SELECT * FROM public.member WHERE organization_id = '$ORG_ID') TO '/tmp/members.csv' CSV HEADER;
  COPY (SELECT * FROM public.team WHERE organization_id = '$ORG_ID') TO '/tmp/teams.csv' CSV HEADER;
  COPY (SELECT * FROM public.project WHERE organization_id = '$ORG_ID') TO '/tmp/projects.csv' CSV HEADER;
  COPY (SELECT * FROM public.issue WHERE organization_id = '$ORG_ID') TO '/tmp/issues.csv' CSV HEADER;
  COPY (SELECT * FROM public.doc WHERE organization_id = '$ORG_ID') TO '/tmp/docs.csv' CSV HEADER;
  COPY (SELECT * FROM public.attachment WHERE organization_id = '$ORG_ID') TO '/tmp/attachments.csv' CSV HEADER;
"
```

## Step 4: Re-insert into production inside a transaction

Connect to the live database and load the exported data:

```sql
BEGIN;

\copy public.organization FROM '/tmp/org.csv' CSV HEADER;
\copy public.member FROM '/tmp/members.csv' CSV HEADER;
\copy public.team FROM '/tmp/teams.csv' CSV HEADER;
\copy public.project FROM '/tmp/projects.csv' CSV HEADER;
\copy public.issue FROM '/tmp/issues.csv' CSV HEADER;
\copy public.doc FROM '/tmp/docs.csv' CSV HEADER;
\copy public.attachment FROM '/tmp/attachments.csv' CSV HEADER;

COMMIT;
```

## Step 5: Verify referential integrity

Run the validator against the production database:

```bash
bun run backup:validate --json
```

Verify that all referential integrity checks pass with 0 errors.

## Step 6: Cleanup staging resources

Drop the temporary recovery database:

```bash
dropdb -h localhost -p 5432 -U orbit orbit_recovery_staging
rm -f /tmp/*.csv
```

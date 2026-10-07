# Validation failure after restore runbook

This runbook guides operators through diagnosing and resolving validation failures
reported by `bun run backup:restore` or `bun run backup:validate`.

## Understanding the recovery gate

When a restore is executed or validation fails, Orbit creates or updates the
`public.orbit_recovery_state` table with `status = 'validation_failed'` and records
the specific error. While in this state, the `/api/health` endpoint responds with
HTTP 503 Service Unavailable, preventing traffic from reaching an unready deployment.

## Step 1: Inspect machine-readable validation output

Run `bun run backup:validate --json` to inspect the structured report:

```bash
bun run backup:validate --json | jq .
```

The report categorizes failures into specific subsystems:

```json
{
  "status": "invalid",
  "validation": {
    "valid": false,
    "ledgerCheck": { "ledgerCount": 35, "errors": [] },
    "catalogCheck": { "behind": false, "errors": [] },
    "referentialIntegrity": { "referentialIntegrityPassed": false, "errors": ["Found 1 dangling member row(s) missing organization or user."] },
    "bootstrapCheck": { "bootstrapWindowClosed": true, "errors": [] },
    "storageCheck": { "checkedObjects": 42, "missingObjects": 2, "sizeMismatches": 0, "errors": ["Object org_1/issue/123/file.pdf does not exist in storage driver."] },
    "redisCheck": { "reachable": true, "empty": true, "errors": [] },
    "errors": [ ... ]
  }
}
```

## Step 2: Resolve specific validation failure categories

### Category A: Migration ledger or catalog drift failure

**Symptom:** `ledgerCheck` or `catalogCheck` reports database schema behind or hash mismatch.

**Resolution:**
1. If the database ledger is behind committed migrations, apply pending migrations:

```bash
bun run db:release
```

2. Confirm with `bun run db:check-drift` that catalog differences are resolved.

### Category B: Storage object missing or size mismatch

**Symptom:** `storageCheck` reports missing objects or size mismatches.

**Resolution:**
1. Check S3 bucket credentials and endpoint connectivity:

```bash
aws s3 ls "s3://$S3_BUCKET/"
```

2. If objects were missing from the backup archive itself, re-run restore without skipping objects,
   or inspect the specific attachment rows in PostgreSQL:

```sql
SELECT id, storage_key, file_name, size, created_at
FROM public.attachment
WHERE storage_key IN ('missing_key_1', 'missing_key_2');
```

3. If missing attachments belong to deleted or orphan test issues, clean up dangling attachment rows:

```sql
DELETE FROM public.attachment WHERE id = 'orphan_id';
```

### Category C: Referential integrity dangling rows

**Symptom:** `referentialIntegrity` reports dangling foreign keys.

**Resolution:**
Inspect the dangling rows indicated in `errors`:

```sql
-- Find dangling members missing an organization:
SELECT m.id, m.organization_id, m.user_id
FROM public.member m
LEFT JOIN public.organization o ON m.organization_id = o.id
WHERE o.id IS NULL;
```

Remediate by restoring the missing parent record or pruning orphaned child rows within a transaction.

### Category D: Redis connectivity or dirty state

**Symptom:** `redisCheck` reports Redis unreachable or unexpected keys.

**Resolution:**
1. Confirm Redis is reachable using `redis-cli -u "$REDIS_URL" ping`.
2. Ensure Redis starts empty. Flush disposable cache if appropriate:

```bash
redis-cli -u "$REDIS_URL" flushdb
```

## Step 3: Re-run validator and clear recovery gate

Once the underlying issue is resolved, re-run the validator:

```bash
bun run backup:validate --json
```

When validation returns `valid: true`, Orbit updates `public.orbit_recovery_state` to
`status = 'ready'`.

Verify that the health check responds with HTTP 200:

```bash
curl -i http://localhost:3000/api/health
```

Expected response:
```
HTTP/1.1 200 OK
Content-Type: application/json

{"status":"ok","service":"web"}
```

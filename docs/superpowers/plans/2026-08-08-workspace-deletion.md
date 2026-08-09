# Workspace Deletion Implementation Plan

**Goal:** Add an administrator-only, permanent workspace deletion flow that previews categorized impact, removes every tenant-owned database row and stored object, and safely recovers every open client.

**Architecture:** A tenant-scoped core service owns preview and deletion. It serializes uploads against deletion with a PostgreSQL organization row lock, commits a durable deletion request that locks normal access, performs exact-prefix object cleanup without holding a database transaction open, and finishes with a short cascaded-delete transaction. A current-workspace API exposes the retryable service, a realtime control event closes affected sockets, and an accessible General settings danger-zone dialog requires the exact workspace name.

**Tech Stack:** Bun 1.3+, TypeScript 5.9, Next.js App Router, React 19, Drizzle ORM, PostgreSQL, AWS SDK v3 S3, Redis, Radix Dialog, Zod 4, Testing Library, `bun:test`.

## Global Constraints

- Run every package command through Bun. Do not use npm, pnpm, yarn, or turbo.
- Shipped server code runs on Node and must not import Bun built-ins.
- Add no code comments and no em dash characters.
- Keep strict TypeScript compatibility with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.
- Parse external input with a shared Zod validator.
- Put tests in each package's `tests/` tree and import from `bun:test`.
- Enforce `org:delete` through `packages/shared/src/policy` and again inside the core service.
- Never accept an organization id, slug, or storage prefix from the deletion API caller.
- A successful deletion must leave the exact organization storage prefix empty and every direct organization foreign key must cascade.
- Do not delete user, account, passkey, avatar, or data in another workspace.

## File Structure

- `packages/shared/src/policy/index.ts`: define administrator-only `org:delete` authorization.
- `packages/shared/src/validators/organization.ts`: parse exact-name deletion confirmation.
- `packages/shared/src/events/control.ts`: validate session and organization control messages.
- `packages/db/src/schema/content.ts`: persist presigned upload expiration.
- `packages/db/src/schema/org.ts`: persist the durable deletion request timestamp.
- `packages/db/drizzle/0002_glossy_mister_sinister.sql` and metadata: migrate and conservatively backfill upload expiration.
- `packages/db/tests/schema/index.test.ts`: assert the attachment field at the schema layer.
- `packages/db/tests/schema/organization-cascade.test.ts`: inspect PostgreSQL foreign keys to prevent non-cascading workspace records.
- `packages/services/src/storage/types.ts`: expose prefix summary and cleanup contracts.
- `packages/services/src/storage/key.ts`: derive and validate an exact organization prefix.
- `packages/services/src/storage/s3.ts`: paginate prefix summaries and batch deletion.
- `packages/services/tests/storage/storage-prefix.test.ts`: exercise pagination, batching, validation, and per-object failures with a controlled S3 client.
- `packages/core/src/org/organization-lock.ts`: centralize organization row locking for upload and deletion transactions.
- `packages/core/src/content/attachment-service.ts`: serialize presigned and inline upload registration, storing explicit expiration only for presigned targets.
- `packages/core/src/org/organization-deletion-service.ts`: calculate impact and perform storage plus database deletion.
- `packages/core/tests/content/attachment-service.test.ts`: prove upload expiration and locking behavior.
- `packages/core/tests/org/organization-deletion-service.test.ts`: prove tenant isolation, cleanup, rollback, upload guard, and next-workspace selection.
- `packages/core/src/realtime/publisher.ts`: publish organization deletion controls.
- `packages/realtime-server/src/hub.ts`: close only sockets connected to the deleted organization.
- `packages/realtime-server/tests/hub.test.ts`: verify organization control delivery.
- `apps/web/src/app/api/organizations/current/deletion/route.ts`: expose private no-cache preview and destructive delete endpoints.
- `apps/web/tests/app/api/organizations/current/deletion/route.test.ts`: verify endpoint behavior and post-commit publication.
- `apps/web/src/features/settings/workspace-danger-zone.tsx`: render the preview and exact-name confirmation dialog.
- `apps/web/src/app/(app)/settings/general/page.tsx`: render the danger zone only for authorized administrators.
- `apps/web/tests/features/settings/workspace-danger-zone.test.tsx`: verify dialog behavior, accessibility, errors, and navigation.
- `apps/web/src/lib/realtime/provider.tsx`: recover other tabs after the workspace-forbidden close code.
- `apps/web/tests/lib/realtime/provider.test.ts`: verify surviving-workspace and no-workspace recovery.

---

### Task 1: Shared authorization, validation, and control contracts

**Files:**
- Modify: `packages/shared/src/policy/index.ts`
- Modify: `packages/shared/src/validators/organization.ts`
- Modify: `packages/shared/src/events/control.ts`
- Modify: `packages/shared/tests/policy/policy.test.ts`
- Create: `packages/shared/tests/validators/organization.test.ts`
- Modify: `packages/shared/tests/events/control.test.ts`

**Interfaces:**
- Produces: `organizationDeleteSchema`, `OrganizationDeleteInput`, and `ControlMessage` variants `{ type: 'session_revoked'; userId: string } | { type: 'organization_deleted'; organizationId: string }`.

- [x] **Step 1: Write failing shared contract tests**

```ts
expect(can(principal('admin'), 'org:delete')).toBe(true);
expect(can(principal('member'), 'org:delete')).toBe(false);
expect(organizationDeleteSchema.parse({ confirmation: '  Nova  ' })).toEqual({
  confirmation: 'Nova',
});
expect(controlMessageSchema.parse({
  type: 'organization_deleted',
  organizationId: 'org_1',
})).toEqual({ type: 'organization_deleted', organizationId: 'org_1' });
```

- [x] **Step 2: Run the tests and confirm the new contracts fail**

Run: `bun --filter @orbit/shared test tests/policy/policy.test.ts tests/validators/organization.test.ts tests/events/control.test.ts`

Expected: FAIL because `org:delete`, `organizationDeleteSchema`, and the organization control variant do not exist.

- [x] **Step 3: Implement the shared contracts**

```ts
export const organizationDeleteSchema = z.object({
  confirmation: z.string().min(1).max(80).refine((value) => value === value.trim()),
});

export const controlMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('session_revoked'), userId: z.string().min(1) }),
  z.object({ type: z.literal('organization_deleted'), organizationId: z.string().min(1) }),
]);
```

Add `org:delete` to the permission tuple and the administrator permission set only.

- [x] **Step 4: Run the focused tests and commit**

Run: `bun --filter @orbit/shared test tests/policy/policy.test.ts tests/validators/organization.test.ts tests/events/control.test.ts`

Expected: PASS.

Commit: `feat(workspace): define deletion contracts`

### Task 2: Upload expiration schema and migration

**Files:**
- Modify: `packages/db/src/schema/content.ts`
- Modify: `packages/db/tests/schema/index.test.ts`
- Create: `packages/db/drizzle/0002_glossy_mister_sinister.sql`
- Modify: `packages/db/drizzle/meta/_journal.json`
- Create: `packages/db/drizzle/meta/0002_snapshot.json`

**Interfaces:**
- Produces: nullable `schema.attachment.uploadExpiresAt: Date | null` mapped to `upload_expires_at`.

- [x] **Step 1: Write the failing schema assertion**

```ts
expect(getTableColumns(schema.attachment).uploadExpiresAt?.name).toBe('upload_expires_at');
```

- [x] **Step 2: Run the schema test and confirm it fails**

Run: `bun --filter @orbit/db test tests/schema/index.test.ts`

Expected: FAIL because the attachment field does not exist.

- [x] **Step 3: Add the nullable timestamp and generate the migration**

```ts
uploadExpiresAt: timestamp('upload_expires_at', { withTimezone: true }).default(
  sql`now() + interval '900 seconds'`,
),
```

Run: `bun run db:generate`

Give the column the same 900-second database default to protect inserts from older instances during a rolling release, then append a conservative backfill to the generated SQL:

```sql
UPDATE "attachment"
SET "upload_expires_at" = "created_at" + interval '900 seconds';
```

- [x] **Step 4: Recreate lane schemas and run the database tests**

Run: `bun run db:test-setup`

Run: `bun --filter @orbit/db test tests/schema/index.test.ts`

Expected: PASS.

Commit: `feat(storage): track presigned upload expiry`

### Task 3: Exact storage-prefix summary and cleanup

**Files:**
- Modify: `packages/services/src/storage/types.ts`
- Modify: `packages/services/src/storage/key.ts`
- Modify: `packages/services/src/storage/index.ts`
- Modify: `packages/services/src/storage/s3.ts`
- Create: `packages/services/tests/storage/storage-prefix.test.ts`

**Interfaces:**
- Produces: `StoragePrefixSummary { objects: number; bytes: number; versions: number; versionBytes: number }`.
- Produces: `StorageDriver.summarizePrefix(prefix: string): Promise<StoragePrefixSummary>`.
- Produces: `StorageDriver.deletePrefix(prefix: string): Promise<void>`.
- Produces: `storagePrefixFor(organizationId: string): string` and `assertSafePrefix(prefix: string): string`.

- [x] **Step 1: Write failing prefix validation and summary tests**

```ts
expect(storagePrefixFor('org_1')).toBe('org_1/');
expect(() => assertSafePrefix('')).toThrow(DomainError);
expect(() => assertSafePrefix('../')).toThrow(DomainError);
expect(await driver.summarizePrefix('org_1/')).toEqual({
  objects: 3,
  bytes: 60,
  versions: 5,
  versionBytes: 90,
});
```

The controlled S3 client must return two `ListObjectsV2Command` pages so the test asserts the second request uses the first continuation token.

- [x] **Step 2: Run the prefix tests and confirm they fail**

Run: `bun --filter @orbit/services test tests/storage/storage-prefix.test.ts`

Expected: FAIL because prefix operations do not exist.

- [x] **Step 3: Implement validated pagination and batching**

```ts
export interface StoragePrefixSummary {
  readonly objects: number;
  readonly bytes: number;
  readonly versions: number;
  readonly versionBytes: number;
}

async summarizePrefix(prefix: string): Promise<StoragePrefixSummary>
async deletePrefix(prefix: string): Promise<void>
```

Use `ListObjectsV2Command` with `Prefix` and `ContinuationToken`. Sum each returned object's `Size`. Use `ListObjectVersionsCommand` to count and permanently remove historical versions and delete markers. Require both continuation markers from every truncated version page. Send `DeleteObjectsCommand` requests of no more than 1,000 exact returned keys and version ids, reject any response containing `Errors`, and repeat listing until empty pages prove the prefix and its version history are empty. Treat only a provider's explicit `NotImplemented` response as a versionless fallback.

- [x] **Step 4: Add deletion tests for all safety boundaries**

```ts
await driver.deletePrefix('org_1/');
expect(deletedKeys).toEqual(expectedKeys);
expect(deleteBatchSizes).toEqual([1000, 1]);
await expect(partialFailure()).rejects.toMatchObject({ code: 'internal' });
```

Cover empty prefixes, more than one list page, more than one delete batch, missing keys, malformed prefixes, historical versions, delete markers, a provider without the version API, and a per-object S3 error.

- [x] **Step 5: Run service tests and commit**

Run: `bun --filter @orbit/services test tests/storage/storage-prefix.test.ts tests/storage/storage.test.ts`

Expected: PASS.

Commit: `feat(storage): clean organization prefixes`

### Task 4: Serialize upload creation with workspace deletion

**Files:**
- Create: `packages/core/src/org/organization-lock.ts`
- Modify: `packages/core/src/content/attachment-service.ts`
- Modify: `packages/core/tests/content/attachment-service.test.ts`

**Interfaces:**
- Consumes: `schema.attachment.uploadExpiresAt` and `UploadTarget.expiresAt`.
- Produces: `lockOrganization(executor: Transaction, organizationId: string): Promise<OrganizationRow>`.
- Produces: presigned attachment rows with `uploadExpiresAt`; inline rows keep it null.

- [x] **Step 1: Write failing upload expiration tests**

```ts
expect(registered.attachment.uploadExpiresAt?.toISOString()).toBe(registered.upload.expiresAt);
expect(attached.attachment.uploadExpiresAt).toBeNull();
```

Also start a registration transaction behind a held organization row lock and assert the fake storage driver is not called until the lock is released.

- [x] **Step 2: Run the attachment tests and confirm they fail**

Run: `bun --filter @orbit/core test tests/content/attachment-service.test.ts`

Expected: FAIL because expiration is not stored and uploads do not lock the organization.

- [x] **Step 3: Implement one transaction per upload registration**

```ts
return await db.transaction(async (tx) => {
  await lockOrganization(tx, principal.organizationId);
  await assertUploadParent(tx, principal, parsed.parentType, parsed.parentId);
  const target = await store.createUploadTarget(key, upload.contentType, upload.size);
  const registered = await insertAttachment(tx, principal, {
    ...draft,
    uploadExpiresAt: new Date(target.expiresAt),
  });
  return { ...registered, upload: target };
});
```

Refactor `insertAttachment` to use the caller's transaction. Keep inline storage writes and row insertion under the same organization lock, retaining best-effort cleanup if insertion fails.

- [x] **Step 4: Run attachment and presign route tests and commit**

Run: `bun --filter @orbit/core test tests/content/attachment-service.test.ts`

Run from `apps/web`: `bun --env-file=../../.env test tests/app/api/attachments/presign/route.test.ts --timeout 20000`

Expected: PASS.

Commit: `fix(storage): serialize workspace uploads`

### Task 5: Tenant-scoped deletion summary and retryable cleanup

**Files:**
- Create: `packages/core/src/org/organization-deletion-service.ts`
- Modify: `packages/core/src/index.ts`
- Create: `packages/core/tests/org/organization-deletion-service.test.ts`
- Create: `packages/db/tests/schema/organization-cascade.test.ts`

**Interfaces:**
- Consumes: `StorageDriver.summarizePrefix`, `StorageDriver.deletePrefix`, `storagePrefixFor`, `organizationDeleteSchema`, and `lockOrganization`.
- Produces: `OrganizationDeletionSummary` with `organizationName`, `members`, `teams`, `projects`, `issues`, `documents`, `files`, `fileBytes`, version totals, `integrations`, `webhooks`, `availableAt`, and `deletionRequestedAt`.
- Produces: `getOrganizationDeletionSummary(principal, driver?)` and `deleteOrganization(principal, input, driver?)`.

- [x] **Step 1: Write failing summary and policy tests**

```ts
expect(summary).toMatchObject({
  organizationName: 'Nova',
  members: 2,
  teams: 1,
  projects: 1,
  issues: 2,
  documents: 1,
  files: 2,
  fileBytes: 3072,
});
await expect(getOrganizationDeletionSummary(member, storage)).rejects.toMatchObject({
  code: 'forbidden',
});
```

Seed a neighboring workspace and make its larger counts distinguishable, proving every query uses `principal.organizationId`.

- [x] **Step 2: Run the deletion service test and confirm it fails**

Run: `bun --filter @orbit/core test tests/org/organization-deletion-service.test.ts`

Expected: FAIL because the service does not exist.

- [x] **Step 3: Implement bounded aggregate summary queries**

Use one `count()` query per category with `eq(table.organizationId, principal.organizationId)`, a latest protected-upload query that adds the exported completion grace, a deletion-request drain that adds the URL lifetime and completion grace, and `driver.summarizePrefix(storagePrefixFor(principal.organizationId))`. Call `assertCan(principal, 'org:delete')` before database or storage access. Lock and recheck the current membership role inside the deletion transaction before touching storage.

- [x] **Step 4: Write failing destructive service tests**

```ts
await expect(deleteOrganization(admin, { confirmation: 'nova' }, storage)).rejects.toMatchObject({
  code: 'conflict',
});
const result = await deleteOrganization(admin, { confirmation: 'Nova' }, storage);
expect(result.nextOrganizationId).toBe(neighbor.organizationId);
expect(await organizationExists(workspace.organizationId)).toBe(false);
expect(await organizationExists(neighbor.organizationId)).toBe(true);
expect(await sessionExists(sessionId)).toBe(true);
expect(await activeOrganization(sessionId)).toBeNull();
```

Cover stale-name refusal, stale-administrator refusal, future upload refusal with `availableAt` details, tracked and untracked capability boundaries, durable retry after storage failure, final database statement and commit failures after storage cleanup, storage prefix selection, neighboring tenant preservation, shared-user preservation, and the null next-workspace result.

- [x] **Step 5: Implement durable two-phase cleanup and next-workspace selection**

```ts
await db.transaction(async (tx) => {
  const organization = await lockOrganization(tx, principal.organizationId);
  if (parsed.confirmation !== organization.name) throw conflict(nameMessage);
  if (organization.deletionRequestedAt === null) {
    await tx.update(schema.organization).set({ deletionRequestedAt: now })
      .where(eq(schema.organization.id, organization.id));
  }
});

const organizationId = await db.transaction(async (tx) => {
  const organization = await validatedDeletionTarget(tx, principal, parsed.confirmation);
  await assertDeletionReady(tx, organization, now);
  return organization.id;
});

await driver.deletePrefix(storagePrefixFor(organizationId));

return await db.transaction(async (tx) => {
  const organization = await validatedDeletionTarget(tx, principal, parsed.confirmation);
  await assertDeletionReady(tx, organization, now);
  await tx.update(schema.session).set({ activeOrganizationId: null })
    .where(eq(schema.session.activeOrganizationId, organization.id));
  await tx.delete(schema.organization).where(eq(schema.organization.id, organization.id));
  return deletionResult;
});
```

Choose the next membership by organization name and id, excluding the deleting organization and any other pending deletion. The committed timestamp survives storage and final-transaction failures, normal access rejects the pending workspace, and an administrator can safely retry idempotent prefix cleanup. The cleanup waits one full presigned URL lifetime plus completion grace after the timestamp, in addition to recorded attachment expiration guards. This covers a presigned target whose attachment insert or transaction commit failed. Return only ids and the deleted name.

- [x] **Step 6: Add the live PostgreSQL cascade regression test**

Query `pg_constraint`, `pg_class`, and `pg_attribute` for every public table carrying `organization_id`. Assert the inventory stays substantial and every column references `organization` with `confdeltype` equal to `c`. This automatically catches any future direct workspace column that lacks an `ON DELETE CASCADE` foreign key.

- [x] **Step 7: Run core and database tests and commit**

Run: `bun --filter @orbit/core test tests/org/organization-deletion-service.test.ts tests/content/attachment-service.test.ts`

Run: `bun --filter @orbit/db test tests/schema/index.test.ts tests/schema/organization-cascade.test.ts`

Expected: PASS.

Commit: `feat(workspace): delete tenant data safely`

### Task 6: API endpoint and realtime invalidation

**Files:**
- Modify: `packages/core/src/realtime/publisher.ts`
- Modify: `packages/core/tests/realtime/publisher.test.ts`
- Modify: `packages/realtime-server/src/hub.ts`
- Modify: `packages/realtime-server/tests/hub.test.ts`
- Create: `apps/web/src/app/api/organizations/current/deletion/route.ts`
- Create: `apps/web/tests/app/api/organizations/current/deletion/route.test.ts`

**Interfaces:**
- Consumes: core deletion functions and the `organization_deleted` control message.
- Produces: `publishOrganizationDeleted(organizationId: string): Promise<void>`.
- Produces: `GET` response `{ summary }` with `cache-control: private, no-cache`.
- Produces: `DELETE` response `{ deletedOrganizationId, nextOrganizationId }`.

- [x] **Step 1: Write failing publisher and hub tests**

```ts
await publishOrganizationDeleted(deletedId);
expect(deletedSocket.closures[0]).toEqual({
  code: ORGANIZATION_FORBIDDEN_CLOSE_CODE,
  reason: 'organization_deleted',
});
expect(otherSocket.closures).toHaveLength(0);
```

- [x] **Step 2: Run realtime tests and confirm they fail**

Run: `bun --filter @orbit/core test tests/realtime/publisher.test.ts`

Run: `bun --filter @orbit/realtime-server test tests/hub.test.ts`

Expected: FAIL because organization deletion controls are not published or delivered.

- [x] **Step 3: Implement control publication and targeted socket closure**

Branch `deliverControl` on the discriminated `type`. Keep session revalidation unchanged. For `organization_deleted`, remove and close every connection whose `organizationId` matches, using code `ORGANIZATION_FORBIDDEN_CLOSE_CODE` and reason `organization_deleted`.

- [x] **Step 4: Write failing route tests**

Test GET authentication, administrator authorization, summary payload, and private no-cache header. Test DELETE body validation, exact service result, successful post-commit publication, and successful response when publication rejects after the service has committed.

- [x] **Step 5: Implement the current-workspace deletion route**

```ts
export async function GET(): Promise<Response> {
  return await handleRoute(async () => {
    const { principal } = await apiContext();
    return Response.json(
      { summary: await getOrganizationDeletionSummary(principal) },
      { headers: { 'cache-control': 'private, no-cache' } },
    );
  });
}
```

The DELETE handler reads only `{ confirmation }`, calls the core deletion service, catches only the post-commit publication failure for logging, and returns the two organization ids.

- [x] **Step 6: Run route and realtime tests and commit**

Run: `bun --filter @orbit/core test tests/realtime/publisher.test.ts`

Run: `bun --filter @orbit/realtime-server test tests/hub.test.ts`

Run: `bun --filter @orbit/web test tests/app/api/organizations/current/deletion/route.test.ts`

Expected: PASS.

Commit: `feat(workspace): expose deletion endpoint`

### Task 7: Accessible deletion dialog and calling-tab navigation

**Files:**
- Create: `apps/web/src/features/settings/workspace-danger-zone.tsx`
- Modify: `apps/web/src/app/(app)/settings/general/page.tsx`
- Create: `apps/web/tests/features/settings/workspace-danger-zone.test.tsx`

**Interfaces:**
- Consumes: API responses from Task 6 and `authClient.organization.setActive`.
- Produces: `WorkspaceDangerZone({ organizationName }: { organizationName: string })`.
- Produces: `formatDeletionBytes(bytes: number): string` for deterministic file-size rendering.

- [x] **Step 1: Write failing dialog rendering and confirmation tests**

```tsx
render(<WorkspaceDangerZone organizationName="Nova" />);
await user.click(screen.getByRole('button', { name: 'Delete workspace' }));
expect(await screen.findByText('2 members')).toBeVisible();
expect(screen.getByText('3 files')).toBeVisible();
expect(screen.getByRole('button', { name: 'Permanently delete workspace' })).toBeDisabled();
await user.type(screen.getByLabelText('Type Nova to confirm'), 'Nova');
expect(screen.getByRole('button', { name: 'Permanently delete workspace' })).toBeEnabled();
```

- [x] **Step 2: Run the component test and confirm it fails**

Run: `bun --filter @orbit/web test tests/features/settings/workspace-danger-zone.test.tsx`

Expected: FAIL because the component does not exist.

- [x] **Step 3: Implement summary loading and accessible destructive state**

Use the shared `Dialog` primitives with a title, description, labelled input, alert error region, and `danger` button. Load a fresh summary on each open. Render all eight categories and the nested-data disclosure. Disable deletion during loading, before an exact case-sensitive name match, before `availableAt` on a pending deletion, and while the DELETE request is pending. The initial confirmation remains available so it can lock the workspace before upload capabilities drain. Keep the dialog open on an error and allow summary retry.

- [x] **Step 4: Add request and navigation tests**

Assert one DELETE request for repeated clicks. Assert `setActive({ organizationId: nextId })` and `/my-issues` for a surviving workspace. Assert `/workspaces/new` without calling `setActive` when `nextOrganizationId` is null. Assert a server conflict appears in the alert region and leaves the dialog open.

- [x] **Step 5: Render the danger zone only for administrators**

```tsx
{can(principal, 'org:delete') ? (
  <WorkspaceDangerZone organizationName={organization.name} />
) : null}
```

- [x] **Step 6: Run component tests and commit**

Run: `bun --filter @orbit/web test tests/features/settings/workspace-danger-zone.test.tsx`

Expected: PASS.

Commit: `feat(settings): add workspace danger zone`

### Task 8: Other-tab workspace recovery

**Files:**
- Modify: `apps/web/src/lib/realtime/provider.tsx`
- Modify: `apps/web/tests/lib/realtime/provider.test.ts`

**Interfaces:**
- Consumes: `ORGANIZATION_FORBIDDEN_CLOSE_CODE`, `GET /api/organizations`, and `authClient.organization.setActive`.
- Produces: `recoverWorkspaceAfterForbidden(gate?)` and an updated `handleTerminalClose`.

- [x] **Step 1: Write failing terminal recovery tests**

```ts
await recoverWorkspaceAfterForbidden(gateWith([{ id: 'org_2' }]));
expect(calls.active).toEqual(['org_2']);
expect(location.href).toBe('/my-issues');

await recoverWorkspaceAfterForbidden(gateWith([]));
expect(calls.active).toEqual([]);
expect(location.href).toBe('/workspaces/new');
```

Also assert ordinary transport closes and unauthorized closes do not start recovery, while session-revoked behavior stays unchanged.

- [x] **Step 2: Run provider tests and confirm they fail**

Run: `bun --filter @orbit/web test tests/lib/realtime/provider.test.ts`

Expected: FAIL because organization-forbidden recovery does not exist.

- [x] **Step 3: Implement fail-closed workspace recovery**

List workspaces through `apiRequest('/api/organizations')`. If a workspace exists, call `setActive` with the first returned id before full navigation to `/my-issues`. If the list is empty, navigate to `/workspaces/new`. If recovery itself fails, navigate to `/workspaces/new` so a deleted tenant cannot remain rendered.

- [x] **Step 4: Run provider tests and commit**

Run: `bun --filter @orbit/web test tests/lib/realtime/provider.test.ts`

Expected: PASS.

Commit: `fix(realtime): recover deleted workspaces`

### Task 9: Verification, pull request, two review loops, and merge

**Files:**
- Review: every file changed from `origin/main`.
- Update: pull request description and screenshots when practical.

**Interfaces:**
- Produces: a ready GitHub pull request whose CI is green and whose complete diff has passed two separate review-and-fix loops.

- [x] **Step 1: Run focused cross-package verification**

Run: `bun run lint`

Run: `bun run check-comments`

Run: `bun run check-bytes`

Run: `bun run typecheck`

Run each focused test command from Tasks 1 through 8.

Expected: every command exits zero.

- [x] **Step 2: Run the full repository verification**

Run: `ORBIT_TEST_LANE=workspace-deletion bun run verify`

Expected: lint, comment policy, byte limits, Bun import policy, dependency checks, types, and all tests pass.

- [x] **Step 3: Inspect the complete diff and commit the verification corrections**

Run: `git diff --check origin/main...HEAD`

Run: `rg -n "\\x{2014}|\\x{2013}|T.DO|F.XME|generated by|co-authored-by"` over changed text files.

Check authorization order, tenant predicates, row-lock order, S3 prefix validation, failure atomicity, accessible dialog behavior, and test strength. Commit any correction with a specific conventional subject.

- [x] **Step 4: Push and open a ready pull request**

Push `codex/feat-workspace-deletion`. Create a ready PR against `main` with the problem, safety model, deletion inventory, test evidence, migration behavior, storage failure behavior, and explicit note that third-party provider installations are not removed.

- [x] **Step 5: Complete review loop one and update the PR**

Read the entire GitHub PR diff and all CI output. Make a written problem list ordered by severity. Fix every confirmed problem one by one with tests, run affected package tests plus `bun run verify`, commit, push, and confirm the PR shows the new head.

- [ ] **Step 6: Complete review loop two independently and update the PR**

Re-read the entire updated PR from the base commit without relying on loop one's notes. Recheck security, data completeness, races, idempotency, errors, UX, accessibility, migration safety, types, and test blind spots. Make a second written problem list, fix every confirmed issue, run affected tests plus `bun run verify`, commit, and push.

- [ ] **Step 7: Confirm merge readiness and merge**

Wait for required GitHub checks and reviews. Confirm the PR is mergeable, the final head matches the locally verified commit, both review loops have no unresolved findings, and no review thread is unresolved. Merge using the repository's accepted method, then report the PR URL, merge commit, tests, review-loop findings and fixes, and confirmation that no production workspace was deleted by this work.

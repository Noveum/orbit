# Yodu Email Domain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow exact `@yodu.ai` addresses to join and receive invitations to the Noveum workspace while preserving its existing allowed domains.

**Architecture:** Centralize the Noveum workspace identity and organization insert values in one database-package module used by every seed and import path. Add an idempotent catchup script that appends `yodu.ai` only to the known Noveum organization records so existing databases receive the same policy without losing current values.

**Tech Stack:** TypeScript 5.9, Bun test, Drizzle ORM, postgres.js, PostgreSQL JSONB

## Global Constraints

- Match only the exact `yodu.ai` email domain. Do not allow subdomains.
- Keep `noveum.ai` allowed and preserve every existing workspace domain.
- Do not change the global `ALLOWED_EMAIL_DOMAINS` setting or the domain matcher.
- Use Bun for every repository command.
- Do not add comments or em dash characters to TypeScript source.
- Keep strict types and place tests under the package `tests/` tree.

---

### Task 1: Centralize the Noveum workspace defaults

**Files:**
- Create: `packages/db/src/noveum-workspace.ts`
- Create: `packages/db/tests/noveum-workspace.test.ts`
- Modify: `packages/db/src/seed/index.ts`
- Modify: `packages/db/src/import/index.ts`
- Modify: `packages/db/src/import/combined.ts`
- Modify: `packages/db/src/import/surgical.ts`

**Interfaces:**
- Produces: `NOVEUM_IMPORT_ORGANIZATION_ID`, `NOVEUM_SEED_ORGANIZATION_ID`, and `noveumOrganizationValues(id: string, createdAt: Date)`.
- Consumes: The existing Drizzle organization insert shape at each seed or import call site.

- [ ] **Step 1: Write the failing policy test**

```ts
import { describe, expect, it } from 'bun:test';
import {
  NOVEUM_IMPORT_ORGANIZATION_ID,
  NOVEUM_SEED_ORGANIZATION_ID,
  noveumOrganizationValues,
} from '../src/noveum-workspace.ts';

describe('noveumOrganizationValues', () => {
  it('allows the exact Noveum and Yodu email domains in every Noveum workspace', () => {
    const createdAt = new Date('2026-08-08T00:00:00.000Z');

    for (const id of [NOVEUM_IMPORT_ORGANIZATION_ID, NOVEUM_SEED_ORGANIZATION_ID]) {
      expect(noveumOrganizationValues(id, createdAt)).toEqual({
        id,
        name: 'Noveum',
        slug: 'noveum',
        logo: null,
        allowedEmailDomains: ['noveum.ai', 'yodu.ai'],
        createdAt,
      });
    }
  });
});
```

- [ ] **Step 2: Run the test and verify the missing policy fails**

Run: `bun run --filter '@orbit/db' test tests/noveum-workspace.test.ts`

Expected: FAIL because `packages/db/src/noveum-workspace.ts` does not exist.

- [ ] **Step 3: Implement the shared Noveum values**

```ts
export const NOVEUM_IMPORT_ORGANIZATION_ID = 'org_noveum';
export const NOVEUM_SEED_ORGANIZATION_ID = 'org_noveum_demo';

export function noveumOrganizationValues(id: string, createdAt: Date) {
  return {
    id,
    name: 'Noveum',
    slug: 'noveum',
    logo: null,
    allowedEmailDomains: ['noveum.ai', 'yodu.ai'],
    createdAt,
  };
}
```

- [ ] **Step 4: Route every Noveum creation path through the shared values**

Import the shared module into the seed, Plane import, combined import, and surgical import. Replace the duplicated organization ids and inline organization value objects with `NOVEUM_SEED_ORGANIZATION_ID`, `NOVEUM_IMPORT_ORGANIZATION_ID`, and `noveumOrganizationValues(...)` as appropriate.

- [ ] **Step 5: Run the focused test and package typecheck**

Run: `bun run --filter '@orbit/db' test tests/noveum-workspace.test.ts`

Expected: PASS.

Run: `bun run --filter '@orbit/db' typecheck`

Expected: exit 0 with no type errors.

- [ ] **Step 6: Commit the tested defaults**

```bash
git add packages/db/src/noveum-workspace.ts packages/db/tests/noveum-workspace.test.ts packages/db/src/seed/index.ts packages/db/src/import/index.ts packages/db/src/import/combined.ts packages/db/src/import/surgical.ts
git commit -m "feat(auth): allow yodu email domain"
```

### Task 2: Backfill existing Noveum workspaces

**Files:**
- Create: `packages/db/catchup/noveum-yodu-domain-catchup.sql`
- Modify: `packages/db/tests/apply-catchup.test.ts`

**Interfaces:**
- Consumes: `applyCatchup(url: string, named: string): Promise<void>`.
- Produces: An idempotent SQL operation that appends `yodu.ai` to `allowed_email_domains` for `org_noveum` and `org_noveum_demo` only.

- [ ] **Step 1: Extend the scratch schema and write the failing catchup test**

Add `allowed_email_domains jsonb not null default '[]'::jsonb` to the scratch `organization` table. Add a test that inserts both Noveum ids plus an unrelated organization, applies `noveum-yodu-domain-catchup.sql` twice, and asserts these literal results:

```ts
expect(byId.get('org_noveum')).toEqual(['noveum.ai', 'yodu.ai']);
expect(byId.get('org_noveum_demo')).toEqual(['noveum.ai', 'example.com', 'yodu.ai']);
expect(byId.get('org_other')).toEqual(['example.com']);
```

- [ ] **Step 2: Run the integration test and verify it fails**

Run: `bun run --filter '@orbit/db' test tests/apply-catchup.test.ts`

Expected: FAIL because `noveum-yodu-domain-catchup.sql` does not exist.

- [ ] **Step 3: Implement the idempotent catchup**

```sql
begin;

update public.organization
set allowed_email_domains = allowed_email_domains || '["yodu.ai"]'::jsonb
where id in ('org_noveum', 'org_noveum_demo')
  and not allowed_email_domains @> '["yodu.ai"]'::jsonb;

commit;
```

- [ ] **Step 4: Run the catchup test twice through its test case**

Run: `bun run --filter '@orbit/db' test tests/apply-catchup.test.ts`

Expected: PASS, including the second application and the unrelated organization assertion.

- [ ] **Step 5: Commit the tested catchup**

```bash
git add packages/db/catchup/noveum-yodu-domain-catchup.sql packages/db/tests/apply-catchup.test.ts
git commit -m "chore(db): backfill yodu email domain"
```

### Task 3: Apply, verify, publish, review, and merge

**Files:**
- Modify: none unless verification or review identifies a defect.

**Interfaces:**
- Consumes: `bun run db:catchup -- packages/db/catchup/noveum-yodu-domain-catchup.sql`, GitHub CLI, and repository review bots.
- Produces: A verified current workspace update and a merged pull request into `main`.

- [ ] **Step 1: Inspect the configured database target and current domain values**

Use a read-only query that prints only the database host/name and the Noveum organization ids, names, slugs, and `allowed_email_domains`. Do not print credentials.

- [ ] **Step 2: Apply the scoped catchup and read the values back**

Run: `bun run db:catchup -- packages/db/catchup/noveum-yodu-domain-catchup.sql`

Expected: only known Noveum rows gain one `yodu.ai` entry, and all previous entries remain.

- [ ] **Step 3: Run the full repository gate**

Run: `bun run verify`

Expected: lint, comment policy, source byte checks, Bun import checks, dependency checks, typecheck, and all tests pass.

- [ ] **Step 4: Commit the implementation plan if it is not already committed**

```bash
git add docs/superpowers/plans/2026-08-08-yodu-email-domain.md
git commit -m "docs(auth): plan yodu email domain access"
```

- [ ] **Step 5: Request an independent code review**

Review the range from `origin/main` to `HEAD` against this plan and the approved design. Resolve every Critical and Important finding before publishing.

- [ ] **Step 6: Push and open a ready pull request into `main`**

The PR description must summarize the shared defaults, the idempotent catchup, user impact, and `bun run verify` evidence.

- [ ] **Step 7: Wait for CI, Greptile, and CodeRabbit**

Address every actionable thread. Reply with technical reasoning before resolving any finding that does not apply. Re-run CodeRabbit if it reports rate limiting.

- [ ] **Step 8: Merge current `main` into the feature branch and reverify**

Fetch `origin/main`, merge it into `codex/allow-yodu-email-domain`, run `bun run verify`, push, and wait for the refreshed CI and reviews.

- [ ] **Step 9: Squash merge only when the PR is stable**

Merge only with green checks, completed reviews, no unresolved threads, and a mergeable state that is not `UNSTABLE`.

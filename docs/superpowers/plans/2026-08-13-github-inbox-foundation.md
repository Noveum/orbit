# GitHub Inbox Foundation Implementation Plan

**Goal:** Make linked pull request notifications useful and reliable by adding GitHub destinations, comment events, open pull request backfill, team-safe reads, and exclusive delivery claims.

**Architecture:** Preserve the existing issue-link automation model while strengthening its boundaries. GitHub webhooks and REST backfill share normalization and application code, notifications carry separate internal and external destinations, and authorization is enforced in database queries before data reaches realtime or UI consumers.

**Tech Stack:** Bun, TypeScript, Next.js, React, Drizzle ORM, PostgreSQL, Zod, bun:test

**Spec:** `docs/superpowers/specs/2026-08-13-github-inbox-foundation-design.md`

## Global Constraints

- Bun only.
- Shipped server code runs on Node and must not import a Bun built-in.
- No comments in code.
- No em dash characters.
- Strict types with no `any` or non-null assertions.
- Tests live in package `tests/` trees and import from `bun:test`.
- Authorization is enforced on the server through current principal and membership data.

---

### Task 1: Separate internal and GitHub notification destinations

**Files:**
- Modify: `packages/db/src/schema/comms.ts`
- Create: `packages/db/drizzle/0005_*.sql` through `bun run db:generate`
- Modify: `packages/services/src/notifications/index.ts`
- Modify: `packages/services/tests/notifications/notifications.test.ts`
- Modify: `apps/web/src/features/inbox/data.ts`
- Modify: `apps/web/src/features/inbox/inbox-view.tsx`
- Modify: `apps/web/tests/features/inbox/inbox-view.test.tsx`

**Interfaces:**
- Produces: `NotificationEvent.externalUrl?: string | null`
- Produces: `InboxItem.externalUrl: string | null`

- [ ] **Step 1: Write failing notification persistence and inbox rendering tests**

```ts
expect(outcome.notifications[0]?.externalUrl).toBe('https://github.com/acme/web/pull/7');
expect(screen.getByRole('link', { name: 'Open on GitHub' })).toHaveAttribute(
  'href',
  'https://github.com/acme/web/pull/7',
);
expect(screen.getByRole('link', { name: 'Open issue' })).toHaveAttribute('href', '/issue/ENG-3');
```

- [ ] **Step 2: Run the focused tests and confirm they fail because `externalUrl` is absent**

Run: `bun test packages/services/tests/notifications/notifications.test.ts apps/web/tests/features/inbox/inbox-view.test.tsx`

- [ ] **Step 3: Add the nullable column and carry it through storage, realtime data, pagination, and UI**

```ts
externalUrl: text('external_url'),
```

- [ ] **Step 4: Generate the migration and rerun the focused tests**

Run: `bun run db:generate`

Run: `bun run db:test-setup`

Run: `bun test packages/services/tests/notifications/notifications.test.ts apps/web/tests/features/inbox/inbox-view.test.tsx`

### Task 2: Normalize pull request comments and precise GitHub destinations

**Files:**
- Modify: `packages/shared/src/constants/notification.ts`
- Modify: `packages/services/src/github/index.ts`
- Modify: `packages/services/src/github/apply.ts`
- Modify: `packages/services/tests/github/github.test.ts`
- Modify: `packages/services/tests/github/apply.test.ts`
- Modify: `apps/web/src/features/inbox/inbox-view.tsx`

**Interfaces:**
- Produces: notification type `pr_comment`
- Produces: normalized `comment` with `body`, `url`, and `kind`

- [ ] **Step 1: Write failing parser tests for PR conversation and inline review comments**

```ts
expect(parseGithubEvent('issue_comment', payload)?.comment).toEqual({
  body: 'Please add a regression test.',
  url: 'https://github.com/acme/web/pull/7#issuecomment-1',
  kind: 'conversation',
});
```

- [ ] **Step 2: Run parser tests and confirm unsupported events fail**

Run: `bun test packages/services/tests/github/github.test.ts`

- [ ] **Step 3: Implement strict schemas and reject issue comments without the pull request marker**

- [ ] **Step 4: Write failing application tests proving comments resolve only through an existing link and use the comment URL**

```ts
expect(result.notificationEvents[0]?.type).toBe('pr_comment');
expect(result.notificationEvents[0]?.externalUrl).toBe(commentUrl);
```

- [ ] **Step 5: Implement comment resolution and notification construction, then rerun GitHub tests**

Run: `bun test packages/services/tests/github/github.test.ts packages/services/tests/github/apply.test.ts`

### Task 3: Enforce current team access for reads and notification audiences

**Files:**
- Modify: `packages/services/src/github/apply.ts`
- Modify: `packages/services/tests/github/apply.test.ts`
- Modify: `apps/web/src/features/pulls/data.ts`
- Modify: `apps/web/tests/features/pulls/github-reach.test.ts`

**Interfaces:**
- Produces: current-member-only `userIds` for GitHub notification events
- Produces: `loadPullRequests(principal)` rows constrained by current team access unless principal is an administrator

- [ ] **Step 1: Write failing tests for a removed team member and an administrator**

```ts
expect(result.notificationEvents.flatMap((event) => event.userIds)).not.toContain(removedUserId);
expect(await loadPullRequests(memberPrincipal)).toHaveLength(0);
expect(await loadPullRequests(adminPrincipal)).toHaveLength(1);
```

- [ ] **Step 2: Run focused tests and confirm the stale creator or assignee paths leak data**

Run: `bun test packages/services/tests/github/apply.test.ts apps/web/tests/features/pulls/github-reach.test.ts`

- [ ] **Step 3: Filter audiences using workspace membership, team membership, and administrator role**

- [ ] **Step 4: Replace creator or assignee visibility with a policy-equivalent team condition and rerun tests**

### Task 4: Claim webhook deliveries exclusively

**Files:**
- Modify: `apps/web/src/app/api/webhooks/github/route.ts`
- Modify: `apps/web/tests/app/api/webhooks/github/route.test.ts`

**Interfaces:**
- Produces: atomic insert into `processing` or lease-aware reclaim from `received`, `failed`, or expired `processing`
- Produces: in-progress response for an active claim and duplicate response for a terminal delivery

- [ ] **Step 1: Write a failing concurrent delivery test**

```ts
const responses = await Promise.all([POST(requestFor(id)), POST(requestFor(id))]);
expect(responses.map((response) => response.status)).toEqual([200, 200]);
expect(await linkedRows()).toHaveLength(1);
```

- [ ] **Step 2: Run the route test and confirm the event can be applied more than once**

Run: `bun test apps/web/tests/app/api/webhooks/github/route.test.ts`

- [ ] **Step 3: Implement an atomic conditional claim and terminal status updates**

- [ ] **Step 4: Rerun the route tests**

### Task 5: Backfill open linked pull requests

**Files:**
- Modify: `packages/services/src/github/app.ts`
- Create: `packages/services/src/github/backfill.ts`
- Modify: `packages/services/src/github/index.ts`
- Modify: `packages/services/tests/github/app.test.ts`
- Create: `packages/services/tests/github/backfill.test.ts`
- Modify: `apps/web/src/features/settings/github-connect.ts`
- Modify: `apps/web/src/app/api/integrations/github/route.ts`
- Modify: `apps/web/src/app/api/integrations/github/repositories/route.ts`
- Modify: corresponding web route tests

**Interfaces:**
- Produces: `fetchOpenGithubPullRequests(input): Promise<GithubPullRequestSnapshot[]>`
- Produces: `backfillGithubPullRequests(database, input): Promise<GithubBackfillResult>`

- [ ] **Step 1: Write a failing paginated GitHub API reader test**

```ts
expect(await fetchOpenGithubPullRequests(input)).toHaveLength(101);
expect(calls).toContain('/repos/acme/web/pulls?state=open&per_page=100&page=2');
```

- [ ] **Step 2: Implement the bounded paginated reader and rerun its tests**

- [ ] **Step 3: Write a failing backfill test proving a pre-existing PR links without emitting notifications**

```ts
expect(result.linked).toBe(1);
expect(result.notifications).toBe(0);
```

- [ ] **Step 4: Implement shared application with notification suppression**

- [ ] **Step 5: Trigger backfill after association commit and explicit refresh, isolate repository failures, and run route tests**

### Task 6: Documentation, full verification, browser proof, and pull request

**Files:**
- Modify: `docs/github-app.md`
- Modify: `docs/integrations.md`
- Modify: `apps/web/vercel.json` only if a reconciliation cron is required by the implementation

**Interfaces:**
- Consumes all preceding tasks.

- [ ] **Step 1: Document `issue_comment` and `pull_request_review_comment` subscriptions and backfill behavior**

- [ ] **Step 2: Run focused GitHub, notification, pulls, inbox, and webhook tests**

- [ ] **Step 3: Run the full repository gate**

Run: `bun run verify`

- [ ] **Step 4: Start the app and verify the inbox and pulls routes in a browser**

Run: `bun run dev`

- [ ] **Step 5: Capture desktop and narrow viewport screenshots and check for framework overlays**

- [ ] **Step 6: Review the complete diff against this plan, fix all critical and important findings, rerun verification, commit, push, and open a draft pull request**

# Notification and Inbox Reliability Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace per-event notification rows with durable, idempotent conversations and ordered Slack threads while preserving current inbox, realtime, MCP, and preference behavior through migration.

**Architecture:** PostgreSQL is the durable boundary for source ingestion, recipient fanout, conversation state, and provider delivery. Existing notification rows become immutable recipient events, conversation summaries provide the read model, and leased workers deliver Slack and email after commit.

**Tech Stack:** Bun, TypeScript, Next.js 16, Drizzle ORM, PostgreSQL, TanStack Query, Redis realtime, Slack Web API, Resend, Playwright

**Spec:** `docs/superpowers/specs/2026-09-01-notification-inbox-overhaul-design.md`

## Global Constraints

- Every command uses Bun as package manager and script runner.
- Shipped server code runs on Node and imports no Bun built-in.
- Code contains no explanatory comments, no `any`, no non-null assertions, and no em dash characters.
- External input is parsed by shared Zod schemas.
- Server authorization uses `packages/shared/src/policy`.
- Every implementation task starts with a failing test and ends with focused green tests.
- Schema-dependent application code is not enabled before the matching production database release.

---

### Task 1: Fence GitHub webhook ownership and finalization

**Files:**
- Modify: `packages/db/src/schema/comms.ts`
- Create: `packages/db/drizzle/0017_notification_webhook_fencing.sql`
- Modify: `apps/web/src/app/api/webhooks/github/route.ts`
- Test: `apps/web/tests/app/api/webhooks/github/route.test.ts`

**Interfaces:**
- Produces: `WebhookClaim` with `id` and `claimToken`
- Produces: token-aware success and failure finalization that returns whether ownership was retained
- Preserves: current signed webhook HTTP responses and installation routing

- [x] Write tests proving a fresh claim has a token, reclaim rotates it, a stale claimant cannot finalize, and the current claimant finalizes once.
- [x] Run `bun --env-file=../../.env test tests/app/api/webhooks/github/route.test.ts` from `apps/web` and confirm the new tests fail.
- [x] Add nullable `webhook_delivery.claim_token`, migrate existing non-processing rows safely, and generate the matching Drizzle snapshot.
- [x] Implement claim rotation and compare-and-swap finalization on delivery id, processing status, and claim token.
- [x] Move ordinary and installation success finalization into their effects transactions.
- [x] Run the focused web route tests and database schema tests.
- [x] Commit as `fix(github): fence webhook delivery ownership`.

### Task 2: Add durable source identity and contain duplicate fanout

**Files:**
- Modify: `packages/db/src/schema/comms.ts`
- Modify: `packages/services/src/notifications/index.ts`
- Modify: `packages/services/src/github/apply.ts`
- Modify: `apps/web/src/app/api/webhooks/github/route.ts`
- Modify: `apps/web/src/app/api/notifications/[id]/route.ts`
- Test: `packages/services/tests/notifications/notifications.test.ts`
- Test: `packages/services/tests/github/apply.test.ts`
- Test: `apps/web/tests/app/api/webhooks/github/route.test.ts`

**Interfaces:**
- Produces: `NotificationSourceInput` carrying source key, canonical subject, occurrence time, and payload
- Produces: `notifyMany` source insert plus recipient uniqueness on source and user
- Produces: canonical GitHub pull-request recipient fanout with one unioned audience
- Preserves: legacy notification rows and APIs during compatibility

- [x] Write concurrent redelivery, multi-linked-issue, and post-crash duplicate tests.
- [x] Add `notification_source_event`, nullable source linkage, fanout fence, dismissal, and manual-unread compatibility fields.
- [x] Replace the 60-second GitHub gate with tenant-scoped source uniqueness and recipient conflict handling.
- [x] Canonicalize linked and unlinked GitHub pull requests before notification planning and union their audiences.
- [x] Soft-dismiss legacy rows and exclude dismissed rows from reads and counters.
- [x] Persist shared Slack channel work before removing synchronous webhook delivery.
- [x] Run focused services, core, web, and database tests.
- [x] Commit as `fix(notifications): contain duplicate fanout`.

### Task 3: Make current-head GitHub CI authoritative

**Files:**
- Modify: `packages/db/src/schema/comms.ts`
- Modify: `packages/shared/src/validators/notification.ts`
- Modify: `packages/services/src/github/index.ts`
- Modify: `packages/services/src/github/apply.ts`
- Modify: `packages/services/src/github/app.ts`
- Test: `packages/services/tests/github/github.test.ts`
- Test: `packages/services/tests/github/apply.test.ts`
- Test: `packages/services/tests/github/app.test.ts`

**Interfaces:**
- Produces: repository-and-head activity and context ownership
- Produces: versioned reconciliation claims and raw fetch-attempt provenance
- Produces: one `pr_checks_failed` source transition per pull request and head SHA

- [x] Write tests for old-head rejection, overlapping GitHub event kinds, pre-PR checks, force-push races, and one failure transition.
- [x] Add repository-head activity, context, reconciliation, fetch-attempt, and per-PR projection tables.
- [x] Normalize exact check-run app identity and exact commit-status creator/context identity.
- [x] Treat suites and workflow runs as reconciliation triggers and direct runs or statuses as context mutations.
- [x] Fence snapshots with job version, claim token, head generation, PR head epoch, and current SHA.
- [x] Emit the coarse failure source only on a current-head nonfailure-to-failure transition.
- [x] Run focused GitHub and migration tests.
- [x] Commit as `fix(github): scope checks to current pull heads`.

### Task 4: Add conversations, compatibility writes, and migration tools

**Files:**
- Modify: `packages/db/src/schema/comms.ts`
- Create: `packages/services/src/notifications/conversations.ts`
- Create: `packages/services/src/notifications/conversation-backfill.ts`
- Create: `scripts/notification-conversation-backfill.ts`
- Create: `scripts/notification-conversation-verify.ts`
- Modify: `package.json`
- Modify: `packages/services/src/notifications/index.ts`
- Modify: `apps/web/src/app/api/notifications/route.ts`
- Modify: `apps/web/src/app/api/notifications/read/route.ts`
- Modify: `apps/web/src/app/api/notifications/[id]/route.ts`
- Test: `packages/services/tests/notifications/conversations.test.ts`
- Test: `packages/services/tests/notifications/conversation-backfill.test.ts`

**Interfaces:**
- Produces: canonical conversation key resolver
- Produces: conversation, inbox state, and generation-fenced snooze wake writes
- Produces: resumable backfill and zero-drift verifier commands
- Preserves: bidirectional legacy read, unread, snooze, dismiss, and delivery-channel state

- [ ] Write tests for grouping, counters, read state, dismissal, snooze, policy hiding, duplicate survivor rules, and resumable backfill.
- [ ] Add conversation, inbox-state, snooze-wake, audit-link, sequence, and compatibility columns and constraints.
- [ ] Dual-write live events and every legacy mutation before backfill begins.
- [ ] Implement deterministic historical recipient and delivery survivor selection.
- [ ] Add resumable backfill and verification commands with bounded batches and persisted progress.
- [ ] Run focused service, database, and compatibility tests.
- [ ] Commit as `feat(inbox): add durable conversations`.

### Task 5: Cut over API, realtime, MCP, and the inbox UI

**Files:**
- Create: `apps/web/src/app/api/inbox/conversations/route.ts`
- Create: `apps/web/src/app/api/inbox/conversations/[id]/events/route.ts`
- Create: `apps/web/src/app/api/inbox/conversations/read/route.ts`
- Modify: `apps/web/src/features/inbox/data.ts`
- Modify: `apps/web/src/features/inbox/inbox-realtime.tsx`
- Modify: `apps/web/src/features/inbox/inbox-view.tsx`
- Modify: `packages/shared/src/events.ts`
- Modify: `packages/core/src/realtime/backfill.ts`
- Modify: `packages/mcp-server/src/tools/inbox.ts`
- Test: `apps/web/tests/features/inbox`
- Test: `apps/web/e2e/inbox-layout.spec.ts`
- Test: `packages/mcp-server/tests/tools/inbox.test.ts`

**Interfaces:**
- Produces: server-filtered conversation pagination and history APIs
- Produces: authoritative counter versions and non-sensitive conversation realtime deltas
- Produces: additive MCP conversation tools while retaining event tools
- Preserves: keyboard navigation, deep links, issue and document context, light and dark themes

- [ ] Write API, realtime, MCP, grouping, pagination, history, keyboard, and counter tests.
- [ ] Add shared response validators and authorized conversation queries.
- [ ] Add current-policy event-history reads and conversation mutations.
- [ ] Publish conversation upserts and replace client-side badge arithmetic with server counters.
- [ ] Render one list row per conversation and event history in the detail pane.
- [ ] Group document comments, replies, mentions, and document changes under `orbit-doc:<id>:activity`.
- [ ] Run focused unit tests and Playwright.
- [ ] Commit as `feat(inbox): switch to conversation threads`.

### Task 6: Deliver ordered Slack threads and notification email

**Files:**
- Modify: `packages/db/src/schema/comms.ts`
- Create: `packages/services/src/notifications/provider-outbox.ts`
- Create: `packages/services/src/slack/notification-threads.ts`
- Modify: `packages/core/src/notifications/notify.ts`
- Modify: `apps/web/src/app/api/cron/notifications/route.ts`
- Modify: `apps/web/src/features/settings/notification-matrix.tsx`
- Test: `packages/services/tests/slack/notification-threads.test.ts`
- Test: `packages/services/tests/notifications/provider-outbox.test.ts`
- Test: `apps/web/tests/app/api/cron/notifications/route.test.ts`

**Interfaces:**
- Produces: claim-token provider outbox with ordered Slack roots and non-broadcast replies
- Produces: one root per destination and conversation
- Produces: current-policy preflight for DMs, shared channels, and email
- Produces: visible pending, retrying, unavailable, ambiguous, and dead-letter diagnostics

- [ ] Write concurrent root, ordered reply, ambiguity, rate-limit, reconnect, preference, mapping, and email idempotency tests.
- [ ] Add provider identity, destination, claim, lease, payload, ambiguity, and Slack thread fields and constraints.
- [ ] Convert shared channel and direct-message delivery to one durable worker contract.
- [ ] Render a useful root summary and compact event replies with `reply_broadcast: false`.
- [ ] Add the notification-email Resend worker without changing transactional email.
- [ ] Add actionable integration diagnostics and admin versus personal preference copy.
- [ ] Run focused provider and cron tests.
- [ ] Commit as `feat(slack): thread notification conversations`.

### Task 7: Verify, document, preview, and review

**Files:**
- Modify: `docs/integrations/slack.md`
- Modify: `docs/features/inbox.md`
- Create: `apps/web/e2e/notification-conversations.spec.ts`
- Modify: `apps/web/scripts/capture-screenshots.ts`

**Interfaces:**
- Produces: user-facing Slack and inbox documentation
- Produces: reproducible light and dark screenshots of grouped inbox and Slack message fixtures

- [ ] Document current notification types, audience rules, Slack channel versus direct-message behavior, and exact-email member matching.
- [ ] Capture grouped PR, document-comment, and Slack-thread fixtures in light and dark themes.
- [ ] Run focused tests, `bun run verify`, `bun run docs:build`, and `git diff --check`.
- [ ] Merge current `main`, rerun every check, resolve Greptile and CodeRabbit threads, and keep the PR draft until review is complete.
- [ ] Update the PR with screenshots, migration order, production smoke checks, and rollback switches.

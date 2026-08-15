# Slack Direct Message Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver personal Orbit notifications as Slack direct messages while preserving channel delivery for team and project notifications.

**Architecture:** Add an organization-scoped Orbit-user to Slack-user mapping tied to the Slack integration, persist the granted OAuth scopes, and expose `slack_dm` as a distinct preference channel. Keep audience calculation and quiet-hours planning in the existing notification service, then dispatch DMs through a typed `conversations.open` plus `chat.postMessage` path. Existing channel delivery remains unchanged.

**Tech Stack:** Bun 1.3+, TypeScript, Drizzle ORM/Postgres, Zod, Slack Web API, React settings UI, Bun tests.

## Global Constraints

- Follow Issue #191 and do not expand into audit logging or unrelated Slack redesign.
- Write each test before its production implementation, run it red for the expected missing behavior, then implement the minimum change and run it green.
- Use Zod for all Slack response and external input parsing.
- Preserve the existing `slack` channel meaning for team/project notifications; use `slack_dm` only for personal notifications.
- Unmapped users must receive no DM and must not cause notification creation to fail.
- Missing `im:write` must produce an actionable reauthorization state; existing channel notifications remain usable.
- Slack provider failures must be logged without failing the notification transaction or other channels.
- Do not add code comments, `any`, non-null assertions, em-dashes, secrets, or generated artifacts.
- Use the existing database test setup and injected HTTP fetch handlers; never call a live Slack workspace in tests.

---

### Task 1: Extend the Slack client for DM conversations

**Files:**
- Modify: `packages/services/src/slack/index.ts`
- Test: `packages/services/tests/slack/slack.test.ts`

**Interfaces:**
- Produces `SlackClient.openConversation(userId: string): Promise<{ channel: string }>`.
- The method calls Slack `conversations.open` with `{ users: userId }` and validates `{ ok, channel: { id } }` with Zod.

- [ ] **Step 1: Write the failing test**

Add a fetch-backed test that calls `openConversation('U123')`, records the request, returns a valid Slack response, and asserts the method returns `D123` and sends `users: 'U123'` to `conversations.open`.

- [ ] **Step 2: Run the focused test to verify it fails**

Run:

```powershell
$env:Path = 'C:\Users\mikemikimike\.bun\bin;' + $env:Path
bun test packages/services/tests/slack/slack.test.ts -t "opens a direct message conversation"
```

Expected: FAIL because `SlackClient.openConversation` does not exist.

- [ ] **Step 3: Implement the minimal client method**

Add a Zod response schema for the channel ID and implement `openConversation` via the existing private `call` helper. Do not bypass response validation or add a second HTTP abstraction.

- [ ] **Step 4: Run the focused test to verify it passes**

Run the same command. Expected: the new test passes with no failures.

- [ ] **Step 5: Commit**

```powershell
git add packages/services/src/slack/index.ts packages/services/tests/slack/slack.test.ts
git commit -m "feat(slack): open direct message conversations"
```

### Task 2: Add Slack mapping and OAuth scope persistence

**Files:**
- Modify: `packages/db/src/schema/comms.ts`
- Modify: `packages/services/src/slack/dispatch.ts`
- Modify: `apps/web/src/features/settings/integrations-connect.ts`
- Modify: `apps/web/src/app/api/integrations/slack/start/route.ts`
- Modify: `apps/web/src/app/api/integrations/slack/route.ts`
- Create: the repository-standard Drizzle migration generated from the schema change
- Test: the relevant Slack integration service test file, or create `packages/services/tests/slack/mapping.test.ts` if no existing mapping test exists

**Interfaces:**
- Produces a mapping record with organization ID, integration ID, Orbit user ID, Slack user ID, Slack display name, and timestamps.
- Produces integration scope persistence sufficient to answer `hasSlackScope(integrationId, 'im:write')` without exposing credentials.
- Enforces uniqueness for one Orbit user per integration and one Slack user per integration.

- [ ] **Step 1: Write failing database tests**

Add real-Postgres tests that create a Slack integration and users, then prove a mapping can be inserted and read, duplicate Orbit/Slack bindings are rejected, and a missing `im:write` scope is distinguishable from a granted one.

- [ ] **Step 2: Run the tests to verify they fail**

Prepare the repository database once if needed:

```powershell
$env:Path = 'C:\Users\mikemikimike\.bun\bin;' + $env:Path
Copy-Item .env.example .env -ErrorAction SilentlyContinue
bun run infra:up
bun run db:push
bun run db:test-setup
$env:ORBIT_TEST_LANE = 'codex-slack-dm-red'
bun --env-file=../../.env test --timeout 20000 --max-concurrency 1 packages/services/tests/slack/mapping.test.ts
```

Expected: FAIL because the schema and mapping operations do not exist. If the command fails for an environment reason, stop and report it before implementation.

- [ ] **Step 3: Add schema, migration, and persistence**

Add the mapping table and scope column using existing naming and foreign-key conventions. Add narrowly scoped create/list/delete or upsert operations where the current Slack OAuth/settings code needs them. Store scopes as non-secret metadata and keep bot tokens in the existing credentials object.

- [ ] **Step 4: Run the focused database tests to verify they pass**

Run the same command with a fresh lane. Expected: all mapping and scope tests pass.

- [ ] **Step 5: Commit**

```powershell
git add packages/db packages/services apps
git commit -m "feat(slack): persist user mappings and scopes"
```

### Task 3: Add Slack DM notification preferences and routing

**Files:**
- Modify: `packages/shared/src/constants/notification.ts`
- Modify: `packages/services/src/notifications/preferences.ts`
- Modify: `packages/services/src/notifications/index.ts`
- Modify: `packages/core/src/notifications/audience.ts` only if the existing event classification needs a typed helper
- Test: `packages/core/tests/notifications/producers.test.ts` and the nearest service notification tests

**Interfaces:**
- `slack_dm` is an independent `NotificationChannel` value.
- Personal notification plans expose Slack DM dispatches separately from channel dispatches.
- Team/project events continue to expose existing Slack channel dispatches.

- [ ] **Step 1: Write failing routing tests**

Add tests for: a personal event with `slack_dm` enabled creating a DM dispatch and no channel dispatch; a team/project event creating a channel dispatch; an unmapped recipient producing no DM without failing; quiet hours suppressing the DM; and Inbox, Email, and DM preferences remaining independent.

- [ ] **Step 2: Run the focused tests to verify they fail**

Run:

```powershell
$env:Path = 'C:\Users\mikemikimike\.bun\bin;' + $env:Path
$env:ORBIT_TEST_LANE = 'codex-slack-dm-routing-red'
bun --env-file=../../.env test --timeout 30000 --max-concurrency 1 packages/core/tests/notifications/producers.test.ts -t "Slack DM"
```

Expected: FAIL because the new preference and dispatch shape do not exist. Resolve only test setup errors before proceeding; do not accept a passing test before production changes.

- [ ] **Step 3: Implement the minimal routing changes**

Add `slack_dm` to `packages/shared/src/constants/notification.ts` and the preference defaults. Keep `slack` as the channel target for broadcast events. Extend the notification outcome with a DM dispatch list carrying recipient user ID and notification ID, and make personal-event classification use `slack_dm` only. Apply the existing quiet-hours and urgent-bypass rules to DM planning.

- [ ] **Step 4: Run focused routing tests to verify they pass**

Run the same command with a fresh lane. Expected: all new routing tests pass and existing producer tests remain green.

- [ ] **Step 5: Commit**

```powershell
git add packages/shared packages/services/src/notifications packages/core/src/notifications packages/core/tests/notifications/producers.test.ts
git commit -m "feat(notifications): route personal events to Slack DMs"
```

### Task 4: Dispatch mapped Slack DMs without affecting other channels

**Files:**
- Modify: `packages/services/src/slack/dispatch.ts`
- Modify: `packages/services/src/notifications/...` dispatch integration file
- Test: `packages/services/tests/slack/slack.test.ts` or the existing notification dispatch test location

**Interfaces:**
- Produces a batch DM dispatcher that resolves the Slack integration, mapping, opens one conversation per mapped recipient, and posts the notification.
- Missing mappings return zero DM deliveries without throwing.
- Provider failures are logged and do not reject the caller.

- [ ] **Step 1: Write failing dispatch tests**

Use an injected fetch handler and real test database rows to assert the Slack user ID is passed to `conversations.open`, the returned DM channel ID is passed to `chat.postMessage`, unmapped users are skipped, and a failed Slack response leaves the call non-throwing.

- [ ] **Step 2: Run the tests to verify they fail**

Run the focused dispatch test with a fresh `ORBIT_TEST_LANE`. Expected: FAIL because DM dispatch does not exist.

- [ ] **Step 3: Implement the dispatcher**

Reuse `resolveSlackContext`, add a mapping lookup batched by recipient IDs, call `openConversation`, then `postMessage`. Use the same notification text/block rendering as channel dispatch. Log only safe identifiers and provider error messages.

- [ ] **Step 4: Run the focused dispatch tests to verify they pass**

Run the same command and confirm all dispatch cases pass.

- [ ] **Step 5: Commit**

```powershell
git add packages/services/src/slack/dispatch.ts packages/services/src/notifications packages/services/tests
git commit -m "feat(slack): dispatch mapped notification DMs"
```

### Task 5: Add settings UI, mapping availability, and reauthorization state

**Files:**
- Modify: `apps/web/src/features/settings/notification-matrix.tsx`
- Modify: existing settings API/route that loads and saves notification preferences
- Modify: existing Slack OAuth/reconnect route and settings component
- Test: the nearest web settings tests and API tests

**Interfaces:**
- The settings payload identifies `slack_dm` availability, mapping state, and missing `im:write` state without exposing tokens.
- The matrix renders Slack DM separately from Slack channel and prevents enabling an unavailable destination.
- Missing scope links to the existing Slack reauthorization path with explanatory text.

- [ ] **Step 1: Write failing UI/API tests**

Cover a mapped user with scope receiving an enabled Slack DM option, an unmapped user seeing unavailable rather than off, an old integration seeing reauthorization required, and saved `slack_dm` preferences round-tripping through the API.

- [ ] **Step 2: Run focused tests to verify they fail**

Run the exact web settings/API test files with Bun and the repository test lane. Expected: FAIL because the payload and UI state do not exist.

- [ ] **Step 3: Implement settings and OAuth state**

Add safe server-side availability data, render the new matrix column or row using existing styling and accessibility conventions, wire preference persistence, and add the reauthorization link for missing `im:write`. Do not let the browser see credentials.

- [ ] **Step 4: Run focused settings tests to verify they pass**

Run the same tests with a fresh lane. Expected: all new settings tests pass.

- [ ] **Step 5: Commit**

```powershell
git add apps/web packages/services packages/shared
git commit -m "feat(settings): expose Slack DM notification preferences"
```

### Task 6: Document Slack DM permissions and compatibility

**Files:**
- Modify: `docs/integrations.md`
- Modify: any setup or OAuth scope fixture required by the existing documentation/tests
- Test: documentation lint/check commands only; no runtime test needed

- [ ] **Step 1: Write the documentation changes**

Document `im:write`, reauthorization for existing installations, user mapping, unmapped-user behavior, channel-versus-DM routing, and the fact that quiet hours apply to DMs.

- [ ] **Step 2: Run repository documentation checks**

Run `bun run check-comments` and the repository’s documented lint/check commands. Expected: no policy violations.

- [ ] **Step 3: Commit**

```powershell
git add docs/integrations.md
git commit -m "docs(slack): explain direct message notifications"
```

### Task 7: Full verification and PR preparation

**Files:**
- Verify all changed files only; no new implementation expected.

- [ ] **Step 1: Update from remote main safely**

Run `git fetch origin main` and inspect whether `origin/main` advanced. Rebase only if the branch has no conflicting local state, and never force-push.

- [ ] **Step 2: Run focused tests for every changed subsystem**

Run the Slack client, mapping, notification routing, dispatch, and settings tests with fresh, unique test lanes. Record exact pass counts and failures.

- [ ] **Step 3: Run full repository verification**

```powershell
$env:Path = 'C:\Users\mikemikimike\.bun\bin;' + $env:Path
bun run verify
```

Expected: exit code 0 with lint, comments, bytes/import/dependency checks, typecheck, and all tests passing. If any command fails, stop and report the exact failure for user direction before committing or opening a PR.

- [ ] **Step 4: Inspect the final diff**

Run `git diff origin/main...HEAD --check`, `git diff --stat`, `git status --short`, and inspect for secrets, generated artifacts, comments, em-dashes, and unrelated changes.

- [ ] **Step 5: Push and open the PR only after all checks pass**

Push to the user fork and create a PR targeting `main`, linking `Closes #191`. The PR body must include exact test commands/results and any checks not run. Do not create the PR if any required local verification remains failed.

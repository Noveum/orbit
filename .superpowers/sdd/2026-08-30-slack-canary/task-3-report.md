# Task 3 Report: Authorized Channels and Prompt Event Acknowledgement

## Status

DONE_WITH_CONCERNS

The implementation is complete and every runnable focused or static check passes. PostgreSQL is unavailable on localhost port 5434, so the DB-backed route, dispatch, and webhook assertions could not execute beyond connection setup.

## Changed Files

- `packages/shared/src/validators/integration.ts`
- `packages/services/src/slack/index.ts`
- `packages/services/src/slack/dispatch.ts`
- `packages/services/tests/slack/slack.test.ts`
- `packages/services/tests/slack/dispatch.test.ts`
- `apps/web/src/features/settings/integrations-panel.tsx`
- `apps/web/src/app/api/integrations/slack/route.ts`
- `apps/web/src/lib/integrations/slack-event-scheduler.ts`
- `apps/web/src/app/api/webhooks/slack/route.ts`
- `apps/web/tests/features/settings/integrations-panel.test.tsx`
- `apps/web/tests/app/api/integrations/slack/route.test.ts`
- `apps/web/tests/app/api/webhooks/slack/route.test.ts`
- `.superpowers/sdd/2026-08-30-slack-canary/task-3-report.md`

## Red Evidence

The first Slack service test run exited 1 with three intended failures:

- The read-only issue block assertion found `orbit_open_issue`, `orbit_assign_self`, and `orbit_mark_done` in the existing actions block.
- The canonical channel test failed because `SlackClient.conversation` did not exist.
- The malformed canonical channel response test failed for the same missing method.

After temporarily restoring the old settings request shape, the focused panel test exited 1 because the connect request still contained `channelName: "canonical-name"`. The expected request contained only `action`, `channelId`, and `teamId`.

DB-backed authorization and scheduling tests were written before their production changes. Their red execution was blocked during database setup by `ECONNREFUSED` from both localhost address families before assertions could run.

## Green Evidence

Fresh verification after the final changes:

```sh
bun test packages/services/tests/slack/slack.test.ts
```

Result: 35 passed, 0 failed, 70 expectations.

```sh
cd apps/web && bun test tests/features/settings/integrations-panel.test.tsx
```

Result: 11 passed, 0 failed, 26 expectations.

```sh
bun run typecheck
```

Result: every workspace package exited with code 0.

```sh
bun run lint
bun run check-comments
bun run check-bytes
git diff --check
```

Results: lint exited successfully with the existing warning in `packages/db/tests/check-source-bytes.test.ts` and the existing Biome schema information; comment policy found 0 disallowed comments; the byte check found no control bytes; the diff check found no whitespace errors.

## Database Blocker

The required DB-focused attempt used:

```sh
DATABASE_URL=postgres://orbit:orbit@localhost:5434/orbit_test_web DATABASE_PREPARED_STATEMENTS=false bun test tests/app/api/integrations/slack/route.test.ts
```

It failed during the `select current_database() as name` setup guard with `ECONNREFUSED`. No provider or route assertions ran. Per the task instruction, no repeated DB attempts were made and no process was left waiting.

## Implementation Summary

`SlackClient.conversation` calls `conversations.info` and parses a discriminated Zod response that requires canonical ID, name, privacy, archive, and bot membership fields. Channel connection now accepts only client channel ID and Orbit team ID. The Slack service resolves the same-organization canonical `default` integration, decrypts and requires its token inside the service boundary, fetches canonical metadata, rejects a bot that is not a member, and persists only the returned ID and name.

Link sharing resolves exactly one Slack integration for the event team, verifies the exact organization rollout, then resolves exactly one enabled channel mapping for organization, integration, and event channel before issue lookup. A non-null mapping adds an exact issue team filter. A null mapping remains workspace-wide inside the resolved organization. Missing, disabled, or ambiguous mappings perform no issue lookup or provider request.

Issue unfurls retain the linked title and read-only details while removing the complete actions block and every action ID.

The webhook keeps signature verification, body parsing, URL verification, and the idempotency claim in the request. A winning claim schedules processing through a mockable wrapper around Next.js `after()` and immediately acknowledges with HTTP 200. Duplicate, processed, and currently processing deliveries acknowledge without rescheduling. Failed and stale claims can be reclaimed. Success and failure finalization require matching provider, delivery ID, processing status, and `claimedAt`, so stale workers cannot overwrite a replacement claim. Background failures store a fixed safe error and emit only fixed safe log messages, including when failure finalization itself fails.

## Self Review

- Confirmed `SLACK_INTEGRATION_ENABLED` remains `false`.
- Confirmed `SLACK_ENABLED_ORGANIZATION_ID` checks remain exact on the connect and webhook paths.
- Confirmed Slack bot token decryption remains inside the Slack service and no token enters a route response or log.
- Confirmed the channel request has no `channelName` or `integrationId` field and independently supplied values are not used.
- Confirmed channel persistence uses Slack-returned canonical ID and name and requires `is_member === true`.
- Confirmed issue lookup happens only after a unique enabled mapping and never broadens beyond the resolved organization.
- Confirmed non-null team scope is exact and null is explicit workspace scope.
- Confirmed the issue actions block and all three prior action IDs are absent.
- Confirmed callback acknowledgement precedes every Slack provider request and duplicate claims do not schedule again.
- Confirmed failure and success finalization are claim-aware and logs contain no request, provider response, or token content.
- Confirmed the Task 2 unique Slack team ownership behavior is preserved and duplicate-team fixtures were removed.
- Confirmed no Socket Mode, slash command, public distribution, or interactivity behavior was added.
- Confirmed no shipped code comments, em dash characters, or attribution were added.

## Review Remediation

### Findings Addressed

- Channel verification now records the credential version used for `conversations.info`, then opens a transaction, locks and reloads the same canonical integration row, and verifies its organization, provider, `default` identity, integration ID, and exact credential version before writing the mapping in that transaction. A reconnect during provider verification returns a safe conflict and writes no mapping.
- `channel_not_found` and `not_in_channel` from `conversations.info` now produce the same safe validation failure as `is_member: false`. Other Slack and transport errors retain their existing behavior. The client call return type now reflects that parsed `{ ok: false }` responses have already thrown `SlackApiError`, removing the unreachable conversation branch.
- The stale-worker test now holds the replacement provider request open, runs the stale worker while the replacement delivery is still processing, verifies status and `claimedAt` are unchanged, then completes the replacement and verifies the delivery becomes processed.

### Remediation Tests Written First

The reconnect race regression begins channel mapping with the original encrypted token, waits until Slack verification is in flight, reconnects the same canonical row with a new workspace and credential version, releases the old provider response, and asserts HTTP 409 with no mapping saved.

The access-error regression returns Slack `{ ok: false, error: "channel_not_found" }` and expects the same 422 validation payload as an unjoined channel, with no mapping. The Slack client unit regression also verifies that the provider response is parsed into `SlackApiError` with the original safe code.

The strengthened stale-worker regression keeps the replacement provider request unresolved while the old worker finishes. It asserts the replacement row remains processing with the replacement `claimedAt` until the replacement worker completes.

The DB-backed red attempt used both changed route suites in one command:

```sh
DATABASE_URL=postgres://orbit:orbit@localhost:5434/orbit_test_web DATABASE_PREPARED_STATEMENTS=false bun test tests/app/api/integrations/slack/route.test.ts tests/app/api/webhooks/slack/route.test.ts
```

Both suites were blocked before assertions by `ECONNREFUSED` during `select current_database() as name`. No repeated DB attempt was made.

### Remediation Green Evidence

```sh
bun test packages/services/tests/slack/slack.test.ts
```

Result: 36 passed, 0 failed, 72 expectations.

```sh
bun run typecheck
```

Result: every workspace package exited with code 0.

### Remediation Self Review

- The provider request remains outside the database transaction, while only the short lock, credential-version check, and mapping write are atomic.
- A reconnect committed before the lock causes an exact version mismatch and no mapping write.
- A reconnect arriving after the lock waits, then its existing team-change cleanup runs after the mapping transaction commits.
- Token decryption remains inside the Slack service and no token or provider payload enters errors or logs.
- Exact organization rollout checks, unique Slack team ownership, mapped-channel issue scope, prompt callback acknowledgement, and claim-aware finalization remain unchanged.

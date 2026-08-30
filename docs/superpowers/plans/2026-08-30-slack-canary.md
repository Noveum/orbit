# Slack Noveum Canary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable a secure Slack canary for one exact Orbit organization and the Noveum Slack workspace.

**Architecture:** A server-only organization allowlist keeps the shared global Slack flag disabled. OAuth tokens are stored in a versioned AES-256-GCM envelope, Slack team ownership is unique, and incoming unfurls acknowledge promptly while enforcing the configured channel and Orbit team mapping.

**Tech Stack:** Bun, TypeScript, Next.js App Router, Drizzle ORM, PostgreSQL, Zod, Slack OAuth v2 and Events API

**Spec:** `docs/superpowers/specs/2026-08-30-slack-canary-design.md`

## Global Constraints

- Use Bun only.
- Keep `SLACK_INTEGRATION_ENABLED` false so the rollout cannot become global.
- `SLACK_ENABLED_ORGANIZATION_ID` is the exact server-side canary boundary.
- Store every newly issued Slack bot token in a versioned AES-256-GCM envelope.
- Do not add Socket Mode, slash commands, public distribution, or interactive mutations.
- Do not add comments to shipped code.
- Do not add em dash characters or AI attribution.
- Enforce authorization on the server through the shared policy layer.
- Add a test that fails before every production behavior change.

---

### Task 1: Organization-scoped rollout boundary

**Files:**
- Modify: `.env.example`
- Modify: `apps/web/src/lib/integrations/slack-capability.ts`
- Modify: `apps/web/src/features/settings/integrations-data.ts`
- Modify: `apps/web/src/features/settings/integrations-panel.tsx`
- Modify: `apps/web/src/features/settings/notification-preferences.ts`
- Modify: `apps/web/src/app/api/integrations/slack/route.ts`
- Modify: `apps/web/src/app/api/integrations/slack/channels/route.ts`
- Modify: `apps/web/src/app/api/integrations/slack/start/route.ts`
- Modify: `apps/web/src/app/api/integrations/slack/callback/route.ts`
- Modify: `apps/web/src/app/api/webhooks/github/route.ts`
- Modify: `apps/web/src/app/api/webhooks/slack/route.ts`
- Modify: `apps/web/src/app/api/cron/notifications/route.ts`
- Modify: `packages/core/src/notifications/notify.ts`
- Modify: `packages/services/src/notifications/index.ts`
- Test: `apps/web/tests/lib/integrations/slack-capability.test.ts`
- Test: `apps/web/tests/app/api/integrations/slack/disabled.test.ts`
- Test: `apps/web/tests/features/settings/integrations-panel.test.tsx`
- Test: `apps/web/tests/features/settings/integrations-data.test.ts`
- Test: `apps/web/tests/app/api/cron/notifications/route.test.ts`

**Interfaces:**
- Produces: `slackEnabledOrganizationId(): string | null`
- Produces: `slackIntegrationEnabledForOrganization(organizationId: string): boolean`
- Produces: `slackRolloutConfigured(): boolean`
- Produces: `deliverPendingSlackDms(..., options: SlackDmWorkerOptions & { organizationId?: string })`

- [ ] **Step 1: Write failing rollout tests**

Add tests proving an absent or blank `SLACK_ENABLED_ORGANIZATION_ID` disables Slack, an exact ID enables only that organization, the Slack card renders only when server-loaded settings contain Slack data, denied routes return 404 before reading request bodies, and the cron worker receives only the allowed organization ID.

```ts
expect(slackEnabledOrganizationId()).toBeNull();
expect(slackIntegrationEnabledForOrganization('org_other')).toBe(false);
process.env['SLACK_ENABLED_ORGANIZATION_ID'] = 'org_noveum';
expect(slackIntegrationEnabledForOrganization('org_noveum')).toBe(true);
expect(slackIntegrationEnabledForOrganization('org_other')).toBe(false);
```

- [ ] **Step 2: Run the failing tests**

Run:

```bash
bun test apps/web/tests/lib/integrations/slack-capability.test.ts apps/web/tests/app/api/integrations/slack/disabled.test.ts apps/web/tests/features/settings/integrations-panel.test.tsx apps/web/tests/features/settings/integrations-data.test.ts apps/web/tests/app/api/cron/notifications/route.test.ts
```

Expected: FAIL because the organization-scoped capability functions do not exist and Slack remains client-gated by the global constant.

- [ ] **Step 3: Implement the server-only rollout boundary**

Parse one exact non-empty ID from `SLACK_ENABLED_ORGANIZATION_ID` without caching it. Keep the shared constant false. Remove the capability import from the client component and render Slack whenever `settings.slack` exists. Gate server-loaded settings, OAuth start and callback, integration mutations, channel listing, notifications, GitHub dispatch, the Slack webhook, and the DM cron by the exact organization ID.

```ts
export function slackEnabledOrganizationId(): string | null {
  const value = process.env['SLACK_ENABLED_ORGANIZATION_ID']?.trim() ?? '';
  return value.length === 0 ? null : value;
}

export function slackIntegrationEnabledForOrganization(organizationId: string): boolean {
  return slackEnabledOrganizationId() === organizationId;
}
```

Filter DM claims by joining their notification and requiring its `organizationId` when the worker receives an organization filter. Add `SLACK_ENABLED_ORGANIZATION_ID=` to `.env.example`.

- [ ] **Step 4: Run the focused tests and type checks**

Run:

```bash
bun test apps/web/tests/lib/integrations/slack-capability.test.ts apps/web/tests/app/api/integrations/slack/disabled.test.ts apps/web/tests/features/settings/integrations-panel.test.tsx apps/web/tests/features/settings/integrations-data.test.ts apps/web/tests/app/api/cron/notifications/route.test.ts
bun run typecheck
```

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add .env.example apps/web packages/core packages/services
git commit -m "feat(slack): scope canary to one workspace"
```

### Task 2: Encrypted OAuth credentials and Slack team ownership

**Files:**
- Create: `packages/services/src/slack/credentials.ts`
- Modify: `packages/services/src/slack/index.ts`
- Modify: `packages/services/src/slack/dispatch.ts`
- Modify: `packages/services/src/notifications/index.ts`
- Modify: `apps/web/src/features/settings/integrations-data.ts`
- Modify: `apps/web/src/features/settings/notification-preferences.ts`
- Modify: `apps/web/src/features/settings/integrations-connect.ts`
- Modify: `apps/web/src/app/api/integrations/slack/route.ts`
- Modify: `packages/shared/src/validators/integration.ts`
- Modify: `packages/db/src/schema/comms.ts`
- Create: `packages/db/drizzle/0016_secure_slack_team.sql`
- Modify: `packages/db/drizzle/meta/_journal.json`
- Create: `packages/db/drizzle/meta/0016_snapshot.json`
- Test: `packages/services/tests/slack/credentials.test.ts`
- Test: `packages/services/tests/slack/dispatch.test.ts`
- Test: `apps/web/tests/features/settings/integrations-connect-slack.test.ts`
- Test: `apps/web/tests/app/api/integrations/slack/route.test.ts`

**Interfaces:**
- Produces: `encryptSlackBotToken(input: { organizationId: string; integrationId: string; token: string }): SlackCredentialEnvelope`
- Produces: `decryptSlackBotToken(credentials: unknown, input: { organizationId: string; integrationId: string }): string | null`
- Produces: `hasSlackBotToken(credentials: unknown): boolean`
- Produces: `assertSlackIntegrationManager(database, input): Promise<void>`
- Consumes: `slackIntegrationEnabledForOrganization(organizationId)` before OAuth exchange.

- [ ] **Step 1: Write failing credential and OAuth tests**

Test a round trip, random ciphertext for the same token, rejection when organization or integration AAD changes, legacy plaintext reads, encrypted writes from `ensureSlackIntegration`, authority rejection before provider fetch, raw `action: install` rejection, and a conflict when a Slack team is already bound to another Orbit organization.

```ts
const encrypted = encryptSlackBotToken({
  organizationId: 'org_noveum',
  integrationId: 'int_slack',
  token: 'xoxb-test-only',
});
expect(JSON.stringify(encrypted)).not.toContain('xoxb-test-only');
expect(
  decryptSlackBotToken(
    { botToken: encrypted },
    { organizationId: 'org_noveum', integrationId: 'int_slack' },
  ),
).toBe('xoxb-test-only');
```

- [ ] **Step 2: Run the failing tests**

Run:

```bash
bun test packages/services/tests/slack/credentials.test.ts packages/services/tests/slack/dispatch.test.ts apps/web/tests/features/settings/integrations-connect-slack.test.ts apps/web/tests/app/api/integrations/slack/route.test.ts
```

Expected: FAIL because credentials are plaintext and the raw installation action exists.

- [ ] **Step 3: Implement the credential envelope**

Use `node:crypto` `hkdfSync`, `randomBytes`, `createCipheriv`, and `createDecipheriv`. Derive 32 bytes from `BETTER_AUTH_SECRET`, an empty salt, and UTF-8 info `orbit/slack/bot-token/v1`. Use algorithm `aes-256-gcm`, a 12-byte IV, a 16-byte authentication tag, base64url fields, version `1`, and AAD `${organizationId}\u0000${integrationId}\u0000slack`. Throw a domain-safe internal error when the required secret is absent or an envelope cannot authenticate. Accept a legacy string only for reads.

Generate the integration ID before encryption. Replace direct credential reads in settings and notification eligibility with `hasSlackBotToken`. Replace token equality checks with decryption inside the Slack service. Remove expected plaintext-token SQL comparison from reauthorization and retain integration version matching.

- [ ] **Step 4: Harden OAuth and team ownership**

Remove `slackInstallSchema` and the `install` union branch. Check current integration-manager authority and workspace availability before the provider exchange and again under locks before persistence. Change the Slack team expression index to unique and generate migration `0016_secure_slack_team.sql` with `bun run db:generate --name secure_slack_team`. Convert a claimed-team collision into a conflict response.

- [ ] **Step 5: Run focused tests and type checks**

Run:

```bash
bun test packages/services/tests/slack/credentials.test.ts packages/services/tests/slack/dispatch.test.ts apps/web/tests/features/settings/integrations-connect-slack.test.ts apps/web/tests/app/api/integrations/slack/route.test.ts
bun run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/services packages/shared packages/db apps/web
git commit -m "feat(slack): protect OAuth credentials"
```

### Task 3: Authorized channels and prompt event acknowledgement

**Files:**
- Modify: `packages/shared/src/validators/integration.ts`
- Modify: `packages/services/src/slack/index.ts`
- Modify: `packages/services/src/slack/dispatch.ts`
- Modify: `apps/web/src/features/settings/integrations-panel.tsx`
- Modify: `apps/web/src/app/api/integrations/slack/route.ts`
- Create: `apps/web/src/lib/integrations/slack-event-scheduler.ts`
- Modify: `apps/web/src/app/api/webhooks/slack/route.ts`
- Test: `packages/services/tests/slack/slack.test.ts`
- Test: `packages/services/tests/slack/dispatch.test.ts`
- Test: `apps/web/tests/app/api/integrations/slack/route.test.ts`
- Test: `apps/web/tests/app/api/webhooks/slack/route.test.ts`

**Interfaces:**
- Produces: `SlackClient.conversation(channelId: string): Promise<SlackChannel>`
- Changes: `slackConnectChannelSchema` accepts `channelId` and `teamId`, not `channelName`.
- Changes: `resolveIssueUnfurls(database, organizationId, urls, teamId?: string): Promise<SlackUnfurl>`
- Produces: `scheduleSlackEventProcessing(task: () => Promise<void>): void`

- [ ] **Step 1: Write failing authorization and acknowledgement tests**

Test that channel connection rejects a channel the bot has not joined, persists Slack's canonical name instead of client metadata, unmapped channels never call `chat.unfurl`, team mappings hide other teams' issues, workspace-wide mappings permit all teams, the response resolves before a deferred provider call, duplicate and in-progress deliveries return 200, and issue blocks contain no Assign to me or Mark done buttons.

```ts
const response = await POST(signedLinkShared('T-OAUTH'));
expect(response.status).toBe(200);
expect(scheduled).toHaveLength(1);
expect(providerRequests).toEqual([]);
await scheduled[0]?.();
expect(providerRequests).toHaveLength(1);
expect(JSON.stringify(issueBlocks(issue))).not.toContain('orbit_assign_self');
expect(JSON.stringify(issueBlocks(issue))).not.toContain('orbit_mark_done');
```

- [ ] **Step 2: Run the failing tests**

Run:

```bash
bun test packages/services/tests/slack/slack.test.ts packages/services/tests/slack/dispatch.test.ts apps/web/tests/app/api/integrations/slack/route.test.ts apps/web/tests/app/api/webhooks/slack/route.test.ts
```

Expected: FAIL because channel metadata is client-controlled, unfurls are organization-wide, state-changing buttons render, and the route waits for Slack.

- [ ] **Step 3: Implement canonical channel mapping**

Add `conversations.info` response validation and `SlackClient.conversation`. On connect, load the Slack context, fetch the channel, require `isMember`, and persist its returned ID and name. Remove `channelName` from the client request and shared validator.

- [ ] **Step 4: Enforce unfurl authorization and remove actions**

Resolve exactly one enabled `slack_channel_sync` row for the integration and event channel. Return without issue lookup when no mapping exists. Pass a non-null mapped team ID into `resolveIssueUnfurls` and add `eq(issue.teamId, teamId)` to its issue query. Treat null as explicit workspace scope. Remove the entire actions block from `issueBlocks`.

- [ ] **Step 5: Acknowledge before provider work**

Implement the scheduler with Next.js `after()`. Keep signature verification, parsing, URL verification, and event claiming in the request. Schedule `processLinkShared` after a successful claim and immediately return `{ ok: true }`. Return the same 200 response for duplicates and fresh in-progress claims. Preserve claim-aware finalization.

- [ ] **Step 6: Run focused tests and type checks**

Run:

```bash
bun test packages/services/tests/slack/slack.test.ts packages/services/tests/slack/dispatch.test.ts apps/web/tests/app/api/integrations/slack/route.test.ts apps/web/tests/app/api/webhooks/slack/route.test.ts
bun run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/shared packages/services apps/web
git commit -m "feat(slack): authorize mapped channel unfurls"
```

### Task 4: Operator documentation and verification

**Files:**
- Modify: `docs/integrations.md`
- Modify: `docs/configuration.md`
- Modify: `docs/open-source-readiness.md`
- Modify: `docs/superpowers/plans/2026-08-30-slack-canary.md`

**Interfaces:**
- Consumes: the rollout variable, OAuth flow, encryption behavior, channel policy, and webhook behavior from Tasks 1 through 3.

- [x] **Step 1: Update operator documentation**

Document `SLACK_ENABLED_ORGANIZATION_ID`, the production redirect URL, the eight bot scopes already requested by Orbit, the webhook URL, `link_shared`, `orbit.noveum.ai`, bot invitation and mapping, reconnect behavior after `BETTER_AUTH_SECRET` rotation, and the launch order with the rollout unset during the first deploy.

- [ ] **Step 2: Run focused Slack tests**

Run:

```bash
cd packages/services
bun test tests/slack/credentials.test.ts tests/slack/slack.test.ts

cd ../../apps/web
bun test tests/features/settings/integrations-panel.test.tsx
```

These commands run the non-database Slack suites from their package roots, so
the web test preload applies. The Slack API, webhook, OAuth, and
`integrations-data` suites are database-backed; run them from `apps/web` only
after the test database is prepared. Do not report those database-backed suites
as passed when PostgreSQL is unavailable.

- [ ] **Step 3: Run repository verification**

Start PostgreSQL on port 5434, then run:

```bash
bun run db:test-setup
bun run verify
```

Expected: lint, comment policy, byte policy, Bun import policy, dependency policy, type checks, and tests all pass.

- [x] **Step 4: Check forbidden artifacts**

Run:

```bash
rg -n "Co-Authored-[B]y|Generated wit[h]" .env.example apps packages docs/superpowers/specs/2026-08-30-slack-canary-design.md docs/superpowers/plans/2026-08-30-slack-canary.md docs/integrations.md docs/configuration.md docs/open-source-readiness.md
```

Expected: no output.

- [x] **Step 5: Commit**

```bash
git add docs
git commit -m "docs: document Slack canary operations"
```

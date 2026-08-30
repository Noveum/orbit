# Slack Noveum Canary Design

## Goal

Enable Orbit's existing Slack integration for exactly one Orbit organization and the Noveum Slack workspace without exposing Slack controls to other Orbit organizations or accepting unscoped Slack events.

## Scope

The canary supports administrator OAuth installation, bot-joined channel mapping, pull request channel notifications, personal Slack notifications for the installing user, and issue link unfurls in explicitly mapped channels. It does not support public Slack app distribution, Socket Mode, slash commands, or interactive issue mutations.

## Rollout boundary

`SLACK_ENABLED_ORGANIZATION_ID` is the exact server-side allowlist for the canary. An absent or malformed value keeps every Slack surface unavailable. Server-loaded settings decide whether the Slack card renders. Authenticated routes check the current principal organization, the callback checks the organization recovered from one-time OAuth state, workers filter to the allowed organization, and signed Slack events check the organization resolved from the Slack team integration.

The existing shared compile-time flag remains disabled so Slack cannot become global by accident. Web application code opts into Slack only after the organization check succeeds.

The Slack app remains undistributed and associated with the Noveum workspace. A Slack team may belong to only one Orbit organization. The database enforces that ownership and OAuth reports a conflict if another organization already owns the team.

## OAuth and credentials

Only the OAuth v2 flow may install Slack. The raw bot-token installation action is removed. Orbit verifies that the installer is still an administrator and that workspace deletion is not pending before exchanging the authorization code, then verifies the same authority again while persisting the integration.

Bot tokens use a versioned AES-256-GCM envelope in `integration.credentials`. A 32-byte key is derived from the required `BETTER_AUTH_SECRET` with HKDF-SHA256 and a Slack-specific context. Each envelope uses a random 12-byte IV. Additional authenticated data binds the ciphertext to the Orbit organization ID, integration ID, and provider. Newly written tokens are always encrypted. Legacy plaintext credentials remain readable only so an existing installation can reconnect and replace them.

Rotating `BETTER_AUTH_SECRET` requires reconnecting Slack. The settings UI detects an encrypted credential without exposing or decrypting it. Decryption stays inside the Slack service.

## Channel authorization

The connect request accepts only a Slack channel ID and an optional Orbit team ID. Orbit obtains the canonical channel name and bot membership from Slack before persisting a mapping. A channel not visible to the bot or not joined by the bot cannot be mapped.

An inbound `link_shared` event must match one enabled channel mapping for the resolved integration. A team mapping may only load issues from that Orbit team. A workspace-wide mapping with a null team ID explicitly permits all teams in the allowed Orbit organization. Unmapped channels produce no unfurl.

The first canary unfurl contains only the issue link and read-only issue details. The unimplemented Assign to me and Mark done buttons are removed.

## Event handling

Slack request signatures and the five-minute replay window remain mandatory. URL verification responds synchronously. Event callbacks claim their event ID in `webhook_delivery`, schedule processing with Next.js `after()`, and return HTTP 200 before any Slack Web API call. Duplicate, processed, failed, and currently claimed event deliveries acknowledge with HTTP 200. Claim ownership prevents a stale processor from overwriting a newer result.

The Slack manifest keeps Event Subscriptions and unfurl domains disabled until the hardened deployment is live. After deployment, the request URL is `https://orbit.noveum.ai/api/webhooks/slack`, the bot event is `link_shared`, and the unfurl domain is `orbit.noveum.ai`.

## Failure behavior

Missing rollout configuration returns 404 without reading Slack payloads. A configured but unauthorized Orbit organization also receives 404. Invalid Slack signatures return 401. Unknown, ambiguous, disallowed, or unmapped Slack teams and channels acknowledge without sending data. Provider failures are recorded on the claimed delivery and never expose tokens in logs or responses.

## Testing

Tests cover the absent rollout boundary, allowed and denied organizations, OAuth authority before provider exchange, encrypted token round trips and AAD binding, raw install rejection, canonical joined-channel mapping, unique Slack team ownership, mapped-team unfurls, unmapped-channel silence, fast acknowledgement, replay handling, and removal of interactive controls. Focused Slack tests must pass before the full repository verification. The final `bun run verify` requires the repository test database on port 5434.

## Deployment

Deploy code and database migration with `SLACK_ENABLED_ORGANIZATION_ID` absent. Add the exact Noveum Orbit organization ID in Vercel Production, redeploy, and connect from Orbit Settings as an administrator. Invite the Orbit bot to one controlled Slack channel, map that channel, and test outbound notifications. Only then enable Event Subscriptions and the unfurl domain in Slack and test a mapped Orbit issue link.

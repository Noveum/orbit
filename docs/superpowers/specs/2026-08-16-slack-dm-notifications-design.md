# Slack Direct Message Notifications Design

## Goal

Deliver Orbit notifications intended for one person as Slack direct messages while keeping team and project notifications in configured Slack channels.

## Scope

This design implements Issue #191. It covers Slack user mapping, the `slack_dm` notification preference, personal-versus-team routing, quiet-hours behavior, missing-user behavior, `im:write` authorization detection and reauthorization messaging, documentation, and regression tests.

It does not redesign the existing channel synchronization flow or add a general Slack administration console.

## Architecture

The existing Slack integration remains the source of the bot token and organization-level connection. A small mapping table associates an Orbit user with a Slack user ID for that organization. The mapping is refreshed during Slack authorization and can be selected by the Orbit user in notification settings.

Notification planning continues to use the audience calculated by `packages/core/src/notifications/audience.ts`. The planner distinguishes personal events from team or project events. A personal event can produce Inbox, Email, and Slack DM deliveries according to independent preferences. Team or project events continue to produce channel deliveries through the existing `slack` channel.

Slack DM delivery opens a conversation with the mapped Slack user using `conversations.open`, then sends the rendered notification using `chat.postMessage`. The Slack client validates all external responses through existing Zod schemas.

## Data model

Add the minimum fields needed to support the mapping and authorization state:

- A workspace-scoped Slack user mapping with Orbit user ID, Slack integration ID, Slack user ID, display name, and timestamps.
- The authorized Slack scope set on the Slack integration, so settings can distinguish an old installation from one that has `im:write`.
- `slack_dm` as a notification preference channel while preserving existing `slack` channel preferences.

Mappings are unique per integration and Slack user, and per organization and Orbit user. Deleting an Orbit user or Slack integration removes its mappings.

## Authorization and settings behavior

- The Slack OAuth request includes `im:write`.
- Existing integrations without `im:write` remain usable for channel notifications.
- The settings page shows Slack DM as unavailable until the integration has `im:write` and the current user has a mapping.
- When `im:write` is missing, the settings page offers the existing Slack reauthorization path and explains that the app must be reauthorized.
- When no mapping exists, the settings page shows an unavailable state rather than an enabled or disabled toggle.
- Saving preferences never creates a mapping implicitly and never treats an unmapped user as an error.

## Notification routing

- Personal events: assignment, mention, subscribed-item comment, and review request use the existing audience result and may deliver to Inbox, Email, and Slack DM independently.
- Team or project events: sprint, project, release, and other broadcast events continue to use the existing Slack channel path.
- A personal event with Slack DM enabled does not also post to the team channel.
- A recipient without a Slack mapping receives no DM and the other enabled channels continue normally.
- Quiet hours apply to Slack DM in the same notification plan as Email. Urgent assignment uses the existing urgent bypass setting.
- A failed Slack DM is logged and does not fail the database notification transaction or suppress other channels.

## Slack client behavior

Add a typed `conversations.open` method to the Slack client. It accepts one Slack user ID and returns a DM channel ID. The existing `chat.postMessage` method sends the notification to that channel. All responses use Zod validation and existing error handling.

The notification dispatch layer resolves the integration token and mapping in one database read per recipient batch where practical. It skips missing mappings, logs provider failures, and returns delivery counts for tests and observability.

## Testing

Tests must be written before implementation and must be observed failing for the missing behavior.

Required coverage:

1. A personal event with `slack_dm` enabled produces a DM dispatch and no channel dispatch.
2. A team or project event continues to produce a channel dispatch.
3. An unmapped recipient produces no DM and does not fail notification creation.
4. Quiet hours suppress a DM in the same way they suppress Email.
5. Inbox, Email, and Slack DM preferences are independent and do not double-deliver.
6. `conversations.open` and `chat.postMessage` receive the expected Slack user/channel IDs and content.
7. Missing `im:write` is surfaced as a reauthorization-required state.
8. Existing integrations and existing `slack` channel preferences remain compatible.

Integration tests use the repository's real test database and injected fetch handlers for Slack HTTP calls. No test relies on a live Slack workspace.

## Documentation

Update `docs/integrations.md` with the `im:write` scope, reauthorization requirement, user mapping behavior, and the distinction between channel and DM notifications.

## Compatibility and failure policy

Existing Slack channel notifications remain unchanged. Existing integrations without the new scope continue channel delivery and receive an actionable reauthorization prompt. Slack DM failures are non-fatal to notification creation and are logged with organization, recipient, and provider error context without logging tokens or message secrets.

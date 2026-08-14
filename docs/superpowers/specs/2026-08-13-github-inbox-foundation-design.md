# GitHub Inbox Foundation Design

## Problem

Orbit receives GitHub webhooks, but the current integration only creates a pull request link when an event names an existing Orbit issue. Notifications point back to the Orbit issue and omit the GitHub URL. Existing pull requests are not imported when a repository becomes watched, and pull request comments and inline review comments are unsupported.

The result is a Pull requests experience that looks like a GitHub inbox but behaves as a narrow issue automation feed.

## Scope

This change establishes a first-class pull request experience:

- Carry a dedicated external GitHub URL on notifications.
- Present GitHub as the primary destination for pull request notifications while retaining the related Orbit issue link.
- Accept pull request conversation comments and inline review comments.
- Backfill open pull requests when a repository becomes watched or an administrator explicitly refreshes GitHub repositories.
- Restrict pull request reads and notification audiences to current workspace and team access.
- Make webhook delivery claiming exclusive so one delivery cannot execute concurrently twice.
- Document the additional GitHub App event subscriptions.
- Store every open pull request from a watched repository independently of Orbit issues.
- Store lifecycle, review, comment, review thread and check history as normalized activity.
- Show linked Orbit tasks and projects as optional context instead of a prerequisite.

## Notification destinations

The notification row gains nullable `external_url`. `url` remains the internal Orbit route for compatibility. Pull request events set `external_url` to the most specific GitHub destination available:

- Pull request lifecycle and review request: pull request URL
- Submitted review: review URL
- Conversation comment: comment URL
- Inline review comment: inline comment URL
- Failed checks: pull request URL when GitHub supplies a pull request number

The inbox renders `Open on GitHub` for pull request notifications when `external_url` exists. The related Orbit issue remains a separate `Open issue` action. Selecting a pull request notification shows a compact GitHub event summary before the linked issue context rather than presenting the issue as if it were the event itself.

## Event handling

The normalizer covers `pull_request`, `pull_request_review`, `issue_comment`, `pull_request_review_comment`, `pull_request_review_thread`, `check_suite`, `check_run`, `status` and `workflow_run`. An `issue_comment` is accepted only when the payload contains the GitHub pull request marker. Events normalize immutable repository identity, pull request identity, actor, timestamps and their most specific GitHub destination.

Comment events resolve an existing pull request link by immutable repository ID plus pull request number. They do not scan arbitrary comment text for Orbit issue identifiers. This prevents a comment from linking a pull request to an unrelated issue merely because somebody mentioned an identifier in conversation.

## Backfill

The GitHub App client gains a paginated open-pull-request reader using the existing read-only Pull requests permission. Backfill runs after a repository association commits and after an explicit repository refresh. Network calls never run inside the association transaction.

Each imported pull request is passed through the same normalizer and application logic as a webhook. Backfill suppresses notifications so connecting a repository does not flood the inbox with historical events. It creates the first-class mirror for every open pull request and creates task links only when the explicit issue-link contract is satisfied.

Opening a pull request detail page performs a read-only history reconciliation for conversation comments, submitted reviews, inline review comments and check runs. Activity rows use GitHub object identities as idempotency keys. Webhook lifecycle keys also include the action and event timestamp so distinct state changes do not overwrite each other.

Failures are isolated per repository and returned to the caller as refresh diagnostics without rolling back the repository association.

## Authorization

Pull request rows are visible to current workspace members. Linked task and project context is included only when an administrator or current team member may read it. This keeps the PR mirror useful workspace-wide without exposing private team data.

Notification audiences are intersected with current workspace membership and current team access inside the same database transaction that creates notifications. Administrators retain workspace-wide access. Removed members and users removed from a private team are excluded.

When no Orbit task is linked, review requests notify the mapped requested reviewer. Comments, reviews, failed checks, merge and close events notify the mapped pull request author. These audiences are intersected with current workspace membership, and the GitHub actor is removed by the notification service.

## Delivery claiming

A new delivery is inserted directly into `processing` with a claim timestamp. Existing `received` and `failed` deliveries, plus `processing` deliveries whose lease expired, can be reclaimed atomically. An active claim returns an in-progress response without executing domain effects. Terminal `processed` and `ignored` deliveries never become eligible again through ordinary webhook receipt.

Manual replay is a separate future operation with its own authorization and audit trail.

## Validation

- Service tests prove event parsing, lifecycle idempotency, first-class persistence, historical reconciliation, audience filtering, and exclusive claiming behavior.
- Web tests prove workspace PR visibility, team-scoped task context, pull request detail activity, and both GitHub and Orbit destinations in the inbox.
- The full `bun run verify` suite must pass.
- Browser verification captures the pull request notification detail at desktop and narrow viewport sizes with no framework error overlay.

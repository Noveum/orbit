# GitHub Inbox Foundation Design

## Problem

Orbit receives GitHub webhooks, but the current integration only creates a pull request link when an event names an existing Orbit issue. Notifications point back to the Orbit issue and omit the GitHub URL. Existing pull requests are not imported when a repository becomes watched, and pull request comments and inline review comments are unsupported.

The result is a Pull requests experience that looks like a GitHub inbox but behaves as a narrow issue automation feed.

## Scope

This change establishes a safe first foundation for the richer GitHub experience:

- Carry a dedicated external GitHub URL on notifications.
- Present GitHub as the primary destination for pull request notifications while retaining the related Orbit issue link.
- Accept pull request conversation comments and inline review comments.
- Backfill open pull requests when a repository becomes watched or an administrator explicitly refreshes GitHub repositories.
- Restrict pull request reads and notification audiences to current workspace and team access.
- Make webhook delivery claiming exclusive so one delivery cannot execute concurrently twice.
- Document the additional GitHub App event subscriptions.

This change does not create the final normalized all-pull-request mirror. Unlinked pull requests remain outside Orbit until the follow-up storage project adds `github_pull_request` and `github_pull_request_activity` as first-class records. Keeping that schema and retention decision separate makes this foundation reviewable and deployable on its own.

## Notification destinations

The notification row gains nullable `external_url`. `url` remains the internal Orbit route for compatibility. Pull request events set `external_url` to the most specific GitHub destination available:

- Pull request lifecycle and review request: pull request URL
- Submitted review: review URL
- Conversation comment: comment URL
- Inline review comment: inline comment URL
- Failed checks: pull request URL when GitHub supplies a pull request number

The inbox renders `Open on GitHub` for pull request notifications when `external_url` exists. The related Orbit issue remains a separate `Open issue` action. Selecting a pull request notification shows a compact GitHub event summary before the linked issue context rather than presenting the issue as if it were the event itself.

## Event handling

The normalizer adds `issue_comment` and `pull_request_review_comment` parsers. An `issue_comment` is accepted only when the payload contains the GitHub pull request marker. Both event types normalize repository identity, pull request number and title, actor, comment body, and comment URL.

Comment events resolve an existing pull request link by immutable repository ID plus pull request number. They do not scan arbitrary comment text for Orbit issue identifiers. This prevents a comment from linking a pull request to an unrelated issue merely because somebody mentioned an identifier in conversation.

## Backfill

The GitHub App client gains a paginated open-pull-request reader using the existing read-only Pull requests permission. Backfill runs after a repository association commits and after an explicit repository refresh. Network calls never run inside the association transaction.

Each imported pull request is passed through the same normalizer and application logic as a webhook. Backfill suppresses notifications so connecting a repository does not flood the inbox with historical events. It updates links and issue state only for pull requests that satisfy the existing explicit issue-link contract.

Failures are isolated per repository and returned to the caller as refresh diagnostics without rolling back the repository association.

## Authorization

Pull request rows are visible when the principal is an administrator or currently belongs to the linked issue team. Creator and assignee identity alone never bypasses team access.

Notification audiences are intersected with current workspace membership and current team access inside the same database transaction that creates notifications. Administrators retain workspace-wide access. Removed members and users removed from a private team are excluded.

## Delivery claiming

A new delivery starts in `received`. Processing atomically moves it to `processing` only when its current state is `received` or `failed`. Requests that cannot make that transition return duplicate without executing domain effects. Terminal `processed` and `ignored` deliveries never become eligible again through ordinary webhook receipt.

Manual replay is a separate future operation with its own authorization and audit trail.

## Validation

- Service tests prove comment parsing, comment-to-existing-link resolution, historical backfill, audience filtering, and exclusive claiming behavior.
- Web tests prove team-scoped pull request reads and both GitHub and Orbit destinations in the inbox.
- The full `bun run verify` suite must pass.
- Browser verification captures the pull request notification detail at desktop and narrow viewport sizes with no framework error overlay.


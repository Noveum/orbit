# Notification and Inbox Reliability Overhaul Design

## Status

Proposed for product and engineering review. Implementation starts only after the behavior and
rollout decisions in this document are accepted.

## Problem

Orbit currently stores one inbox row per recipient and notification event. A busy pull request can
therefore produce separate rows for comments, inline comments, reviews, review requests, lifecycle
changes and failed checks. The same pull request may also use an Orbit issue as its entity in one
event and the mirrored GitHub pull request in another. The inbox has no durable subject identity
that can group those rows.

There are reliability gaps beneath the visible duplication:

- GitHub domain effects and notifications commit before the webhook delivery is marked processed.
  A process failure in that gap lets the same delivery be reclaimed after its lease expires.
- Notification deduplication is a 60 second lookup over type, entity and URL rather than a database
  uniqueness guarantee tied to the source event.
- A pull request linked to more than one Orbit issue can create one notification event per link for
  the same recipient.
- CI activities are rolled up across historical check rows without limiting them to the current pull
  request head SHA. Check runs, suites, workflow runs and commit statuses can each report the same
  underlying failure.
- Inbox tabs filter a raw page of 50 rows in the browser. A large run of pull request or status rows
  can starve another tab even when matching notifications exist on later pages.
- Read, snooze and delete state belongs to individual rows. Realtime deletes are not recoverable by
  catchup, and optimistic badge arithmetic can drift from the server.
- Slack direct messages have a durable delivery row, but each event is a new top-level message.
  Slack channel sends are synchronous after commit, errors do not fail the webhook, and only the
  first event title is used when one webhook creates several notifications.

The result is an inbox that is noisy, hard to trust and unable to drive a coherent Slack thread.

## Goals

- Show one inbox conversation per subject and notification family, with an immutable event history.
- Group every event for one GitHub pull request into one conversation for each recipient, regardless
  of event type, URL or linked Orbit issue.
- Make source event ingestion idempotent with database constraints, including webhook redelivery and
  worker reclaim after a process failure.
- Count unread conversations rather than unread event rows.
- Apply Activity, Status, Unread, Mentions and Pull requests filters in the database before
  pagination.
- Scope CI state and failure notifications to the current pull request head SHA.
- Deliver Slack notifications through a durable outbox and keep later events in the same Slack
  thread for that destination and conversation.
- Report Slack and notification-email delivery only after provider confirmation.
- Preserve web, realtime and MCP behavior during a phased migration.
- Keep every authorization decision on the server and scoped to current workspace and team access.

## Non-goals

- A machine-learned priority inbox or user-configurable ranking.
- A second notification preference system.
- Slack actions that mutate Orbit or GitHub.
- Combining unrelated Orbit issues merely because their titles or URLs look similar.
- Replacing GitHub's pull request timeline. Orbit keeps the notification events needed to explain an
  inbox conversation and links to GitHub for the complete source history.
- Product analytics or telemetry that leaves the installation.
- Deleting historical event rows during the first rollout.

## Behavioral decisions

### Conversation identity

Every event receives a canonical conversation key before recipient planning:

| Subject | Conversation key |
| --- | --- |
| GitHub pull request | `github-pr:<repository-id>:<number>` |
| Orbit issue activity | `orbit-issue:<issue-id>:activity` |
| Orbit issue field changes | `orbit-issue:<issue-id>:status` |
| Orbit document activity | `orbit-doc:<doc-id>:activity` |
| Orbit project activity | `orbit-project:<project-id>:activity` |
| Invitation or membership event | A stable domain key for that invitation or membership |
| Unresolvable legacy row | `legacy-notification:<notification-id>` |

Pull request events always use the mirrored pull request as the canonical subject. Linked Orbit
issues remain related context resolved from `git_link`; they do not change the conversation key and
do not multiply notifications.

Issue field changes stay separate from issue activity. This preserves the current Activity and
Status distinction while still collapsing repeated status changes into one subject conversation.
Every GitHub pull request conversation has the fixed `activity` category, including failed checks.
It also appears in Pull requests by subject type. The Status category is reserved for Orbit issue
field-change conversations, so mixed pull request history never makes category backfill ambiguous.

### Read, snooze and dismiss

- A conversation is unread when it contains at least one inbox event after its last read action or
  has an explicit manual-unread override.
- Marking a conversation read sets both unread event counts to zero and clears manual unread in the
  same transaction.
- Marking a conversation unread sets `manual_unread` without inventing an unread event or mention.
  The conversation counts once in the unread badge, while its unread event and mention counts remain
  zero until real activity arrives.
- Manual unread on an activity conversation increments total unread and unread activity. Manual
  unread on a status conversation increments only total unread. Neither form increments unread
  mentions.
- A newly inserted live event makes the conversation unread, clears a prior dismissal and clears a
  snooze so important new activity resurfaces.
- A backfill or stale event can extend history without changing unread, snooze or dismissal state.
- Delete in the UI becomes a soft dismissal of the conversation. Event history remains available for
  idempotency, audit and future activity.
- The header badge and tab counts count conversations, not event rows.
- Snoozed and dismissed conversations are excluded from visible counters without clearing their
  underlying unread state. Dismiss, snooze, wake and resurface transactions update every affected
  counter and its version atomically.
- Access-hidden conversations are also excluded from rows and counters. Regaining canonical-subject
  access clears `access_hidden_at`, advances its generation and restores counters from current unread,
  snooze and dismissal state without changing event read history.

### Tabs

- Activity contains conversations whose fixed category is activity.
- Status contains conversations whose fixed category is status.
- Unread contains every unread, visible conversation.
- Mentions contains conversations with at least one mention event. Its badge counts conversations
  with unread mention events.
- Pull requests contains conversations whose subject type is `github_pull_request`.
- Snoozed conversations are excluded until the snooze expires or a new live event arrives.
- Dismissed conversations are excluded until a new live event arrives.
- Access-hidden conversations are excluded until current policy grants the recipient access again.

Filters are server-side and use an opaque cursor over `(last_activity_seq, id)`. Every page contains up
to the requested number of matching conversations, so a noisy category cannot starve another tab.

## High-level architecture

```text
GitHub webhook or Orbit domain mutation
                |
                v
      Normalize source identity
                |
                v
  One PostgreSQL transaction
    - apply domain changes
    - insert immutable recipient events
    - upsert inbox conversations
    - enqueue provider deliveries
    - finalize webhook delivery
                |
                +----------------------+
                |                      |
                v                      v
       publish conversation      claim durable outbox
       realtime deltas           deliveries with leases
                |                      |
                v                      v
          Web and MCP          Slack API or Resend
                                      |
                                      v
                           store provider identity
```

The database transaction is the durable boundary. Realtime publication and provider calls happen
after commit. A publication failure is recoverable through sync catchup, and a provider failure is
recoverable through the outbox lease and retry policy.

## Data model

### `notification_source_event`

One row identifies one semantic domain or provider event before recipient fanout. It is also the
idempotency tombstone that survives inbox dismissal, legacy row deletion and future event pruning.

| Column | Purpose |
| --- | --- |
| `id` | UUIDv7 primary key |
| `organization_id`, `source_event_key` | Tenant-scoped immutable source identity |
| `source_delivery_id` | Provider delivery identity when one exists |
| `subject_type`, `subject_key` | Canonical subject known before recipient fanout |
| `occurred_at` | Provider or domain occurrence time for display |
| `ingested_at`, `ingestion_seq` | Orbit ingestion time and sequence |
| `payload` | Shared-schema-validated normalized event snapshot |
| `pruned_at`, timestamps | Retention state and operations |

Unique `(organization_id, source_event_key)` is the exact ingestion gate. The source row is never
deleted by an inbox action. If event payload retention is added later, pruning clears the payload but
retains the source identity as a tombstone.

### `notification_conversation`

One row represents one recipient's inbox state for one canonical conversation key.

| Column | Purpose |
| --- | --- |
| `id` | UUIDv7 primary key and public conversation id |
| `organization_id`, `user_id` | Tenant and recipient boundary |
| `conversation_key` | Stable subject and family identity |
| `subject_type`, `subject_id` | Canonical entity used for policy and rendering |
| `category` | Fixed `activity` or `status` value |
| `latest_event_id` | Most recently surfaced event by ingestion order |
| `latest_type`, `latest_actor_name` | List row snapshot |
| `latest_title`, `latest_body` | List and detail snapshot |
| `latest_url`, `latest_external_url` | Orbit and provider destinations |
| `latest_occurred_at` | Provider or domain occurrence time displayed to the user |
| `event_count` | Number of retained inbox events in the conversation |
| `unread_event_count` | Events received since the last read action |
| `unread_mention_count` | Mention events received since the last read action |
| `manual_unread` | Explicit unread override when no unread event remains |
| `last_mention_at` | Enables the Mentions tab without scanning history |
| `read_at` | Last explicit read action |
| `snoozed_until`, `dismissed_at` | Conversation-level visibility state |
| `access_hidden_at`, `access_generation` | Policy-driven visibility and restoration fence |
| `snooze_generation` | Fence for durable wake jobs and resnooze races |
| `last_activity_seq`, `last_activity_at` | Sequence for ordering plus ingestion time for display |
| `sync_id`, timestamps | Realtime catchup and operations |

Constraints and indexes:

- Unique `(organization_id, user_id, conversation_key)`.
- List index beginning with `(organization_id, user_id, category, last_activity_seq, id)`.
- Separate partial indexes for unread, mentions and pull requests where they improve measured query
  plans. Snooze lookup uses an ordinary `(organization_id, user_id, snoozed_until)` index or an
  immutable `snoozed_until IS NOT NULL` predicate, never a time-dependent index predicate.
- Check constraints keep counts non-negative and keep category within the supported values.
- Composite unique keys support tenant-safe event and conversation foreign keys.

### `notification_inbox_state`

One row per organization and user stores authoritative visible unread conversation, unread activity
and unread mention counts plus a `sync_id` counter version. Snoozed, dismissed and access-hidden rows
do not contribute. Every operation that can change those counts locks this row before locking
conversation rows in a stable key order. List, mutation and realtime payloads include the state
version, and clients ignore any counter snapshot older than the highest version already applied.

### `notification_snooze_wake`

One durable wake row is keyed by conversation id and snooze generation. It stores `wake_at`, lease
state, `claim_token`, attempts and completion state. Setting or extending a snooze increments the
conversation generation and enqueues its matching wake row in the same transaction. Explicitly
clearing snooze, dismissal and new live activity also advance the generation. A bounded worker claims
due rows, locks inbox state before the conversation, and clears the snooze only when both the
generation and `snoozed_until` still match. It then updates counters and versions and publishes a
non-sensitive visibility delta after commit. Older wake rows become unavailable rather than waking a
resnoozed, dismissed or newly active conversation.

### `notification`

The existing table becomes an immutable recipient event log. Expand migrations add nullable columns
so old and new code can coexist:

- `conversation_id`
- `source_event_id`
- `occurred_at`
- `ingested_at`
- `ingestion_seq`
- `surface_in_inbox`
- `dismissed_at`
- `manual_unread_anchor`

`manual_unread_anchor` is a temporary compatibility marker. It is true only when a
conversation-level manual-unread action must project into the legacy model by clearing the newest
active sibling's `read_at`. Folding treats that row as the manual override rather than as an unread
event. A legacy event-level unread action clears `read_at` with the marker false, so it remains a real
unread event. Mark-read and new live activity clear every stale anchor in the conversation.

The recipient constraint is unique `(source_event_id, user_id)`. The application uses
`INSERT ... ON CONFLICT DO NOTHING RETURNING`, and only returned recipient rows can change a
conversation or enqueue a direct-message delivery. The old 60 second dedupe window is removed after
all producers create durable source events.

Source keys describe the originating domain event, not its presentation. Examples include a GitHub
delivery and normalized activity identity, an Orbit comment id and create action, or an issue sync id
and changed field. A GitHub key never includes a linked Orbit issue id, so link fanout cannot create
duplicates for one recipient.

`occurred_at` records provider or domain time for display. `ingestion_seq` comes from a database
sequence after the relevant conversation row is locked and is the monotonic activity and read-order
boundary. `ingested_at` is the human-readable ingestion time. Delayed provider timestamps therefore
cannot move a conversation backward, corrupt a cursor or make a previously read event appear newer
than it was ingested.

During backfill, `surface_in_inbox` is exactly the legacy
`delivered_channels @> '["inbox"]'::jsonb` result. Email-only and Slack-only historical rows never
appear in the inbox by accident. Conversation counts and latest snapshots use only surfaced rows.
Phase 1 adds `dismissed_at` to the legacy row before hard delete is removed. Phase 2 dual-writes and
backfills that value into conversation state without changing `surface_in_inbox` or deleting event
history.

The event has a tenant-safe composite foreign key to its conversation. The conversation's nullable
`latest_event_id` has the inverse tenant-safe composite foreign key. A conversation is created with
no latest event, the recipient event is inserted, and only then is `latest_event_id` updated, so the
relationship does not require deferred constraints.

### `notification_delivery`

The existing delivery table becomes the durable provider outbox for Slack direct messages, Slack
channel messages and notification email. It gains:

- `organization_id`
- `source_event_id`
- `conversation_key`
- `destination_kind`
- `destination_id`
- `slack_team_id`, `slack_app_id`
- `credential_generation`
- `provider_request_id`
- `provider_message_id`
- `provider_payload`, `provider_payload_hash`
- `provider_idempotency_expires_at`
- `claim_token`, `claimed_at`, `lease_expires_at`
- `send_started_at`
- `dead_lettered_at`

`notification_id` and `user_id` remain required for a direct-message or email destination. They
become nullable for a shared channel destination, whose outbox row carries its own validated event
payload snapshot and must not be deleted because one representative user leaves the workspace.
Database checks enforce the required shape for each destination kind.

Slack destinations always carry their enqueue-time team and app identity. A worker compares those
values and the credential generation with the locked current integration before any provider call.
Every reconnect first enters a durable draining state that stops new claims. A reconnect to a
different team or app waits for active delivery and root leases to complete or become reconciled or
ambiguous, then atomically activates the new identity, marks old pending deliveries unavailable and
archives old thread rows. Rotation within the same provider namespace uses the same drain, preserves
eligible threads and still uses credential generation as a send-time race fence.

Unique `(organization_id, source_event_id, channel, destination_kind, destination_id)` prevents a
single source event from reaching the same destination more than once. A channel delivery is created
once per configured channel, not once per user notification. Existing lease, attempt and retry fields
remain the worker contract.

Delivery state has one meaning for every provider: `pending` is queued, `processing` is leased,
`delivered` has a confirmed provider identity, `failed` is retryable, `unavailable` is a permanent
recipient or configuration condition, `ambiguous` needs operator reconciliation, and `dead_letter`
exhausted its retry policy. During the
compatibility window, a channel is added to `notification.delivered_channels` only after provider
confirmation. The final model reads status from delivery rows and stops mutating that compatibility
field. Every notification provider uses these state meanings rather than being marked delivered at
planning time.

Every claim or reclaim writes a fresh UUID claim token. Completion and failure updates require both
the delivery id and active claim token and return the updated row. Zero returned rows means the lease
was lost and the worker cannot finalize provider state. A processing lease that expires after a
provider call may have succeeded, so it becomes `ambiguous` unless provider reconciliation or a
provider idempotency guarantee proves it was not sent. It is never converted blindly into an
ordinary retryable failure.

After a worker owns a delivery lease, its final provider preflight locks the canonical ACL or stable
parent-scope row first, then membership or destination-mapping rows and finally the delivery row.
Access-removal transactions use the same prefix before inbox state, conversations and affected
deliveries, so neither path holds a delivery while waiting for policy. The preflight re-evaluates
authorization and records `send_started_at` with the active claim token before releasing the database
connection. This is the delivery authorization linearization point. If revocation commits first,
provider contact is forbidden. If preflight commits first, the provider call is already in flight and
revocation cancels only later work. An expired lease with `send_started_at` and no confirmed provider
result is ambiguous.

Provider and destination shapes are explicit:

| Destination | Required identity | Send-time resolution and policy |
| --- | --- | --- |
| Slack direct message | `notification_id`, `user_id`, integration, team, app and mapped Slack user | Recheck current recipient access, `slack_dm` preference, membership and mapping; resolve or open the current DM channel |
| Slack shared channel | `source_event_id`, integration, team, app and enabled channel mapping | Recheck canonical-subject visibility against the mapping's workspace or team scope; no representative user owns the row |
| Notification email | `notification_id`, `user_id`, stable user destination and provider request id | Recheck current recipient access and email preference, then resolve the current verified address immediately before send |

The unique delivery key includes source event, provider and stable destination identity. Raw email
addresses are not uniqueness keys and are not frozen at enqueue time. The delivery id derives the
provider idempotency key, and the confirmed provider message id is stored on success.

There is no production notification email executor today. The overhaul therefore enqueues
notification email as another durable destination and adds a Resend worker before enabling email
delivery claims. Non-notification email can continue using its existing path. Orbit never marks an
email delivered merely because it was planned. Missing verified email, a disabled current
preference or lost subject access makes a queued email unavailable without contacting Resend.
The email worker uses the same claim-token and lease finalization contract as Slack, reloads the
source event, recipient and canonical subject after claim, and sends with the delivery-derived
idempotency key. Immediately before first provider contact it resolves the current verified address,
renders the validated request and atomically stores an encrypted immutable provider payload, its hash
and the provider idempotency expiry. Every retry uses that exact payload and key; an address change
never mutates an already attempted request. The frozen address must still be the recipient's current
verified address before a retry; otherwise a definitively unsent row becomes unavailable and a row
that may have reached Resend becomes ambiguous. A different-payload idempotency conflict is ambiguous.
Automatic retries stop before Resend's 24-hour key retention expires, and an unconfirmed delivery is
marked ambiguous rather than risking a duplicate after expiry. Only a confirmed Resend provider id
moves the row to delivered.

Existing Slack direct-message rows migrate under a paused worker after every active lease has either
completed or expired:

- `succeeded` becomes `delivered` and keeps provider channel and timestamp ids.
- `skipped` becomes `unavailable` with its existing reason.
- `pending` and `failed` are backfilled only when integration, Slack team, destination mapping and
  conversation are unambiguous; otherwise they become `unavailable` with a legacy-resolution reason.
- Expired legacy `processing` rows become `ambiguous` unless logs or provider reconciliation prove
  that no provider call began; only definitively unsent rows return to `failed` with attempts
  preserved.
- A provider-boundary uncertainty becomes the explicit `ambiguous` state and is never treated as
  ordinary retryable failure.

### `slack_notification_thread`

| Column | Purpose |
| --- | --- |
| `integration_id` | Slack workspace credential owner |
| `slack_team_id`, `slack_app_id` | Provider namespace that owns channel and message ids |
| `credential_generation` | Send-time fence for reconnect or token rotation races |
| `destination_kind`, `destination_id` | Channel or direct message destination |
| `conversation_key` | Orbit conversation identity |
| `channel_id` | Slack channel-like id returned by the API |
| `root_ts` | Parent message timestamp |
| `state` | `creating`, `ready`, `blocked`, `ambiguous` or `archived` |
| `created_by_delivery_id` | Delivery that owns root creation |
| `claim_token`, `claimed_at`, `lease_expires_at` | Fenced root-creation lease |
| `last_error` | Recoverable root-creation diagnostics |
| `sync_id`, timestamps | Recovery and inspection |

Unique `(integration_id, slack_team_id, slack_app_id, destination_kind, destination_id,
conversation_key)` guarantees one thread per Slack provider namespace, destination and Orbit
conversation. A token rotation for the same team and app can retain the thread, but every send is
fenced against the current credential generation. A team or app identity change starts a new thread
and cannot reuse old channel or timestamp ids.

For same-team and same-app rotation, the post-drain transaction increments the integration
generation, rebinds eligible pending and failed deliveries plus ready thread rows with
compare-and-swap updates, activates the new credential and resumes claims. A processing row is never
silently rebound across generations. For a team or app identity change, no old destination or thread
is rebound and the new namespace starts empty.

### `webhook_delivery` additions

Add a nullable `claim_token` during Phase 1. Every fresh claim or expired-lease reclaim writes a new
UUID and the existing lease timestamps in one compare-and-swap update. Success and failure
finalization both require the active token. Existing pending and failed rows receive a token only
when next claimed; existing processing rows keep their current lease and are reclaimed with a fresh
token after expiry. A stale claimant that cannot return its row from finalization must roll back its
domain effects transaction.

The rollout is fail-closed across old deployments. First pause new webhook claims, wait for every
old-handler processing lease to finish or expire, and verify that no tokenless row remains processing.
Then add and validate a check requiring a non-null token whenever status is `processing`, deploy the
token-aware claimant and resume. An old deployment can no longer claim under that constraint, and a
tokenless finalizer cannot update a freshly claimed row. The pause remains available for rollback
until every allowed deployment understands claim tokens.

### GitHub activity additions

`github_pull_request_activity` gains `head_sha`, `source_kind`, `context_key` and the normalized
provider update time. A `github_pull_request_check_context` row keyed by pull request, head SHA and
context key stores current state, provider update time, a monotonic context version, source event id,
reconciliation state and a fenced reconciliation lease. The pull request row gains a `head_epoch`,
normalized provider update time and head-reconciliation state. It remains the source of truth for
current `head_sha` and aggregate `check_status`.

`context_key` uses a versioned, length-delimited tuple encoding rather than concatenated display
text. A check run key is `(check_run, app_id, provider_name)` and preserves the validated provider
name exactly. A commit-status key is `(commit_status, case_fold(provider_context))` because GitHub's
native combined-status identity is case-insensitive and independent of the creator. The original
context and creator remain metadata for display and audit; neither a casing change nor a token or
user rotation creates a second current context. A rerun from the same app with the same check name
and head updates the same check-run context even when its check-run id changes. The same check name
from two apps remains separate. Check suites and workflow runs are reconciliation triggers and never
create context rows. Check-run and commit-status sources remain separate unless a future explicit
provider adapter declares a stable cross-source equivalence; the generic ingester never guesses that
equivalence. Missing check-run app identity or malformed keys mark the activity unresolved and
enqueue reconciliation instead of collapsing it into another context.

The context row itself is the durable reconciliation job: a bounded worker claims unresolved rows,
reloads the current GitHub context and conditionally resolves the row only when its claim token,
context version, pull request head SHA and head epoch still match. Head reconciliation uses the same
fenced pattern and reloads the authoritative pull request before changing the current head.

## Transaction and concurrency rules

Normalize the complete webhook or domain mutation into semantic events and precompute every
authorized recipient and conversation target before taking recipient-state locks. Then, in one
effects transaction:

1. Compute `source_event_key`, `conversation_key`, category and canonical subject.
2. Apply its idempotent domain mirror changes.
3. Insert every `notification_source_event` with `ON CONFLICT DO NOTHING RETURNING` in stable source
   key order.
4. Stop notification and provider planning for a semantic event if no source row was returned.
5. Insert or lock every required `notification_inbox_state` in
   `(organization_id, user_id)` order.
6. Insert conversation shells and lock every required conversation in
   `(organization_id, user_id, conversation_key)` order.
7. Allocate each recipient event's ingestion sequence while holding its conversation lock.
8. Insert the immutable recipient event with its source, conversation and ingestion ids using
   `ON CONFLICT DO NOTHING RETURNING`.
9. Only when the recipient insert returned a row, update the conversation snapshot, inbox state and
   recipient-specific deliveries.
10. Enqueue each shared-channel delivery once from the source event and destination identity.
11. After every semantic event and zero-recipient path is complete, finalize the GitHub delivery once
   with its active claim token.

The webhook finalization uses
`UPDATE ... WHERE status = 'processing' AND claim_token = :token RETURNING id`. Returning zero rows
throws and rolls back the entire effects transaction because another worker reclaimed the lease.
Claim ownership is therefore a fence, not an advisory check.

The complete ordered lock set is mandatory for notification, read-all, compatibility-mutation and
backfill transactions; recipient iteration order from a payload is never used as lock order. Every
path locks inbox-state rows first, conversation rows second and affected legacy event rows last in
stable `(organization_id, user_id, conversation_id, id)` order. A legacy event mutation resolves its
conversation without locking, acquires that same aggregate-first lock set, then rechecks and mutates
the target event before folding all locked siblings. Conversation row locking serializes read and
new-event races. The two valid orders are deterministic:

- Read first, then event: the new event leaves the conversation unread.
- Event first, then read: the read action covers that event and leaves the conversation read.

An out-of-order or backfill event is retained for history but does not replace a newer list snapshot
or resurface the conversation unless the producer explicitly marks it live and current. GitHub old
head and stale snapshot events are never marked live.

## GitHub ingestion and CI state

GitHub recommends using `X-GitHub-Delivery` as the stable identity for an event and preserves it on
redelivery. Orbit keeps the existing exclusive claim but moves finalization into the domain-effects
transaction. A crash can then leave either no effects and a reclaimable claim, or committed effects
and a terminal delivery, never committed effects with a reclaimable delivery.

Pull request notification planning changes from one pass per linked issue to one pass per canonical
pull request. The service unions and authorizes audiences across linked issues, removes the actor and
then creates at most one recipient event per source key. Related Orbit issue links are loaded for the
detail view.

A payload that names several pull requests computes its audience independently for each canonical
pull request. Authors, requested reviewers and linked-issue readers from one pull request are never
reused for another pull request in the same check payload.

After commit, realtime publication is best effort for the request path. A publication failure is
logged and recovered by sync catchup; it does not turn a terminal GitHub delivery back into a failed
or reclaimable delivery.

CI state follows these rules:

- Parse `head_sha` from check run, check suite, workflow run and status payloads.
- Lock the pull request row while applying a check event.
- Derive `context_key` with the versioned source-specific tuple rules above. Verify that reruns from
  one app and name update one row, equal names from different apps remain independent, status context
  casing and creator rotation update one native context, and check-run/status sources do not collapse
  without an explicit adapter.
- Order pull request head updates by the normalized provider pull request update time. Ignore an older
  head update. Equal provider times with different SHAs mark the pull request unresolved and enqueue
  fenced head reconciliation instead of moving the head arbitrarily.
- Persist a check event for a non-current SHA in its context row but do not include it in the current
  aggregate. This preserves an early check that arrives before its synchronize event.
- On an accepted pull request head change, increment `head_epoch`, reset aggregate state, then
  recompute from every already stored resolved context for the new SHA. Enqueue reconciliation for
  unresolved or missing current-head contexts before emitting a failure transition.
- Upsert the current-head context row while holding the pull request lock. Accept a state only when
  its normalized provider update time is newer than the stored value. An older update remains
  history and cannot change the context or aggregate.
- Treat equal provider times with different states as a reconciliation condition instead of choosing
  an arbitrary ingestion order. Mark the context unresolved, exclude the conflicting update from
  aggregate transitions, and fetch the authoritative current context from GitHub with a fenced
  reconciliation job. Equal time and equal state is idempotent.
- Keep the latest resolved state per current-head context key. The unique pull request, head SHA and
  context key row plus the pull request lock serialize concurrent check sources. Old-head rows remain
  history but never participate in the rollup.
- Treat check suite and workflow events as reconciliation triggers when constituent check runs are
  available. They do not compete with those runs as separate failing contexts.
- Emit `pr_checks_failed` only when the aggregate current-head state transitions from a non-failure
  state to failure. Additional failed jobs on the same failing head do not create another event.
- Use source identity `github-pr:<repository-id>:<number>:<head-sha>:checks-failed`, so a
  failure-success-failure sequence on the same head still notifies at most once.
- A new head can produce one new failure event.
- Context and head reconciliation completion uses compare-and-swap on the captured head epoch,
  current SHA, context version and claim token, so a force push or newer context invalidates stale
  worker results.

## Slack delivery and threading

Every Slack side effect is claimed from `notification_delivery`. The webhook request never calls
Slack directly and never treats a swallowed provider error as success.

The worker flow is:

1. Claim a bounded batch with `FOR UPDATE SKIP LOCKED`, a fresh claim token and a lease.
2. Reload the source event and canonical subject. For direct messages, recheck current recipient
   policy, `slack_dm` preference, membership and mapping. For shared channels, recheck the current
   enabled mapping and its workspace or team scope against the subject.
3. Resolve the current integration and credential generation.
4. Find or lease the unique Slack thread row in a short transaction, then release the connection.
5. If no root exists, post the conversation summary and persist its `channel` and `ts`.
6. Otherwise post the new event with the root `ts` as `thread_ts`.
7. Persist provider ids and mark the delivery sent in one short transaction using the active claim
   and credential-generation fences.
8. Retry rate limits and transient errors with bounded backoff. Mark permanent configuration errors
   unavailable and authentication errors as requiring reconnection.
9. Move exhausted deliveries to a visible dead-letter state rather than dropping them.

An enabled `slack_channel_sync` mapping is the authority for shared-channel delivery after cutover;
individual `slack_dm` preferences remain authoritative only for direct messages. Legacy per-user
`slack` preference rows are shadow-compared during compatibility and then retired for shared
channels, because one public channel side effect cannot honor different choices for individual
recipient rows. The settings UI labels shared channels as workspace or team managed before this
change is enabled.

The thread lease prevents concurrent workers from creating two roots without holding a database
connection across the Slack request. An expired lease can be reclaimed. A worker that loses its lease
cannot finalize the thread row.

Workers serialize delivery per provider namespace, destination and conversation and claim the lowest
ingestion sequence first. Replies cannot be claimed until the thread is `ready`. An expired
`creating` lease is retried by the same root delivery and provider request id. A definitively unsent
root delivery can be replaced by the next eligible delivery; an ambiguous root can never be replaced
automatically because that could create a second parent. It blocks replies until an operator records
the provider result or deliberately retries the same request identity.

The provider request id is derived from the delivery id and passed as Slack's message client id when
supported by the method contract. The database uniqueness constraints remain the primary guarantee.
There is still a narrow provider-boundary ambiguity if Slack accepts a request and the process dies
before storing the returned timestamp. The worker first retries with the same provider request id,
then records an operator-visible ambiguous state if the provider cannot confirm the original result.

Root replies use `reply_broadcast: false`. Direct messages and configured channels use the same
threading model. Channel delivery deduplication happens before recipient fanout, so one pull request
event produces one reply per configured channel.

Workspace-scoped channel mappings receive only subjects visible to the workspace. Team-scoped
mappings receive only subjects currently visible to that team. A private or unresolvable subject has
no eligible shared-channel destination. Losing subject access, disabling a mapping or changing its
scope before claim marks the queued row unavailable without calling Slack.

The current worker claims at most 100 direct messages per one-minute cron run with concurrency five.
The first release keeps those safety limits, runs channel and direct-message capacity independently,
and exposes oldest-pending age. A sustained age above five minutes is an operational signal to tune
batch size or schedule frequency after checking Slack rate limits, not a reason to drop deliveries.

## API contracts

### List conversations

`GET /api/inbox/conversations?tab=<tab>&cursor=<opaque>&limit=<n>`

Returns:

- `conversations`: latest snapshot, unread state, event count and related context summary
- `counters`: authoritative conversation counts for total unread, unread mentions and unread activity
- `counterVersion`: inbox-state sync id for stale-response rejection
- `nextCursor`

Pagination is a live feed rather than a frozen snapshot. If an older conversation receives activity
between pages, its `last_activity_seq` moves it above the cursor. Realtime upserts bring that row to the
top immediately, the client deduplicates by conversation id, and a socket reconnect refreshes the
first page before older pagination resumes. This avoids pretending that a mutable summary row can
provide historical snapshot ordering without a second versioned index.

### Read history

`GET /api/inbox/conversations/:id/events?cursor=<opaque>&limit=<n>`

Returns immutable events newest first. The server verifies that the current principal owns the
conversation and still has canonical-subject access under current workspace, team and document
policy.

### Mutations

- `POST /api/inbox/conversations/read` accepts up to 500 conversation ids and a read boolean.
- `POST /api/inbox/conversations/read-all` marks every currently visible conversation read.
- `PATCH /api/inbox/conversations/:id` sets or clears snooze state and advances the snooze
  generation so obsolete wake jobs cannot change visibility.
- `DELETE /api/inbox/conversations/:id` soft-dismisses the conversation.

Every mutation returns authoritative counters, their version and updated conversation rows. The
client does not maintain independent badge arithmetic after the cutover and ignores a response whose
counter version is older than its current version.

### Compatibility

The existing `/api/notifications` routes remain during dual-read rollout. Phase 1 delete writes the
legacy `notification.dismissed_at` field and never physically deletes an event. As soon as Phase 2
conversation rows exist, every legacy or conversation read, unread, snooze and delete mutation uses
the bidirectional folding contract before backfill starts and until legacy clients are retired. No
compatibility route physically deletes an event or source identity.

Grouped state has deterministic legacy folding rules during this window:

- A surfaced sibling is active when its legacy `dismissed_at` is null.
- The conversation is dismissed when no surfaced sibling is active.
- The conversation is snoozed only when every active sibling has a future `snoozed_until`; its wake
  time is the earliest of those values. One visible active sibling keeps the conversation visible.
- Event and mention unread counts fold from active siblings whose `read_at` is null and whose
  `manual_unread_anchor` is false. Any active anchor folds into conversation `manual_unread` without
  increasing an event or mention count. The conversation snapshot uses the newest visible active
  sibling, then the newest active sibling, then the newest surfaced sibling when all are dismissed.
- A legacy event-level mutation first locks inbox state, conversation and sibling event rows in the
  global order, then changes exactly its target row and recomputes from all locked surfaced siblings.
  This preserves event ids and `mark_notification_read` semantics without inverting lock order.
- A conversation-level read, snooze or dismiss action locks the same aggregate-first set and writes
  the equivalent state to all active surfaced siblings in the same transaction. Marking a
  conversation unread clears `read_at` only on its newest active sibling, sets that row's
  `manual_unread_anchor` and sets conversation `manual_unread`. Marking read clears every anchor.
- New live activity creates an active sibling, clears active-sibling snoozes and resurfaces the
  conversation, but does not erase historical per-event dismissal.

These writes are bidirectional through the rollback window. Legacy reads can therefore be restored
without losing changes made through the conversation API, and conversation reads can be restored
without guessing how mixed legacy rows should fold.

MCP keeps `list_notifications` and `mark_notification_read` as event-level tools with their current
ids, exact type filter, issue and document context, timestamp fields and cursor behavior for the full
compatibility period. New `list_inbox_conversations` and `mark_inbox_conversations_read` tools expose
the grouped model and conversation cursor. The new list tool documents that its cursor is a live-feed
cursor and that a fresh first page reconciles moved conversations. Event-level tools are deprecated
only through a later versioned contract, so stored MCP cursors and automations never silently change
cardinality or id meaning.

## Realtime contract

Add `notification_conversation` to the shared sync model list. Realtime actions contain only the
conversation id, sync id, ordering, visibility and authoritative counters. They do not contain
titles, bodies, related issue data or URLs because a user-scoped catchup packet cannot re-evaluate a
team or document permission that changed after publication.

The client patches ordering and state from that non-sensitive action, then fetches only the changed
conversation summary through the authorized API. It never refetches the entire list. A dismissal or
access revocation publishes an update rather than a delete, so catchup can recover the final state.
If the summary endpoint denies current access, the client removes that conversation from view.

Team, document and workspace access removal paths lock the canonical ACL or stable parent scope
first, then inbox state, affected conversations and provider deliveries in stable order. They set
`access_hidden_at`, advance `access_generation`, remove the conversations' contribution from visible
counters and invalidate provider work in the same transaction as the access change. Access-grant
paths use the same lock order, recheck canonical-subject policy and clear that state with the inverse
counter transition. Both publish a non-sensitive update after commit. Historical pull request events
remain workspace-visible only when the canonical pull request is still visible; related private Orbit
context is always loaded under current policy.

The client treats both insert and update actions as upserts. An update for a conversation outside the
loaded page is inserted when visible, every upsert reorders by `(last_activity_seq, id)`, and a snoozed
or dismissed update removes the row without erasing its identity. This replaces the current behavior
that ignores unseen updates and leaves seen rows in their old position.

The client applies the row and replaces all counters with the authoritative counters included in the
mutation response or a compact counter payload published with the delta. It never infers a remote
delete or snooze from local arithmetic.

Legacy `notification` deltas continue during compatibility writes and stop after every supported
client reads conversation deltas.

## Migration and rollout

### Phase 1: Contain duplicate production

- Add `notification_source_event`, nullable recipient source linkage and partial uniqueness for linked
  recipient rows.
- Add `notification.dismissed_at` and `notification.manual_unread_anchor`, replace legacy hard delete
  with a soft dismissed state, and make legacy reads exclude dismissed rows before source identities
  or provider deliveries depend on existing recipient rows.
- Persist every GitHub Slack channel delivery in the outbox before removing synchronous channel sends.
- Add delivery claim tokens and fenced completion. Drain existing processing leases and classify
  uncertain expired work as ambiguous before enabling reclaim.
- Pause webhook claims, drain every tokenless processing lease, add
  `webhook_delivery.claim_token` plus the processing-token check, deploy token-aware claims and only
  then resume. Require compare-and-swap success and failure finalization.
- Finalize ordinary and installation GitHub webhook deliveries in the same transaction as domain
  effects, source identities and every post-commit provider enqueue.
- Fence finalization with a claim token and require one returned delivery row before commit.
- Union linked-issue audiences before notification planning.
- Make CI failure notifications current-head transition based.
- Add failure-injection tests at every transaction boundary.

This phase improves correctness before any inbox UI changes.

### Phase 2: Add and backfill conversations

- Create `notification_conversation`, `notification_inbox_state`, `notification_snooze_wake` and
  nullable event linkage columns.
- Deploy bidirectional compatibility writes for event creation plus every legacy or conversation
  read, unread, snooze and dismiss mutation before backfill so neither read model can fall behind the
  migration cursor or rollback path.
- Run `bun run notifications:conversations-backfill` as a resumable, idempotent command in bounded
  primary-key batches, never as DML inside a Drizzle migration. Persist a high-water mark and repeat
  the tail pass until no gaps remain.
- Resolve canonical pull requests through `github_pull_request`, `git_link` and repository identity.
- Use separate issue activity and status keys.
- Create source rows from an exact provider activity identity where one is provable. Give every other
  legacy recipient row a unique `legacy-notification:<id>` source key rather than inventing source
  equivalence. Conversation grouping can still collapse those events by canonical subject.
- Preserve the latest event snapshot. A conversation is unread when any retained inbox event is
  unread, which collapses duplicate badges without silently marking work read.
- Transfer Phase 1 legacy dismissal into conversation state. Enqueue generation-fenced wake rows for
  every active snooze before enabling materialized visibility counters.
- Evaluate current canonical-subject policy inside the conversation-write transaction while holding
  the same canonical ACL or parent-scope row lock used by live grant and revoke mutations. When an ACL
  row can be absent, both paths lock the stable parent scope before creating or deleting it. Only then
  insert or update the conversation, copy the current access generation and mark inaccessible rows
  access-hidden before materialized counters or realtime conversation reads are enabled. The
  backfill never evaluates policy and writes visibility in separate transactions.
- Compare conversation and legacy unread results in structured server logs without sending product
  telemetry.
- Require `bun run notifications:conversations-verify` to report zero unlinked surfaced rows and zero
  state drift before read cutover. Backfill locks a conversation before applying state and never
  overwrites a newer dual-written read, snooze or dismissal.
- Build final unique and list indexes with a measured, low-lock release procedure. Do not make linkage
  columns non-null until backfill completeness and query plans are verified.

### Phase 3: Switch web, realtime and MCP

- Move filtering and pagination to the conversation API.
- Show the latest event in the list and the full event history in the detail pane.
- Switch realtime to conversation updates and authoritative counters.
- Complete the MCP compatibility window.

### Phase 4: Finish provider delivery

- Add Slack thread identity and provider request ids.
- Drain every Slack reconnect before activation. Rebind eligible queued work and ready thread rows
  only for same-namespace credential rotation; invalidate them for a team or app change.
- Upgrade the already durable flat Slack channel deliveries to conversation threads.
- Enable threaded channel delivery first, then direct messages.
- Enqueue notification email durably and enable its Resend worker only after retry and status tests
  pass. Do not change unrelated transactional email.
- Expose pending, retrying, unavailable and dead-letter counts in integration diagnostics.

### Phase 5: Remove compatibility paths

- In a separate contract PR, require `conversation_id`, `source_event_id`, `occurred_at`,
  `ingested_at` and `ingestion_seq` only after every deployed writer and allowed rollback deployment
  populates them.
- Remove time-window deduplication and legacy row-level inbox mutations.
- Stop publishing legacy notification deltas.
- Decide event retention only after production volume is measured. Any future pruning keeps source-key
  tombstones long enough to prevent redelivery from recreating old events.

The contract PR preflights nulls and orphaned composite references, adds `NOT VALID` checks where
appropriate, validates them separately, and only then changes nullability. It records the deployment
rollback floor and requires a current backup plus a restore rehearsal before removing compatibility
columns or paths.

Schema-dependent phases require `bun run db:release` against production before the corresponding
application merge, following the repository deployment contract.

Before touching the existing notification table, the release records row counts, duplicate source
candidates, estimated index size and representative query plans and sets bounded lock and statement
timeouts. Orbit's release runner is transactional, so an index that must be built with
`CREATE INDEX CONCURRENTLY` is created through a separately approved, audited operation and then
adopted by an idempotent schema migration and drift check. It is never hidden inside the resumable
data backfill.

### Rollback

Every schema change is additive through the compatibility window. A global operational switch can
return web, realtime and MCP reads to the legacy rows while bidirectional compatibility writes
continue. A separate global switch pauses threaded Slack workers without deleting pending
deliveries. These switches are rollout controls, not organization entitlements.

Rollback never drops conversation, source-key, thread or outbox data. It pauses consumers, restores
the previous read path and preserves rows for diagnosis. Final non-null constraints and legacy-path
removal happen only after the rollback window has passed, so those final changes require a new forward
migration rather than a destructive down migration.

## Observability and operations

Store or log installation-local operational signals for:

- webhook claims, reclaims, terminal duplicates and failures
- source event conflicts by producer
- snooze wake lag, stale generations and failed wake attempts
- conversation backfill progress and ambiguous legacy rows
- legacy-versus-conversation counter differences during shadow reads
- outbox queue depth, oldest pending age, attempts and dead letters
- Slack request latency, rate limits, authentication failures and ambiguous sends
- provider deliveries made unavailable by current policy, preference or destination checks
- current-head CI status transitions and ignored old-head events

Integration settings show actionable Slack delivery health without exposing tokens. The minimum
operator alerts are a growing oldest-pending age, any sustained webhook failure rate, any dead-letter
delivery and any non-zero shadow-read drift after backfill completion.

## Security and authorization

- Recipient planning still intersects every audience with current workspace and team membership.
- Conversation list, history and mutations require recipient ownership, organization scope and
  current canonical-subject reachability.
- Related issue and project context is loaded only after current policy checks.
- Access revocation persists `access_hidden_at`, updates materialized counters and publishes a
  non-sensitive state change for open and reconnecting clients. Restoration is an explicit inverse
  transition after policy succeeds. Both use the provider preflight lock order, and revocation marks
  every not-yet-started affected delivery unavailable in the same transaction.
- Every provider worker reloads the source event and rechecks current canonical-subject policy and
  current preferences immediately before delivery. Slack direct messages also require current
  membership and mapping, notification email requires a current verified address, and shared Slack
  channels require an enabled mapping whose workspace or team scope can see the subject.
- Webhook signatures are verified before claim or parsing behavior changes.
- Provider request and response logs never contain credentials or full sensitive payloads.

## Test strategy

### Idempotency and failure injection

- The same GitHub delivery received concurrently creates one source event total and one immutable
  recipient event per authorized recipient.
- A crash before transaction commit leaves no effects and permits safe reclaim.
- A crash after transaction commit sees a terminal delivery and creates no duplicate.
- A stale webhook claimant cannot finalize or commit domain effects after another claimant receives
  a fresh token.
- A tokenless old handler cannot finalize while or after a token-aware claimant reclaims the same
  webhook delivery.
- Redelivery after the old 60 second window still creates no duplicate.
- One pull request linked to several issues creates one recipient event and retains every authorized
  related issue as context.
- Two deliveries with reversed overlapping audiences complete without deadlock because they acquire
  the same global recipient and conversation lock order.
- A legacy event mutation racing a conversation mutation completes without deadlock because both
  acquire inbox state, conversation and sibling events in the same order.

### Conversation state

- Comment, review, inline comment, check failure and merge events for one pull request share one
  conversation.
- Issue activity and issue status use separate conversations.
- Read-before-event and event-before-read races produce the specified result.
- Manual unread on activity increments total and activity counters; on status it increments only
  total. Neither path invents an unread mention or event.
- A conversation manual-unread round trip through the legacy API preserves its anchor, keeps unread
  event count at zero and clears the anchor on mark-read or real new activity. A legacy event-level
  unread still counts as one unread event.
- New live activity clears snooze and dismissal; backfill does not.
- A due snooze wakes after worker restart, updates visible counters once, and publishes a recoverable
  delta. Expiry racing with read, resnooze, dismissal or new activity respects the latest snooze
  generation and state.
- Ambiguous legacy rows are not merged.
- Unread and mention badges count conversations.

### GitHub CI

- Old-head failure after a force push does not change current status or notify.
- Several failed jobs on one head create one failure-transition notification.
- Check suite, workflow run and check run overlap does not duplicate a failure.
- Check-run reruns from one app and name update one context; equal names from different apps remain
  separate; separator-like provider text cannot collide; case variants and creator rotations update
  one commit-status context; check-run and commit-status sources remain distinct without an explicit
  adapter.
- Failure, success and failure on one head notify once; a new failing head can notify once again.
- Out-of-order events cannot regress pull request state.
- A stale synchronize event cannot move the head SHA backward, and a check received before its head
  becomes current participates when that head epoch is accepted.
- Equal provider update times with conflicting states trigger reconciliation and cannot produce an
  aggregate transition until authoritative state is fetched.

### API, realtime and MCP

- Every tab paginates matching conversations on the server.
- Soft dismissal is restored correctly through realtime catchup.
- Counters remain correct across two tabs and concurrent read or snooze actions.
- Older mutation responses and realtime counter snapshots cannot replace a newer counter version.
- Legacy MCP tools preserve event ids, exact type filters and cursors while the new tools expose
  conversations.
- Current membership and team-policy changes immediately affect related context visibility.
- An open inbox and a reconnecting inbox both evict or redact a conversation after access loss.
- Access hide and restore update materialized counters and versions exactly once without exposing a
  hidden conversation through badge drift.
- Conversation backfill racing an access grant or revocation shares the canonical policy lock and
  cannot create a row with stale `access_hidden_at`, `access_generation` or counters.

### Slack

- Concurrent workers create one root message for one destination and conversation.
- Later events use the persisted root `thread_ts`.
- A channel configured through several linked issues receives one delivery.
- An enabled shared-channel mapping produces one channel delivery regardless of legacy per-user
  `slack` preference rows, while a disabled `slack_dm` preference still prevents that user's direct
  message.
- Provider success followed by process failure retries with the same provider request id.
- An expired processing lease without provider proof becomes ambiguous, and a stale delivery claimant
  cannot finalize after lease loss.
- Rate limits retry, permanent errors stop, authentication errors request reconnection and exhausted
  deliveries become visible dead letters.
- Removing a member before a queued direct message is claimed prevents delivery.
- Revoking canonical-subject access before a queued direct message, email or shared-channel claim
  prevents provider contact even when organization membership remains.
- Provider preflight and access revocation races follow their shared linearization lock: revocation
  first prevents contact, while a recorded send start is treated as already in flight and fences all
  later work.
- A Slack team change makes old queued destinations and thread roots unavailable.
- A team or app reconnect drains an already claimed send before activating the new namespace, so no
  worker can start a post against the old workspace after activation.
- Same-team credential rotation drains active leases, then rebinds a pending root and pending reply
  to the new generation without losing the existing ready thread.
- Existing delivery statuses and expired leases migrate to the specified terminal or retry states.
- Notification email resolves the current verified address and preference at send time, uses the
  delivery idempotency key, and remains pending until the Resend worker confirms a provider id.
- Email retries reuse the immutable first-attempt payload, stop when its address is no longer current,
  and become ambiguous before the provider's idempotency retention expires.

### Full verification

- Focused package tests for every phase.
- Database migration and schema-equivalence checks.
- `bun run verify` with a dedicated test lane.
- Playwright coverage for grouping, history, tabs, keyboard actions and counter updates.
- Production smoke checks for GitHub webhook health, inbox pagination and Slack delivery diagnostics.

## Trade-offs

### Conversation summary plus immutable events

This duplicates the latest event fields, but makes inbox reads and server-side tab pagination fast
without losing history. Recomputing every row from event history would be simpler to write and more
expensive and fragile to operate.

### Canonical pull request subject

This fixes duplicate PR conversations and gives Slack one thread. It means a PR linked to several
issues has one list row, so the detail view must present the related issues clearly instead of using
one issue as the row identity.

### Fixed issue activity and status families

This retains the useful Activity and Status separation. A single Orbit issue can have two
conversations, which is intentional and bounded.

### Phased compatibility-write rollout

This requires compatibility code and temporary shadow comparisons. It avoids a high-risk cutover of
schema, UI, realtime, MCP, GitHub and Slack behavior in one deployment.

### Durable provider outbox

Delivery becomes eventually consistent instead of occurring in the webhook request. In return,
provider failures are visible, retryable and cannot decide whether a GitHub delivery is processed.

## Decisions requested before implementation

The recommended defaults are:

1. Unread badges count conversations, not individual events.
2. New live activity clears snooze and dismissal so the conversation resurfaces.
3. Pull requests use one conversation even when linked to several Orbit issues.
4. Issue activity and issue status remain separate conversations.
5. Slack uses one root plus non-broadcast replies per destination and conversation.
6. Existing resolvable rows are collapsed during backfill, while ambiguous rows remain separate.
7. Delivery and ingestion containment ships before the visible inbox cutover.
8. Workspace and team admins control shared Slack channel delivery through channel mappings;
   individual users control only their Slack direct messages.

## External contracts

- [GitHub webhook best practices](https://docs.github.com/en/webhooks/using-webhooks/best-practices-for-using-webhooks)
- [GitHub check run and check suite head SHA behavior](https://docs.github.com/en/apps/creating-github-apps/writing-code-for-a-github-app/building-ci-checks-with-a-github-app)
- [GitHub combined commit status context behavior](https://docs.github.com/en/rest/commits/statuses?apiVersion=2022-11-28)
- [Slack `chat.postMessage`](https://docs.slack.dev/reference/methods/chat.postmessage)
- [Slack message thread identity](https://docs.slack.dev/messaging/retrieving-messages/)
- [Resend idempotency keys](https://resend.com/docs/dashboard/emails/idempotency-keys)

## What to revisit as Orbit grows

- Split event storage from recipient state if recipient fanout makes per-user event rows too large.
- Partition old event history only after measured volume justifies the operational complexity.
- Add digest summaries for high-volume conversations without changing source idempotency.
- Move webhook processing to a dedicated queue only if the transactional path cannot consistently
  answer GitHub inside its delivery timeout.
- Add user-controlled conversation grouping only if the fixed subject model proves insufficient.

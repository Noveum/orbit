# Inbox Activity and Status Tabs Design

## Problem

The inbox is dominated by issue field changes. A workspace with active boards produces a
continuous run of `NOV-152 moved to In Progress` rows, and those rows bury the notifications a
person actually needs to act on: a comment on their issue, a review on their pull request, a
failed check, a document they follow changing.

The four existing tabs do not help. `All` is the flood itself. `Unread` is the same flood
filtered by a flag that most of the flood also satisfies. `Mentions` and `Pull requests` are
narrow slices that miss ordinary comments and replies. The result is that a reader scanning the
inbox misses real activity, which defeats the purpose of having an inbox.

Hiding field changes is not the answer. Knowing that an issue moved is useful, and a
notification a user was sent should remain reachable. The problem is placement, not existence.

## Scope

Split the inbox into two complementary buckets and land the reader in the useful one:

- Introduce a shared classification of notification types that represent an issue field moving.
- Rename the default tab to `Activity` and define it as every notification that is not a field
  move.
- Add a `Status` tab holding exactly the field moves, so nothing becomes unreachable.
- Give the `Activity` tab its own unread count, so the reader can tell how much of the inbox
  total is real activity.
- Leave `Unread`, `Mentions` and `Pull requests` unchanged, still spanning every notification.

This change is confined to classification, the inbox UI and one unread counter. It does not
change what notifications are produced, who receives them, how they are delivered, or how they
are read, snoozed and deleted.

## Classification

`packages/shared/src/constants/notification.ts` gains a list beside the existing
`PULL_REQUEST_NOTIFICATION_TYPES`, declared the same way:

```ts
STATUS_CHANGE_NOTIFICATION_TYPES = [
  'issue_status_changed',
  'issue_priority_changed',
  'issue_assigned',
  'issue_unassigned',
  'triage_added',
]
```

with an `isStatusChangeNotification` predicate matching the shape and signature of
`isPullRequestNotification`.

Three of these five types are not produced today. `issue_status_changed` and `issue_assigned`
come from `packages/core/src/work/issue-service.ts`. `issue_priority_changed`,
`issue_unassigned` and `triage_added` are declared in `NOTIFICATION_TYPES` and unused. They are
classified now anyway, so that wiring one of them up later places it in `Status` by default
rather than silently leaking into `Activity` and reproducing the original problem.

Assignment is deliberately classified as a field move rather than as activity. An assignment is
a workflow transition of the same kind as a status change, it is produced by the same service on
the same edit, and it arrives in the same bursts. A reader who wants assignments still has
`Status`, and a reader who was assigned something urgent is reached by email and push, which this
change does not touch.

The two lists are disjoint. No notification type is both a pull request event and a field move,
and a test asserts this so that a future addition to either list cannot make a type ambiguous.

## Tab structure

The tab bar becomes:

```text
Activity | Unread | Mentions | Pull requests | Status
```

`Activity` is the default and holds every notification that is not a field move: comments,
replies, mentions, reactions, subscription activity, document changes, document access requests
and grants, project updates, reminders, invites, members joining, and all seven pull request
types including failed checks.

`Status` holds exactly the field moves. `Activity` and `Status` are exact complements, so every
notification appears in one of them and no notification is unreachable.

`Unread`, `Mentions` and `Pull requests` keep their current definitions and continue to span
every notification, field moves included. They are facets over the whole inbox rather than
subdivisions of `Activity`. A reader who wants only unread activity reads the `Activity` list,
where unread rows already carry the accent dot.

Mechanically this is the existing pattern unchanged. `matchesTab` in
`apps/web/src/features/inbox/inbox-view.tsx` gains two branches: `activity` returns the negation
of `isStatusChangeNotification`, `status` returns it directly. The implicit `return true`
fallback is replaced by an explicit branch per tab so that adding a tab cannot accidentally
inherit the old meaning of `All`. Keyboard navigation, the retained-unread set, selection reset
on tab change and the load-more row all operate on the filtered list exactly as they do now.

### Naming

`Activity` is chosen over `Focused` or `Primary`. Outlook's `Focused` implies that a model ranked
the messages, and Orbit's rule is a fixed, inspectable classification with no scoring. Gmail names
its own tabs after their contents for the same reason. `Activity` and `Status` describe what is in
each tab and read as the complements they are.

The page heading stays `Inbox`, and the total unread and mention badges beside it are unchanged.

## Activity unread count

The `Activity` tab carries a count of unread notifications that are not field moves, rendered
only when it is above zero. Read together with the existing header badge it answers the question
the current inbox cannot: of the total unread, how many are worth opening.

`unreadCounters` in `packages/services/src/notifications/index.ts` already groups unread rows by
type to separate mentions from the total. It gains a third accumulator in that same loop and
returns `activity` alongside `total` and `mentions`. There is no new query and no new index.

The value reaches the view along the path the mention count already takes: `loadInbox` in
`apps/web/src/features/inbox/data.ts` puts `unreadActivity` on `InboxData`, the inbox page passes
it through `inbox-realtime.tsx`, and `InboxView` seeds state from it and re-seeds in the existing
effect that resynchronises on new props.

Once seeded, the count is maintained locally:

- `InboxPatch` gains `activityDelta` beside `unreadDelta` and `mentionDelta`, and `applyOne`
  maintains it across realtime insert, update and delete using a helper that counts a row as one
  when it is both unread and not a field move.
- `setReadState` adjusts it on the optimistic path and reverses that adjustment on the rollback
  path, in the same place it adjusts the mention count.
- `remove` decrements it when the deleted row was an unread non-field-move.
- `snooze` decrements it when the snoozed row was an unread non-field-move.

`/api/notifications/read` and the notification `PATCH` and `DELETE` responses continue to return
only `unreadCount`, so `applyServerCount` corrects the total but never the activity count. This is
the same contract the mention count already lives under, and it keeps the change out of the route
layer entirely.

The snooze case is the one place that contract was already broken. `unreadCounters` excludes a
snoozed row, so the server total drops the moment a row is snoozed, and `applyServerCount` applies
that drop to the total. The mention count was never given the same treatment, so snoozing an unread
mention left its badge one too high until the next page load. Adding the activity count to that
function would have reproduced the same staleness, so `snooze` now adjusts both counts locally the
way `remove` already did. This is a fix to existing mention behaviour, made because the alternative
was shipping a new badge with a known stale case.

## Pagination

Filtering stays client-side over the loaded page, which is how `Mentions` and `Pull requests`
already work. The server load is unchanged.

The known consequence is that when field moves dominate the first page of fifty, `Activity` shows
only the remainder of that page until more is loaded. The load-more row fires from an
`IntersectionObserver`, so ordinary scrolling continues to pull pages without a click, and the
`Activity` count on the tab tells the reader how much is still to come. Moving the filter into
`listInbox` and the notifications route remains available if the tab proves thin in practice, but
it widens the change to the query, the route, the first server paint and their tests for a
problem that has not yet been observed.

## Testing

- `packages/shared`: membership of `STATUS_CHANGE_NOTIFICATION_TYPES`, the behaviour of
  `isStatusChangeNotification`, and disjointness from `PULL_REQUEST_NOTIFICATION_TYPES`.
- `apps/web/tests/features/inbox/inbox-tabs.test.tsx`, new: `Activity` excludes field moves,
  `Status` shows only field moves, the complement property across a fixture covering every entry
  in `NOTIFICATION_TYPES`, the activity count rendering and its absence at zero, and the snooze
  case for both the activity and mention counts.
- `apps/web/tests/features/inbox/inbox-issue.test.tsx`: the body-duplication test uses an
  `issue_assigned` fixture, which this change moves to `Status`, so it selects that tab before
  reading the detail pane. Keeping the fixture preserves assignment coverage rather than swapping
  it for a type that happens to stay on the default tab.
- `apps/web/tests/features/inbox/inbox-deltas.test.ts`: `activityDelta` across insert, update and
  delete. The shared fixture defaults to `issue_assigned`, which this change reclassifies as a
  field move, so the existing expectations are revised deliberately rather than left to pass by
  coincidence.
- `packages/services/tests/notifications/notifications.test.ts`: the `activity` counter, including
  a case where unread field moves and unread activity coexist, and one where a read field move
  leaves both counters alone. One existing assertion compares the counter object exactly and is
  updated; the other reads fields individually and needs no change.
- `apps/web/e2e/inbox-layout.spec.ts`: the tab list. It matched tabs by exact accessible name,
  which the count badge changes from `Activity` to `Activity 12`, so the tabs carry
  `data-testid="inbox-tab-<id>"` and the spec selects them by that instead.

## Out of scope

Server-side tab filtering. Per-tab unread counts beyond `Activity`. Any change to notification
production, delivery channels, the notification preference matrix, or the email and push paths.
User-configurable classification of which types count as field moves.

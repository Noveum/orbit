# Sprint planning redesign

Date: 2026-08-10
Revised: 2026-08-11
Delivery: one specification, six workstreams, one pull request each, landing in
the order given at the end of this document.

## What changed after the first draft

This document first specified a sprint per team, with a workspace roll up
listing one row per team and drilling into that team's sprint. That is not what
shipped. A sprint belongs to the workspace: one sprint runs at a time and holds
work from any team or project, `/sprints` is that sprint, and the team sprint
routes redirect to it. `cycle.team_id` is nullable and survives only as the
label a finished team sprint was run under.

The sections below describe the shipped model. The roll up, the team switcher
and the per team cadence are not part of it and are not planned.

## Why

The Sprints page is not a planning surface. It is eight dashboards stacked on
one scroll.

`apps/web/src/app/(app)/sprints/page.tsx` maps over every team the viewer
belongs to and renders a complete `CyclePanel` for each: sprint header, issue
list, burn up sidebar, "Upcoming sprints", "Past sprints", and the sentence "No
sprint has finished yet" once per team. With eight teams that is around forty
repeated headings and eight identical "New sprint" buttons. There is no team
selector, nothing collapses, and nothing is ranked, so finding the sprint you
care about means scrolling past seven you do not.

Everything else follows from the same root cause. The page was hand rolled
instead of reusing the issue view system that the rest of the app runs on. The
proof is in the code: `ViewPage` already contains `'cycle'` and
`packages/shared/src/filters/index.ts` builds a full capability matrix for it,
dropping the redundant cycle filter, and nothing in the application ever asks
for it. The infrastructure for a sprint page that filters, groups, drags and
updates live was built and then bypassed.

The specific failures, each verified in the code:

1. Eight duplicated panels, described above.
2. The per assignee panel counts issues while the header above it counts
   points, and neither says which. `breakDownCycleIssues` in
   `apps/web/src/features/cycles/data.ts` increments `scope + 1` per issue. A
   row reading "1/11" sits directly under "5 of 55 points completed". The two
   numbers describe different things in the same panel.
3. There is no board view of a sprint. `CycleIssueList` is a static server
   rendered list grouped by state, with no filters, no grouping choice, no drag
   and drop and no realtime, while `Board`, `IssueList`, `useIssueViewModel`
   and the whole filter stack sit unused a directory away.
4. Completing a sprint is all or nothing. `completeCycle` moves every open
   issue into the next sprint, creating that sprint if it does not exist. There
   is no destination choice and no preview of what shipped.
5. There is no capacity planning of any kind. No table, no column, no concept,
   so there is nothing to plan against and no way to see whether a person is
   overloaded before the sprint starts.
6. There is no retrospective of any kind.
7. Sprints hold uncommitted work. The NOV sprint in production holds 7 Triage
   and 12 Backlog issues inside a scope of 50, so "0 of 136 points completed"
   counts work nobody has committed to and the burn up is flat by construction.
8. There is no page that lists everything in a sprint and lets you move a
   selection of it to another sprint.
9. Sprint mutations call `router.refresh()`, re-rendering the entire page on
   the server, against the repository convention of optimistic TanStack
   mutations patched by the realtime stream.

Two smaller defects found while reading:

- `createCycle` writes the literal string `Sprint ${number}` into `cycle.name`,
  so a stored name cannot be told apart from the default and never tracks
  renumbering. `completeCycle` does the same for the sprint it auto creates.
- `upcomingCycles` filters on `startsAt > now` alone, so a completed future
  sprint still lists as upcoming.

## What we compared against

Linear treats cycles as team property, never workspace wide. Duration is a team
setting of one to eight weeks with a start weekday and an optional cooldown,
and up to fifteen future cycles are generated ahead. Capacity is estimated from
the velocity of the previous three completed cycles. Open issues roll over
automatically, but issues sitting in backlog, triage or canceled states do not
carry forward. The cycle graph plots scope, started, completed and an ideal
pace, and scope can be measured in estimate points or issue counts.

Jira's contribution is the completion dialog: when a sprint closes with
unfinished work you choose one destination for it, either the backlog or a
named sprint, and that choice is what keeps its reports correct.

We take velocity seeded capacity and the backlog exclusion from Linear, and the
single destination completion dialog from Jira. We do not take Linear's team
scoped cycles: a sprint here belongs to the workspace, because a company that
plans one fortnight at a time wants one answer to what it is working on, not
one per team.

## Decisions taken

| Question | Decision |
| --- | --- |
| Page structure | One sprint for the workspace at `/sprints`. Team sprint routes redirect to it |
| Capacity unit | Points per person per sprint, seeded from velocity of the last three completed sprints, editable inline |
| Cadence | Optional per team. Manual by default, opt in to auto generation |
| Retrospective | Structured board, columns for went well, went badly, actions, with voting and convert to issue |
| Sprint completion | One destination for all unfinished work, chosen in the dialog |
| Uncommitted work | Triage and backlog issues stay visible but are excluded from scope, points, burn up and capacity |
| Standup | Left alone. Sprint filtering added to the existing filter system |

Selecting a subset of tasks to move is served by multi select plus a new sprint
control on `BulkEditBar`, not by the completion dialog. That keeps the
completion dialog simple and makes selective moves available on every issue
list in the application rather than only at sprint close.

## Information architecture

```
/sprints                     The sprint of the workspace. The canonical home.
/sprints?sprint=<number>     Any sprint of the workspace, past or future.
/team/[key]/sprint/*         Redirects to /sprints.
```

The sprint page is a header plus five tabs.

| Tab | Contents |
| --- | --- |
| Board | Grouped kanban, drag between states or people |
| List | Grouped list, sub grouping, bulk multi select |
| Planning | Team backlog beside the sprint, capacity rail, drag to commit |
| Insights | Burn up, scope changes, per assignee points, velocity |
| Retro | Retro boards belonging to this sprint |

The header carries the sprint name as an inline editable field, its dates, its
duration, "day N of M", overall progress, and the Edit, Complete sprint and New
sprint actions.

There is one sprint page because there is one sprint, so the eight way
duplication becomes structurally impossible rather than merely tidied away. A
sprint holds work from any team and any project, and the board folds the states
that share a name across teams into one column, so nine teams do not draw nine
Backlog columns.

## Data model

### New tables

All in `packages/db/src/schema/work.ts`, all carrying the standard
`organizationId`, `syncId` and timestamp columns.

| Table | Distinct columns | Keys |
| --- | --- | --- |
| `cycle_capacity` | `cycleId`, `userId`, `points` | unique `(cycleId, userId)` |
| `sprint_retro` | `cycleId`, `teamId`, `kind`, `title`, `createdById`, `archivedAt` | index `(cycleId)` |
| `sprint_retro_item` | `retroId`, `lane`, `body`, `authorId`, `sortOrder`, `issueId` nullable | index `(retroId, lane, sortOrder)` |
| `sprint_retro_vote` | `itemId`, `userId` | unique `(itemId, userId)` |

`sprint_retro.kind` is `midpoint` or `closing`. A sprint may hold any number of
retros, which is what makes a mid sprint retrospective possible.

`sprint_retro_item.lane` is `went_well`, `went_badly` or `action`. The column is
named `lane` rather than `column` because `column` is a reserved word in
Postgres and would need quoting at every reference.
`sprint_retro_item.issueId` references the issue an action item became, with
`on delete set null`, so a converted card keeps showing its issue identifier.

### Changed table

`team` gains three columns:

| Column | Type | Meaning |
| --- | --- | --- |
| `sprintCadenceWeeks` | smallint, nullable | Null means manual. A number turns on generation |
| `sprintStartDay` | smallint, not null, default 1 | Day of week, Monday by default |
| `sprintsAhead` | smallint, not null, default 2 | How many upcoming sprints to keep created |

Null cadence reproduces today's behaviour exactly, so existing teams change
nothing until someone opts in.

### Capacity resolution

Capacity is resolved, not simply read, so that history stays honest:

- No stored row and the sprint has not started: computed live as that person's
  average completed points across the last three completed sprints of the team,
  presented as an estimate.
- A stored row: that value wins.
- `startCycle` writes rows for every team member still lacking one, freezing
  the numbers at the moment the sprint begins.

Without the freeze, completing a later sprint would retroactively change a past
sprint's capacity, because the velocity window would have moved.

A person with no completed sprints has no velocity. Their estimate falls back
to the median capacity of the team, flagged in the UI as a guess.

### Scope rule

`currentTotals`, `pointOn`, `scopeChanges`, `breakDownCycleIssues` and
`outcomeOf` stop counting issues whose workflow state category is `triage` or
`backlog`. Those issues remain in the sprint and render under an "Uncommitted"
heading with their own counts, clearly marked as not counted.

`breakDownCycleIssues` additionally tallies points alongside issues, so the per
assignee rail can present both with correct labels. This is the fix for the
central complaint that a sprint does not show who holds how many points.

On completion, uncommitted issues always return to the backlog, whatever
destination was chosen for the rest. This matches Linear, and it prevents the
uncommitted pile from following a team from sprint to sprint forever.

## API

### Already sufficient, needing only UI

- `POST /api/issues/bulk` accepts `patch.cycleId` through
  `issueBulkUpdateSchema`, capped at 200 ids. Moving a selection of tasks
  between sprints needs one new control on `BulkEditBar`.
- `apps/web/src/lib/query/issue-search.ts` already maps the `cycle` filter
  property to a `cycleId` query parameter, and `issueFilterSchema` accepts it.
  Sprint scoped issue queries need `cycleId` added to `columnScopeKey` in
  `apps/web/src/lib/query/use-issues.ts`, which today understands only
  `teamId` and `projectId`.
- `issueMoveSchema` already carries `cycleId`, so dragging an issue into or out
  of a sprint needs no new move endpoint.

### Changed

`POST /api/cycles/[id]/complete` gains a body:

```
{ moveUnfinishedTo: 'backlog' | 'next' | <cycleId> }
```

`'next'` keeps today's behaviour of using, or creating, the following sprint.
An explicit cycle id is validated inside the transaction, under the existing
`lockTeamCycles` advisory lock, so a destination deleted concurrently fails
cleanly rather than orphaning issues.

`PATCH /api/teams/[id]` gains the three cadence fields.

### New

| Route | Purpose |
| --- | --- |
| `GET`, `PUT /api/cycles/[id]/capacity` | Read and write per person capacity |
| `POST /api/cycles/[id]/retros` | Create a retro |
| `GET /api/retros/[id]` | Read a retro with items and votes |
| `POST /api/retros/[id]/items` | Add a card |
| `PATCH`, `DELETE /api/retros/[id]/items/[itemId]` | Edit or remove a card |
| `POST /api/retros/[id]/items/[itemId]/vote` | Toggle a vote |
| `POST /api/retros/[id]/items/[itemId]/convert` | Turn an action item into an issue |

Every route parses its body with a Zod schema from `@orbit/shared`, and maps
typed domain errors to responses, as the existing cycle routes do.

## Realtime

Four new sync models: `cycleCapacity`, `sprintRetro`, `sprintRetroItem`,
`sprintRetroVote`. All publish on `scopes.team(teamId)`, matching `cycleScopes`
in `cycle-service.ts`, so a retro board is live for everyone in the room and no
new scope machinery is needed. Each mutation writes to Postgres, bumps
`sync_id` and publishes a `SyncAction`, as every other mutation does.

Sprint mutations in `apps/web/src/lib/query/use-sprints.ts` move off
`router.refresh()` onto optimistic TanStack cache updates reconciled by the
realtime stream.

## Permissions

`cycle:manage` gates sprint dates, cadence settings, completion, capacity
edits, and creating or deleting a retro.

Any member of the team may add, edit, delete and vote on their own retro cards.
Deleting another person's card requires `cycle:manage`. No new policy action is
introduced. As everywhere else, the server enforces this and the UI reads the
same policy only to hide affordances.

## Components

`apps/web/src/features/cycles/` is renamed `apps/web/src/features/sprints/`.
Every file in it is already named `sprint-*` and every route says sprint, so
the directory name is the last place the word cycle leaks into the interface.

| File | Responsibility |
| --- | --- |
| `sprint-roll-up.tsx` | The `/sprints` list, one row per team |
| `sprint-header.tsx` | Name, dates, duration, day N of M, actions |
| `sprint-dates-dialog.tsx` | Duration presets, date editing, shift following sprints |
| `sprint-tabs.tsx` | Tab bar and routing |
| `sprint-issue-view.tsx` | Client issue surface for Board and List tabs |
| `sprint-planning.tsx` | Two pane planning, backlog beside sprint |
| `capacity-rail.tsx` | Per person committed against capacity |
| `sprint-insights.tsx` | Burn up, scope changes, per assignee, velocity |
| `complete-sprint-dialog.tsx` | Completion with destination |
| `retro-board.tsx`, `retro-card.tsx` | Retrospective board |
| `sprint-actions.tsx` | Create, edit, start, delete buttons |
| `data.ts`, `capacity.ts`, `burn-up.ts` | Server queries and pure helpers |

`packages/core/src/work/cycle-service.ts` is 1000 lines before this work adds
capacity, retrospectives and selective completion. It splits along its existing
seams:

| Module | Contents |
| --- | --- |
| `cycle-service.ts` | Create, update, start, complete, delete, cadence |
| `cycle-progress.ts` | Burn up, membership replay, scope changes, outcomes |
| `cycle-capacity.ts` | Velocity and capacity resolution |
| `sprint-retro-service.ts` | Retrospectives |

`cycle-progress.ts` is roughly 250 lines moved without change, so the split is
mechanical and reviewable.

Reused rather than rebuilt: `Board`, `IssueList`, `IssueCard`, `BulkEditBar`,
`DisplayMenu`, `useIssueViewModel`, `useViewConfig`, `useMoveIssue`,
`LineChart`, `ProgressBar`, `Avatar`, `Dialog`, `EmptyState`, `useHotkey`.

## Data flow

The sprint page is a server shell passing three server computed values into a
client surface: the cycle row, `cycleProgress`, and `sprintOutcome` for a
completed sprint. Only the burn up genuinely needs the server, because it
replays `issue_activity` history to reconstruct membership over time.

Everything interactive is client side:

```
useViewConfig(team.id, layout, 'cycle')
  -> useAllIssues(query, { cycleId })
  -> useIssueViewModel(...)
  -> Board | IssueList
```

Group headers gain a points sum, so switching grouping to assignee answers
"who holds how many points" in one keystroke, on both Board and List.

The Planning tab is two panes sharing one `DndContext`. The sprint is on the
left, the team backlog on the right, filtered to states in the backlog and
unstarted categories with no sprint. The capacity rail sits beside the sprint
pane and recomputes assigned points client side as cards move, because the view
model already holds the estimates. Editing a capacity number issues an
optimistic `PUT`.

The completion dialog shows what shipped, what is unfinished, the destination
selector, and a line stating that uncommitted work returns to the backlog. On
success it patches the cache and routes to the completed sprint's Insights tab.

### Roll up query

The current page awaits `getActiveCycleView` once per team, and each call loads
every issue in that sprint and replays its full activity history for the burn
up. Eight teams is roughly twenty four sequential round trips to build a page
nobody can plan with.

One sprint replaces that with one read. The page loads the sprint the workspace
is running, its progress and its issues, and nothing repeats per team.

## Motion and theming

Capacity and progress bars set width statically with no transition. Animating
width forces reflow, which the repository forbids on the critical path. If a
bar ever animates it does so with `transform: scaleX()`. All hover and focus
transitions come from the shared tokens in `apps/web/src/lib/interaction.ts`.
No hex values in components; light and dark both come from CSS custom
properties.

## Standup

Standup is left alone. Filtering it by sprint already works, because the
capability matrix drops only `assignee` for the standup page. Two defects make
it useless in practice, and both are fixed in the filter system rather than in
Standup:

1. `filter-fields.tsx` labels every cycle option with bare `sprintLabel(cycle)`,
   so a viewer in eight teams sees "Sprint 1" eight times with no way to tell
   them apart. Cycle options gain a team key prefix whenever the view is not
   scoped to a single team.
2. A chosen cycle id goes stale the moment that sprint ends. A dynamic
   "Active sprint" option is added that always resolves to whatever is running
   for the relevant team.

Both improvements apply to every view that offers the cycle filter, not only
Standup.

## Edge cases

- Overlapping dates already throw `conflict` from `assertCycleWindow`. The date
  editor surfaces that inline rather than as a toast, and offers to shift the
  following sprints by the same number of days.
- Shifting following sprints touches only sprints that are neither started nor
  completed, and stops at the first completed sprint it meets.
- Cadence generation runs under `lockTeamCycles`, is idempotent, never creates
  a sprint overlapping an existing one, and never renumbers an existing sprint.
- Auto generated sprints store an empty name, so `sprintLabel` renders
  "Sprint N" and a custom name is always distinguishable from the default.
  `createCycle` and `completeCycle` both stop writing the literal default.
- A sprint whose issues carry no estimates says so instead of showing 0 of 0,
  and the burn up falls back to issue counts, as `burnUpMetric` already does.
- A retro card written by a since deleted user survives, attributed to a former
  member.
- Converting an action item when no next sprint exists creates the issue in the
  backlog and says so.
- Bulk moves chunk at the existing 200 id cap and report partial progress
  rather than failing the whole selection.
- Past sprints are read only: no drag, no capacity edit. Their retros stay
  editable, because a retrospective is often written after the sprint closes.
- `upcomingCycles` gains `isNull(completedAt)` so a completed future sprint
  stops listing as upcoming.

## Testing

Tests live in each package's own `tests/` tree mirroring `src/`, run with
`bun test`, and database tests run in a transaction that rolls back.

| Suite | Covers |
| --- | --- |
| `packages/core/tests/work/cycle-progress.test.ts` | Scope excludes triage and backlog, points against issues, an issue that leaves and returns, a sprint started mid day |
| `packages/core/tests/work/cycle-capacity.test.ts` | Velocity over three, fewer than three and zero completed sprints, the freeze on start, an override winning over an estimate, the team median fallback |
| `packages/core/tests/work/cycle-service.test.ts` | Completion into each destination, uncommitted always returning to backlog, outcome snapshot correctness, cadence idempotency, no overlap |
| `packages/core/tests/work/sprint-retro-service.test.ts` | Card lifecycle, vote uniqueness, convert to issue linkage, permission boundaries |
| `apps/web/tests/features/sprints/` | Capacity rail arithmetic, completion dialog destinations, the assignee points table, the uncommitted section |
| `apps/web/e2e/sprints.spec.ts` | One full loop: set capacity, drag from backlog, start, bulk move a task to the next sprint, complete with a destination, open a retro, convert an action item |

The per assignee tally gets an explicit test asserting it reports points, since
mixing points and issue counts in one panel is the defect that made the sprint
unreadable in the first place.

## Workstreams

One specification, six workstreams, landed in this order so each is
independently shippable and reviewable.

- A. Roll up and sprint page shell. Team scoped routes, `/sprints` becomes one
  row per team, header with inline naming, dates and duration.
- B. Scope correctness. Uncommitted exclusion, points alongside issues in
  `breakDownCycleIssues`, the naming and `upcomingCycles` fixes, `cycle-service`
  split.
- C. Issue surface. `ViewPage: 'cycle'` wired to Board and List, `cycleId` in
  `columnScopeKey`, points in group headers, sprint control on `BulkEditBar`,
  cycle filter labelling and the Active sprint option.
- D. Capacity and planning. `cycle_capacity`, velocity, the capacity rail, the
  two pane Planning tab.
- E. Completion. Destination selector, uncommitted returning to backlog,
  outcome snapshot corrections, TanStack mutations replacing `router.refresh()`.
- F. Retrospectives. Four tables, services, routes, realtime models, retro
  board, convert to issue.

Cadence generation lands with A as a team setting, defaulting to off, so no
existing team changes behaviour until it is switched on.

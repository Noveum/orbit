# Analytics planning cockpit redesign

Date: 2026-08-11
Branch: `codex/analytics-planning-insights`
Delivery: one pull request with small scoped commits, complete test evidence, and light and dark screenshots.

## Executive decision

Replace the current long analytics report with an opinionated planning cockpit that is useful with no setup. A direct visit to `/analytics` opens a preconfigured workspace overview, gives the active sprint first-class treatment, and automatically compares it with the latest trustworthy completed sprint when one exists. Filters, custom dates, people, projects, milestones, saved views, and exports remain optional depth rather than required setup.

The experience adopts the strongest parts of Linear's analytics model:

- The current view is the dataset.
- Useful cycle and project graphs appear automatically.
- Measure, filter, and grouping controls are compact and progressive.
- Hover and keyboard focus reveal exact values.
- Chart and table interactions identify the same underlying issues.
- Saved views and URLs preserve deeper investigations.
- Live state and frozen historical snapshots are visibly different.

Orbit keeps its own navigation, tokens, density, typography, and component language. This is an adaptation of Linear's interaction model, not a branded visual clone.

References:

- [Linear Insights](https://linear.app/docs/insights)
- [Linear filters](https://linear.app/docs/filters)
- [Linear dashboards](https://linear.app/docs/dashboards)
- [Linear cycle graph](https://linear.app/docs/cycle-graph)
- [Linear project graph](https://linear.app/docs/project-graph)

## Goals

1. Answer what is happening now without configuration.
2. Help plan sprint scope, project scope, milestones, assignments, and delivery pace.
3. Compare the current sprint with previous completed sprints without inventing history.
4. Explain what a person is assigned, has completed, and is carrying across the selected period.
5. Let every aggregate reveal the exact matching issue evidence.
6. Make filters, custom dates, comparison windows, saved views, and exports available without dominating the default page.
7. Keep the default page fast through bounded queries, hydration, progressive detail loading, and realtime invalidation.
8. Make every metric explicit about its formula, unit, timezone, coverage, and freshness.
9. Allow every authenticated workspace member to see workspace-wide analytics while preserving organization isolation.

## Non-goals

- A blank-canvas dashboard builder.
- Arbitrary formulas or custom SQL.
- Employee rankings or a composite productivity score.
- Calendar capacity, schedules, time off, or utilization targets.
- Predictive completion dates before enough trustworthy history exists.
- Fabricated historical sprint membership or completion attribution.
- Cross-workspace reporting.
- Changing team-scoped issue access outside the analytics surface.

## Default visit and repeat use

`/analytics` with no query parameters is a stable product view, not an empty report builder.

The default is:

- Lens: Overview.
- Scope: the whole workspace.
- Measure: issue count.
- Reporting window: the active sprint window when a single active sprint context is available, otherwise the last 30 days.
- Comparison: the latest completed sprint for sprint metrics and the preceding equal-length period for date metrics.
- Included work: active and completed issues, excluding archived and canceled work unless a card explicitly measures those cohorts.
- Grouping: the most relevant dimension for each preconfigured card.

The default URL remains clean. Advanced changes are serialized into the URL with default values omitted. A copied URL recreates the investigation. A deeper configuration becomes a repeat destination only when the user saves it and optionally pins it as their analytics default. Reset always returns to the workspace overview.

If several teams have overlapping active sprints, the Overview uses a bounded 30-day window and the Sprints lens asks for a team or sprint only after rendering a useful cross-team sprint summary. The page never blocks on a setup wizard.

## Information architecture

The page has one compact header and four lenses.

```text
AnalyticsPage
  AnalyticsCockpit
    AnalyticsHeader
      title, freshness, save, share, export
    AnalyticsToolbar
      primary date and comparison controls
      progressive filter chips and advanced menu
    AnalyticsTabs
      Overview | Sprints | Projects | People
    ActiveLens
      MetricStrip
      PrimaryInteractiveChart
      SupportingCardsAndTables
    AnalyticsDrilldownDialog
      predicate summary
      paginated issue evidence
```

The toolbar remains visible while scrolling. On narrow screens, the lens tabs scroll horizontally, the primary date context stays visible, advanced filters collapse into one summary button, metric cards become a horizontal snap row, and the drilldown becomes a full-width dialog.

## Shared toolbar and filter behavior

The primary row contains only the controls needed repeatedly:

- Reporting range.
- Comparison.
- Measure.
- Add filter.
- Save, share, and export.

Range presets are Active sprint, Previous sprint, Last 30 days, Last 90 days, All time, and Custom. Custom range uses a popover with start and end calendar dates, validation, keyboard labels, and preset shortcuts. The reporting range controls activity metrics such as created, completed, cycle time, and lead time. Current-state cards are labeled `Now` so a date range is never misread as a historical snapshot.

The advanced filter menu reuses Orbit's searchable command-menu pattern and the shared issue-filter language. It supports:

- Team.
- Project.
- Milestone.
- Sprint.
- Assignee and creator.
- State and state category.
- Label.
- Priority.
- Estimate.
- Created, updated, started, completed, due, and state-age dates.
- Blocked relations.
- Archived and canceled inclusion.

Filters support multiple values, negation, nested AND and OR groups, unset values, and relative dates where the existing issue filter model already supports them. Milestone options narrow after a project is selected. Points mode warns when selected teams or projects use incompatible estimate scales. Unestimated work remains zero points and is always shown as a separate count.

## Overview lens

The Overview is the daily return surface.

### Planning pulse

The first row contains concise cards with exact values and comparison deltas:

- Completed in range.
- Current WIP.
- Median cycle time with p85 context.
- Scope change.
- Blocked work.
- Overdue work.
- Stale work.
- Unestimated work.

Cards with current-state semantics carry a `Now` label. Cards with interval semantics carry the selected date label. Selecting a card opens its matching issue evidence.

### Delivery trend

The primary chart combines:

- Created work by bucket.
- Completed work by bucket.
- Current or reconstructed open scope.
- Optional previous-period comparison.

Daily buckets are used for short windows, weekly buckets for medium windows, and monthly buckets for long windows. The chart does not generate unbounded history from the oldest issue.

### Work health and mix

Supporting cards show current state distribution, work by project, work by priority, and flow-time outliers. Each visual is paired with exact totals and a semantic table. High-cardinality groups show a stable top set plus `Other`, with the full set available in the table.

## Sprints lens

The Sprints lens defaults to the most relevant active sprint and provides a team and sprint picker without making it a prerequisite for the rest of the page.

### Sprint pulse

- Planned scope.
- Final or current scope.
- Completed.
- Remaining.
- Added after start.
- Removed.
- Carryover.
- Elapsed working days.

Planned follows the Linear-compatible rule: an issue is planned when it entered the sprint before the start or within the first 24 hours after the start. The formula popover states this rule.

### Burn chart

A Burnup and Burndown toggle displays:

- Total scope.
- Started work.
- Completed work.
- Remaining work.
- Ideal target across working days.
- Daily completion bars.
- Added and removed scope annotations.
- Optional previous-sprint overlay normalized by sprint working day.

Hover or keyboard navigation shows exact scope, started, completed, remaining, added, and removed values for the active day. Selecting the day or series opens the matching cohort.

### Comparison and retrospective evidence

The lower section contains:

- Current versus previous sprint comparison.
- Velocity for the last six trustworthy completed sprints.
- Median and p85 cycle and lead time.
- Scope-change timeline.
- Planned, added, removed, completed, incomplete, and carryover issue tables.

If no completed sprint exists, the comparison area explains that Sprint 1 is being tracked and that comparison will appear after it closes. It never renders fake future sprints or zero-value velocity bars.

## Projects and milestones lens

The default view is a sortable portfolio table with:

- Project health and status.
- Lead and contributing teams.
- Current scope, WIP, and completed work.
- Scope change in the reporting window.
- Blocked, overdue, stale, and unestimated work.
- Target date and next milestone.
- Milestone completion.
- Current delivery pace without a forecast until history is sufficient.

Selecting a project keeps the user on the analytics page and applies a visible project context. The detail surface shows scope, started, and completed trends, milestone progress, assignee distribution, state and priority mix, health updates, risks, and underlying issues. A red target-date marker follows the project graph pattern when a target exists.

Predictions are deferred. A later version may add a weighted velocity forecast only after at least one full week of trustworthy data and must show optimistic and pessimistic ranges.

## People lens

Every authenticated workspace member may inspect every person in that workspace. The lens contains a searchable person picker and a cross-workspace workload table.

For a selected person it shows:

- Current assignments grouped by project, sprint, and state.
- Completed work in the selected range.
- Average throughput per active week or completed sprint.
- Median and p85 cycle time.
- Current WIP and WIP age.
- Blocked, overdue, stale, and unestimated work.
- Assignment and completion trend.
- Completed and currently assigned issue evidence.

The cross-person table defaults to a neutral name order and workload-health cues. It does not rank people by output and does not combine metrics into a score. Formula text explains that issue count and points are planning signals, not measures of employee value or effort.

Historical person attribution uses captured assignment facts when available. Existing pre-rollout data is labeled as current-assignee attribution or incomplete coverage rather than presented as exact assignee-at-completion history.

## Chart, table, and drilldown interaction

Every aggregate is evidence-backed.

- Pointer hover activates the nearest datapoint or segment.
- Keyboard focus enters a chart once; Left and Right move across points, Up and Down move across series, Home and End move to range boundaries, Enter opens evidence, and Escape returns focus.
- The tooltip names the period, series, exact value, comparison delta, unit, and relevant formula context.
- Active chart data highlights the corresponding table row or cell.
- Active table data highlights the corresponding chart series or segment.
- Color is never the only discriminator. Lines use labels, stroke styles, or symbols.
- Reduced motion disables drawing and layout-independent transitions.
- A semantic sortable table is always available.

The drilldown is a responsive right-side dialog on desktop and a full-width dialog on mobile. It shows the human-readable predicate, total, freshness, sortable paginated issue rows, and export action. It reuses Orbit issue identifiers, state glyphs, priorities, avatars, project identity, and issue peek patterns.

Analytics drilldowns use the analytics workspace-wide read contract. Normal team-scoped issue routes are not silently loosened. If a user cannot open an issue through the ordinary team policy, the complete analytics evidence remains available inside the drilldown without changing unrelated product permissions.

## Metric semantics

| Metric | Definition in the first release |
| --- | --- |
| Throughput | Issues with current final `completed_at` inside the reporting window |
| WIP | Current non-archived issues in started or review state categories |
| Cycle time | Final started episode to final completion |
| Lead time | Issue creation to final completion |
| WIP age | Time since entry into the current started or review state |
| Scope change | Captured sprint membership additions and removals |
| Planned sprint scope | Membership before sprint start or within the first 24 hours |
| Carryover | Open sprint work moved to the next sprint at close |
| Stale | Current open work beyond a visible state-age threshold |
| Overdue | Current open work whose due date is before today in the reporting timezone |
| Blocked | Current open work with an active `blocked_by` relation |
| Points | Stored estimate value, with unestimated work contributing zero and reported separately |
| Average throughput | Completed issues divided by active reporting weeks or completed sprints |

The page exposes formulas, inclusions, exclusions, timezone, and data coverage in a calculation popover. Reopened issues, archived issues, canceled issues, subtasks, and mixed estimate scales are explicitly identified.

## Historical data foundation

The current mutable `issue.cycle_id` cannot support trustworthy previous burn, commitment, churn, or carryover details. The first release adds durable sprint facts rather than making the new charts look more precise than the data.

### Cycle membership ledger

Add an append-oriented `cycle_issue_membership` table with:

- Organization, cycle, team, and issue identifiers.
- Membership occurrence identifier.
- Added time and optional removed time.
- Entry kind such as planned, added, or rollover.
- Estimate at addition.
- Assignee, project, and milestone at addition where available.
- Capture source and coverage marker for rollout bootstrapping.

An issue may have multiple membership intervals if it is removed and re-added. Cycle assignment during issue creation opens an interval. Every later `cycleId` mutation closes the previous interval and opens the next interval in the same transaction as the issue update. Automatic rollover writes the same facts instead of bypassing activity capture.

### Frozen cycle outcomes

Add a `cycle_issue_outcome` table unique by cycle and issue with:

- Planned membership flag.
- Estimate at commitment and close.
- Assignee, project, and milestone at close.
- Outcome: completed, canceled, incomplete, removed, or carryover.
- Completion and close times.
- Optional rollover destination.

Cycle close writes outcomes, the final aggregate progress snapshot, issue rollover membership, and cycle completion in one transaction. Existing `cycle.progress_snapshot` remains the historical aggregate fallback and is marked reconstructed when per-issue facts are absent.

### Daily snapshots

The existing `cycle_progress_snapshot` writer becomes a protected production cron. Snapshot dates use the cycle timezone, each cycle-day write is idempotent, and cycle close writes a final snapshot before the cycle stops being active. Failures can be retried without duplicate facts.

Pre-rollout history is not backfilled as fact. Current active sprints receive an observed bootstrap membership set with a visible `Tracking since` timestamp. Completed sprints retain trustworthy stored close aggregates when present, but daily curves and issue-level commitment remain unavailable unless captured.

Manual checkpoints are removed from the primary workflow because automatic snapshots replace their planning purpose. Existing checkpoint rows remain readable during migration.

## Shared contract and API

Add one versioned analytics schema in `packages/shared/src/validators/analytics.ts` containing:

- Lens.
- Range preset or custom dates.
- Comparison mode.
- Measure.
- Existing advanced issue `FilterGroup`.
- Archived and canceled inclusion.
- Focused sprint, project, milestone, or person.
- Saved-view schema version.

Core resolution converts presets into concrete instants, comparison windows, adaptive bucket granularity, and reporting timezone. The same normalized state powers server defaults, URL state, saved views, API queries, exports, and drilldowns.

Thin route bundles:

- `GET /api/analytics/overview`
- `GET /api/analytics/sprints`
- `GET /api/analytics/projects`
- `GET /api/analytics/people`
- `GET /api/analytics/drilldown`
- `GET /api/analytics/export`

Each aggregate route parses the shared schema and calls one core lens service. The initial default bundle is loaded directly on the server, schema-parsed into a JSON-safe form, inserted into a TanStack Query client, dehydrated, and rendered immediately. Filter and lens changes use the same query keys on the client. Drilldown rows are separately paginated so large evidence lists do not delay the planning summary.

Saved analytics views store the full normalized versioned configuration, not only the measure. Personal and workspace-shared views keep owner and admin mutation rules. A saved view may be pinned as the user's analytics default through the existing view-preference service.

## Authorization

Add an explicit `analytics:read` permission granted to every authenticated workspace role.

Every analytics core entry point:

1. Asserts `analytics:read`.
2. Requires `issue.organization_id = principal.organizationId` or the equivalent organization predicate.
3. Uses workspace-wide analytics visibility rather than the ordinary team-membership filter.
4. Applies the same visibility and normalized filter to aggregates, drilldowns, saved views, and exports.

Cross-organization access remains forbidden. Normal issue lists, team pages, and issue detail permissions do not change as part of this work.

## Package and component impact

| Area | Reuse | Required work |
| --- | --- | --- |
| `packages/shared` | Filter language, constants, errors, sync schemas | Analytics validator and `analytics:read` policy |
| `packages/db` | Issue, activity, cycle, snapshot, saved-view schemas | Membership and outcome tables, snapshot timezone/final fields, evidenced indexes, migrations |
| `packages/core` | Issue predicate compiler, analytics math, saved views, cycle close, snapshots | Shared issue-query boundary and four bounded lens services, drilldown, capture transactions |
| `apps/web` | App shell, tokens, filter chips, cmdk, Radix primitives, TanStack Query, issue rows, project components, skeletons | Cockpit, toolbar, date range, tabs, four lenses, interactive plots, evidence dialog, routes |
| `packages/realtime-client` | Existing client and provider | No protocol change expected |
| `packages/realtime-server` | Existing sync-action transport and replay | No protocol change expected |
| `apps/realtime` | Existing server composition | No change expected |
| `packages/services` | Existing notification and integrations | No change expected |
| `packages/mcp-server` | Existing task and planning tools | No change in this pull request |

Existing web primitives to reuse include `Button`, `Popover`, `DropdownMenu`, `Select`, `Tooltip`, `Dialog`, `ScrollArea`, `Avatar`, `Badge`, `EmptyState`, `Skeleton`, `Checkbox`, `Switch`, and `Input`. Existing feature patterns to reuse include `FilterBar`, `FilterMenu`, `useViewConfig`, saved-view dialogs, project health chips, issue rows, issue peek, chart geometry, and chart data tables.

The existing analytics line, bar, histogram, and burndown components are starting points, not finished primitives. They gain a shared plot frame, axes, focus model, crosshair, tooltip, linked table highlighting, comparison styling, empty and error states, and semantic drilldown identifiers.

## Data flow

```text
request /analytics
  -> session and active workspace principal
  -> resolve clean-URL defaults
  -> core lens service
  -> bounded PostgreSQL aggregates
  -> schema-safe hydrated query payload
  -> AnalyticsCockpit renders immediately

filter, lens, or date change
  -> canonical URL state
  -> TanStack analytics query key
  -> thin analytics route
  -> same core lens service

issue, cycle, project, milestone, label, member, or team sync action
  -> DeltaBridge batches relevant events
  -> invalidate analytics root once
  -> mounted lens refetches

chart or metric selection
  -> semantic cohort plus normalized filters
  -> paginated analytics drilldown
  -> identical predicate export
```

The originating tab already suppresses its own realtime cache patches. Any issue mutation initiated from analytics must explicitly invalidate the analytics query root on mutation success or settlement.

## Performance design

- Default range is bounded and long ranges use coarser buckets.
- Only the active lens loads detailed aggregates.
- Default summary rendering never waits for drilldown rows.
- Each lens consolidates current-state and interval aggregates into one or a small number of PostgreSQL statements built from one filtered issue CTE.
- Repeated cycle authorization and issue scans are removed.
- Percentiles move to PostgreSQL when row volume justifies it.
- High-cardinality output is capped and paginated.
- TanStack hydration and its existing 30-second stale behavior are reused.
- Realtime actions invalidate aggregates instead of attempting partial arithmetic patches.
- No process-memory multi-tenant cache is added on Vercel.
- Cross-request caching is deferred until measurement proves it necessary. Any future cache key must include organization and canonical filters.
- Representative queries are inspected with `EXPLAIN (ANALYZE, BUFFERS)` before adding indexes.
- Initial chart payloads target fewer than 150 KB and at most 120 plotted buckets.

Orbit's existing Web Vitals reporter automatically measures the route. Backend query latency is evaluated directly during development because the repository does not yet have a query timing service.

## Loading, error, empty, and freshness states

- Lens-aware skeletons preserve final layout dimensions.
- A failed supporting panel does not erase a successfully loaded primary summary.
- Invalid URL configuration falls back to safe defaults and exposes a dismissible reset notice.
- No matching issues explains the active filters and offers Clear filters.
- No completed sprint explains when comparisons will begin.
- Incomplete history shows `Tracking since` and distinguishes observed, reconstructed, and frozen data.
- No estimate configuration defaults to issues and explains why points are unavailable.
- Freshness reads `Live`, `Updated at`, or `Snapshot at` rather than leaving users to infer it.

## Testing strategy

All implementation follows red, green, refactor with tests in package test trees.

### Shared and policy

- Default omission and canonical URL round trips.
- Date presets, custom ordering, comparison resolution, and adaptive buckets.
- Advanced filter parsing.
- Every workspace role receives `analytics:read`.
- Cross-workspace access remains denied.

### Core and database

- Overview aggregates reconcile with semantic drilldowns.
- Project, milestone, sprint, person, date, state, label, priority, estimate, archived, and canceled filters.
- Same-day sprint addition and removal.
- Removal and re-addition.
- Planned 24-hour rule.
- Estimate changes.
- Rollover and carryover issue identities.
- Atomic cycle close outcomes and final snapshots.
- Reopened issues and final-completion semantics.
- Current, reconstructed, and frozen coverage states.
- Timezone boundaries.
- Workspace-wide roles and cross-organization isolation.

### Web routes and components

- Thin route authentication, validation, and response schemas.
- Export parity, row limits, and spreadsheet formula defense.
- Cron missing, wrong, and valid secret behavior plus idempotence.
- Useful zero-configuration first render.
- Toolbar URL behavior, custom dates, saved views, and reset.
- Tab roving keyboard behavior.
- Hover and keyboard tooltip parity.
- Chart and table cross-highlighting.
- Click and Enter drilldown parity.
- Narrow layout, reduced motion, light theme, and dark theme.
- First-sprint and incomplete-history messaging.
- Realtime burst coalescing, relevant models, unrelated models, own tab, reconnect, and truncated replay.

### End to end and performance

- Seeded workspace overview.
- Date, project, person, and sprint changes survive reload and sharing.
- Previous sprint comparison state.
- Tooltip and issue evidence dialog.
- Dedicated isolated E2E database and ports because the current global setup reseeds its database.
- Light and dark screenshots plus hover and advanced-filter screenshots.
- Query-plan inspection and bounded payload verification.
- Lane-scoped `bun run verify`, production build, isolated Playwright suite, and screenshot capture.

## Rollout and compatibility

1. Ship schema migrations before code that writes membership and outcome facts.
2. Start capture for existing active sprints with incomplete-coverage markers.
3. Schedule daily snapshots and alert through route failures and logs.
4. Keep reading legacy saved analytics configurations by migrating them to versioned defaults at parse time.
5. Retain existing checkpoint rows but remove the primary Add checkpoint affordance.
6. Render historical features only to the fidelity supported by each sprint's coverage state.
7. Keep old analytics endpoints temporarily only where required during the component migration, then remove unused code and tests in the same pull request.

There is no destructive historical backfill. Rollback may stop using the new tables while leaving captured rows intact. The old page is replaced only after the new default lens and routes pass integration and browser tests.

## Tradeoffs and future revisions

### Chosen tradeoffs

- Opinionated lenses over a blank dashboard builder make the page useful immediately.
- A dedicated analytics authorization contract avoids weakening unrelated issue permissions.
- New sprint facts increase schema and service complexity but are required for trustworthy previous burn and carryover.
- Lightweight custom SVG preserves bundle size but requires deliberate accessibility work.
- No shared server cache keeps isolation and freshness simple until query evidence justifies more infrastructure.

### Revisit as usage grows

- Daily aggregate fact tables for very large workspaces.
- Weighted project completion forecasts with minimum-history requirements.
- Custom insight creation and promotion into dashboards.
- Capacity calendars and time-off aware workload.
- Scheduled reports and image or PDF exports.
- Typed state and assignment interval facts for exact historical WIP and cumulative active time.

## Acceptance summary

The work is complete when a workspace member can open `/analytics` with no setup and understand current delivery, sprint health, project and milestone risk, and person workload; optionally refine the view with Linear-style filters and dates; inspect exact values with mouse or keyboard; drill from every signal to matching issues; save or share the view; trust previous sprint data according to visible coverage; see updates without reloading; and use the page quickly in both light and dark themes.

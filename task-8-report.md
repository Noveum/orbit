# Task 8 report: trustworthy sprint analytics

## Shared truth

`loadSprintAnalytics(principal, query, context)` is the canonical sprint analytics service for the analytics and sprint surfaces. The legacy `cycleBurndown` API delegates to this service and only adapts its return shape, so there is one scope, completion, and remaining-work formula.

- Sprint scope comes from captured membership intervals. Legacy direct assignments without intervals are labeled observed rather than reconstructed as planned.
- Planned work entered through a captured membership before sprint start or within 24 hours after start. Observed bootstrap rows never become planned by inference.
- Added and removed counts are event counts, so a same-day add and remove remains visible even when net scope is unchanged. Re-additions create distinct intervals.
- Triage, backlog, and canceled work is not committed sprint scope.
- Current-day burn combines membership facts with current issue completion, estimate, and assignment facts, so completion moves the graph before the next daily snapshot.
- Completed sprint result and person attribution prefer frozen outcome facts. Rollover membership and outcome facts identify carryover.
- Points treat null estimates as zero while the summary exposes the explicit unestimated issue count.
- Burn dates use the sprint timezone. Calendar-day and Monday-to-Friday working-day indices are returned so a previous sprint can be aligned without pretending weekends are working days.
- Lead time is issue creation to completion. Cycle time is the currently recorded start to completion. The service reports `unavailable` rather than inventing a historical first start when the source fact is absent.
- Formula metadata is returned for UI tooltips and coverage is labeled captured, observed, frozen, or reconstructed.
- Overall burn, per-team summaries, per-person burn, and optional person focus use the same facts. Person focus is resolved from `focus.personId` or a single positive assignee filter.

## Coverage

Real-Postgres tests cover local-day completion between snapshots, same-day net-zero churn, removal history, re-addition intervals, the captured 24-hour rule, uncommitted work, issue and point measures, null estimates, rollover and carryover, frozen previous results, first-sprint state, workspace cross-team attribution, archived history, assignee changes, personal burn, and current My work.

Existing membership and cycle suites additionally cover direct moves between sprints, rollover capture, deletion ordering, bootstrap repair, cross-workspace isolation, final snapshots, and daylight-saving snapshot days.

## Query shape and plan

The service bounds sprint selection to one selected sprint, one previous sprint, and six completed velocity sprints. It loads membership, outcome, snapshot, current issue, activity, and person-name facts for those sprint and issue identifiers. No unbounded history or raw workspace issue scan is returned.

A representative membership aggregation was inspected with `EXPLAIN (ANALYZE, BUFFERS)` against an isolated real-Postgres test lane.

- Execution time: 0.321 ms
- Planning time: 2.512 ms
- Shared buffers: 5 execution hits/reads
- Returned rows: 1
- Memory: 25 kB per sort
- The tiny fixture selected sequential scans. Production membership predicates are covered by `cycle_issue_membership_cycle_added_idx` and `cycle_issue_membership_cycle_removed_idx`.

## Verification

- RED: sprint analytics test import failed because `analytics/sprints.ts` and `loadSprintAnalytics` did not exist.
- GREEN: focused sprint and legacy burndown compatibility passed 16 tests with 58 assertions.
- GREEN: expanded full core real-Postgres suite passed 878 tests with 2,376 assertions across 62 files.
- GREEN: core typecheck, lint, comment policy, source byte check, shipped Bun import check, dependency dedupe, and diff check passed.
- Three monorepo verify attempts passed every static and type gate but reported package-level parallel test interference: the first two had the same five web sprint database-order failures, and the third additionally had one database catchup hook timeout at 30 seconds. The full web suite immediately passed on the exact same isolated lane when run alone with its package environment. The full core suite and focused Task 8 suite passed separately. No Task 8 or legacy burndown test failed in any run.

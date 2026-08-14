# Task 8 report: trustworthy sprint analytics

## Shared truth

`loadSprintAnalytics(principal, query, context)` is the shared core contract ready for analytics and sprint consumers. The legacy analytics `cycleBurndown` API delegates to this service and only adapts its return shape, so existing analytics uses one scope, completion, and remaining-work formula. The sprint page still calls `cycleProgress`; wiring that UI and My Work to this contract remains future Task 14 work.

- Sprint scope comes from captured membership intervals. Legacy direct assignments without intervals are labeled observed rather than reconstructed as planned.
- Planned work entered through a captured membership before sprint start or within 24 hours after start. Commitment is evaluated at each membership entry time, so a later state change inside the window does not rewrite whether that entry was planned. A known triage, backlog, or canceled category at entry excludes it. When entry-state coverage is absent, the result retains membership-planned scope and labels coverage observed instead of applying current state backward.
- Added and removed counts are event counts, so a same-day add and remove remains visible even when net scope is unchanged. Re-additions create distinct intervals.
- Triage, backlog, and canceled work exits committed scope at its recorded transition. A reverse transition enters scope at that event. Current categories and close outcomes are never projected backward over earlier days.
- Completion and reopen state transitions form temporal completion episodes, so active burn decreases on completion and rises again on reopen.
- Current-day burn combines membership facts with current issue completion, estimate, and assignment facts, so completion moves the graph before the next daily snapshot.
- Completed sprint person burn resolves assignment from membership and assignment activity at each historical point. Close assignee is used at close or as a fallback when earlier assignment history is unavailable, so it cannot rewrite prior personal burn. Rollover membership and outcome facts identify carryover.
- Points treat null estimates as zero while the summary exposes the explicit unestimated issue count.
- Burn dates use the sprint timezone. Calendar-day and Monday-to-Friday working-day indices are returned so a previous sprint can be aligned without pretending weekends are working days.
- Lead time is the retained current issue-row creation time to durable completion and is unavailable for deleted rows. Cycle time is the mutable current `startedAt` column to completion. Completed sprint cycle time is explicitly `reconstructed-current-column`, never frozen, because outcomes do not retain a first-start fact.
- Formula metadata is returned for UI tooltips. Frozen coverage requires outcomes for every relevant issue, a final snapshot, and captured relevant membership intervals. Partial or observed completed history is reconstructed, and missing entry-state or bootstrap facts remain observed while active.
- Overall burn, per-team summaries, per-person burn, and optional person focus use the same facts. Person focus is resolved from `focus.personId` or a single positive assignee filter.

## Coverage

Real-Postgres tests cover local-day completion between snapshots, completion and reopen episodes, forward-only committed-state transitions, entry-time planned classification in both state-transition directions, same-day net-zero churn, removal history, re-addition intervals, the captured 24-hour rule, unknown entry-state coverage, issue and point measures, null estimates, rollover and carryover, complete, partial, and observed close coverage, temporal previous selection, as-of velocity bounds, first-sprint state, workspace cross-team interval attribution, archived history, active and completed-sprint assignee changes, personal burn, and current My Work.

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
- Review RED: five focused regressions demonstrated backward-applied current status, missing reopen episodes, number-based previous selection, and incorrectly frozen partial outcomes.
- Review round 2 RED: four regressions demonstrated cutoff-time planned classification, close-assignee history rewriting, and observed memberships incorrectly called frozen.
- GREEN: focused sprint and legacy burndown compatibility passed 26 tests with 78 assertions.
- GREEN: lint, comment policy, source byte check, shipped Bun import check, dependency dedupe, monorepo typecheck, and diff check passed after review round 2.
- The review round 2 full core real-Postgres run passed 887 of 888 tests with 2,395 assertions. Its only failure was an unrelated issue-service `beforeEach` timeout; that exact test immediately passed alone in 164 ms. The earlier expanded run passed 883 of 884 tests with one analogous shared-database fixture race. Focused sprint and legacy burndown compatibility pass together in isolation.
- Three monorepo verify attempts passed every static and type gate but reported package-level parallel test interference: the first two had the same five web sprint database-order failures, and the third additionally had one database catchup hook timeout at 30 seconds. The full web suite immediately passed on the exact same isolated lane when run alone with its package environment. Focused Task 8 and legacy burndown compatibility pass together on an isolated database lane.

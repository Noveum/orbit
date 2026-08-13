# Task 7 report: workspace overview and semantic drilldown

## Semantics

- The reporting interval is half-open: `from <= timestamp < to`.
- Current WIP is non-archived work in `started` or `review` state categories.
- Blocked work is current open work with a stored `blocked_by` relation.
- Overdue work is current open work with a due date before the reporting day at `asOf` in the reporting timezone.
- Stale work is current open work whose `updated_at` is older than 14 days at `asOf`.
- Unestimated work is current open work whose estimate is null. It is always reported as an issue count.
- Throughput is work whose current final `completed_at` falls in the resolved reporting interval.
- Cycle time is `completed_at - started_at` for valid interval completions with `completed_at >= started_at`.
- Task 7 does not expose lead time. Lead time would begin at creation, so it is not used as a label for the start-to-completion cycle metric.
- Points mode treats a null estimate as zero points while the unestimated card remains a separate issue count.
- Archived and canceled work are included only when their query toggles are enabled.
- Named, relative, and explicit date filters use UTC bounds for reporting calendar days derived from `asOf` and the reporting timezone. Ordinary issue-list callers retain their existing clock contract.
- Delivery open counts exclude work canceled at or before a bucket boundary and include work canceled after that boundary.
- Empty or malformed comparison cycle data produces null percentiles and null comparison deltas. Drilldown details expose the valid cycle count.

Every overview card, delivery point, distribution bucket, and outlier carries a semantic cohort consumed by the same predicate compiler as the drilldown. Count and points metrics reconcile with drilldown totals. Cycle-time p50 and p85 reconcile with named drilldown details computed over the cohort rather than comparing a day value with a row count.

## Query shape and bounds

The overview has two sequential query phases and eight bounded SQL statements in total. Three parallel context statements resolve the user timezone, workspace cycles, and earliest issue. Five parallel payload statements calculate throughput and percentiles, current health, distributions, delivery buckets, and ten flow outliers. Bucket generation is capped by the existing 120-bucket resolver. Each state, project, and priority distribution exposes at most eight ranked buckets plus `Other`. Its distribution statement materializes one filtered issue CTE and expands all three dimensions from that one scan. The overview never returns raw issue rows.

Drilldown has five bounded SQL statements: the same three context statements, one aggregate statement, and one page statement. Pages use deterministic issue-id keyset ordering, cap the requested limit at 200, and return compact issue identity and presentation fields. Cursors validate the issue UUID and use HMAC-SHA256 authentication over the organization, normalized query, measure, cohort, bucket, and a carried resolution snapshot containing the first-page clock, ranges, and timezone. A later page verifies the signature before using that clock, resolves the query from the authenticated snapshot, and rejects a mismatch. Semantic cohort parsing accepts only exact card and delivery keys, repository UUIDs for state, project, and outlier suffixes, the supported `none` and `other` buckets, and repository priorities 0 through 4.

## Query plan

A representative consolidated distribution statement was inspected with `EXPLAIN (ANALYZE, BUFFERS)` against the local seeded workspace.

- Execution time: 0.377 ms
- Planning time: 5.221 ms
- Shared buffers: 21 hits
- Filtered rows: 31
- Returned distribution rows: 18
- Plan: one materialized filtered issue CTE, one workflow-state hash join, memoized project lookups, one three-row lateral dimension expansion, grouped ranking, and capped collapse
- Memory: 20 kB for the filtered CTE, 32 kB for each aggregate, and 27 kB for the ranking sort

PostgreSQL selected sequential scans for the small seeded tables. The execution evidence does not justify adding an index in Task 7. Existing issue indexes already cover organization and completion, team ordering, updated time, creation time, project, cycle, milestone, and relation lookup paths.

## Test evidence

- RED: focused core typecheck failed because `analytics/overview.ts` and `analytics/drilldown.ts` did not exist.
- GREEN: focused core typecheck passed.
- GREEN: Task 7 real-Postgres tests passed, 6 tests and 88 assertions.
- GREEN: full core real-Postgres test suite passed after the initial implementation.
- GREEN: comment policy and shipped Bun import checks passed.
- GREEN: `ORBIT_TEST_LANE=analytics-cockpit bun run verify` passed after final formatting and reconciliation coverage.
- Review RED: 11 focused real-Postgres tests produced 6 passes and 5 expected assertion failures for timezone dates, distribution bounds, cancellation boundaries, comparison nullability, and cursor authentication.
- Review GREEN: the expanded Task 7 suite passed 11 tests and 106 assertions on the isolated `task7-review-round1` PostgreSQL lane.
- Review GREEN: `ORBIT_TEST_LANE=task7-review-round1 bun run verify` completed naturally with exit 0 against six fresh current-schema disposable databases. Core passed 823 tests with 2,225 assertions, web passed 1,884 tests with 4,664 assertions, every other package passed, and lint, comments, source bytes, shipped Bun imports, dependency dedupe, and all package typechecks passed.
- Review round 2 RED: the focused real-Postgres drilldown suite passed 3 tests and failed 2 expected regressions because a page-one cursor failed at a later service clock and malformed cohort suffixes reached SQL coercion.
- Review round 2 GREEN: the expanded focused Task 7 suite passed 13 tests and 125 assertions on the isolated `task7-review-round2` PostgreSQL lane.
- Review round 2 GREEN: the full core suite passed 825 tests with 2,243 assertions on a fresh current-schema database.
- Review round 2 GREEN: `ORBIT_TEST_LANE=task7-review-round2 bun run verify` completed naturally with exit 0 against six fresh current-schema disposable databases. Web passed 1,884 tests with 4,664 assertions, every other package passed, and all static gates passed.

The Task 7 tests cover card, delivery, distribution, and outlier reconciliation; cycle-time p50 and p85 detail reconciliation; issues and points; previous-period deltas; unestimated points behavior; archived and canceled toggles; workspace-wide guest, contributor, and member visibility; organization isolation; reporting timezone date bounds; more than eight projects with `Other` reconciliation; cancellation boundary reconstruction; malformed and empty cycle comparisons; compact drilldown rows; deterministic pagination; maximum page bounds; pagination across changing service clocks; cursor snapshot tampering; strict cohort syntax; and cursor reuse across cohort, query, date, and organization boundaries.

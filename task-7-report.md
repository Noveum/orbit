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
- Points mode treats a null estimate as zero points while the unestimated card remains a separate issue count.
- Archived and canceled work are included only when their query toggles are enabled.

Every overview card, delivery point, distribution bucket, and outlier carries a semantic cohort consumed by the same predicate compiler as the drilldown. Count and points metrics reconcile with drilldown totals. Cycle-time p50 and p85 reconcile with named drilldown details computed over the cohort rather than comparing a day value with a row count.

## Query shape and bounds

The overview resolves the query once, then runs bounded aggregate statements for throughput and percentiles, current health, distributions, delivery buckets, and ten flow outliers. Bucket generation is capped by the existing 120-bucket resolver. The overview never returns raw issue rows.

Drilldown runs one aggregate statement and one page statement. Pages use deterministic issue-id keyset ordering, cap the requested limit at 200, return compact issue identity and presentation fields, and bind cursors to their semantic cohort.

## Query plan

A representative overview aggregate was inspected with `EXPLAIN (ANALYZE, BUFFERS)` against the local seeded workspace.

- Execution time: 1.264 ms
- Planning time: 19.099 ms
- Shared buffers: 12 hits, 4 reads
- Filtered rows: 31
- Aggregate rows: 1
- Plan: one materialized filtered issue CTE, one workflow-state hash join, one aggregate
- Memory: 21 kB for the filtered CTE and 10 kB for the hash

PostgreSQL selected sequential scans for the small seeded tables. The execution evidence does not justify adding an index in Task 7. Existing issue indexes already cover organization and completion, team ordering, updated time, creation time, project, cycle, milestone, and relation lookup paths.

## Test evidence

- RED: focused core typecheck failed because `analytics/overview.ts` and `analytics/drilldown.ts` did not exist.
- GREEN: focused core typecheck passed.
- GREEN: Task 7 real-Postgres tests passed, 6 tests and 88 assertions.
- GREEN: full core real-Postgres test suite passed after the initial implementation.
- GREEN: comment policy and shipped Bun import checks passed.
- GREEN: `ORBIT_TEST_LANE=analytics-cockpit bun run verify` passed after final formatting and reconciliation coverage.

The Task 7 tests cover card, delivery, distribution, and outlier reconciliation; cycle-time p50 and p85 detail reconciliation; issues and points; previous-period deltas; unestimated points behavior; archived and canceled toggles; workspace-wide guest, contributor, and member visibility; organization isolation; compact drilldown rows; deterministic pagination; maximum page bounds; and cursor cohort binding.

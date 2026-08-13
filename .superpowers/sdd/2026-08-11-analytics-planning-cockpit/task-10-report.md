# Task 10 report

## Files changed

- `packages/core/src/analytics/people.ts`
- `packages/core/src/analytics/person-attribution.ts`
- `packages/core/src/analytics/drilldown.ts`
- `packages/core/src/analytics/index.ts`
- `packages/core/tests/analytics/people.test.ts`

## RED

The first focused real PostgreSQL test was written before the service existed.

```sh
ORBIT_TEST_LANE=analytics-task-10 bun run --filter '@orbit/core' test tests/analytics/people.test.ts
```

Initial result:

```text
Cannot find module '../../src/analytics/people.ts'
0 pass
1 fail
1 error
```

A later focused regression combined two assignment events and two completions in one day. It proved that joining raw event sets multiplied point totals:

```text
assignedPoints expected 12, received 24
completedPoints expected 12, received 24
5 pass
1 fail
```

The timeline now aggregates each event set by bucket before joining it to the bounded date series.

Review round 1 added four real PostgreSQL regressions. The observed failures were active weeks `13` instead of `1` for one old completion, a missing focused Unassigned identity, a focused OR-filter completion count of `0` instead of `1`, and repeated assignment points of `10` instead of `5`. A schema test separately proved both attribution indexes were absent.

The final narrow regression swapped both issues to different current assignees after completion. Under `(assignee=A OR project=P)`, the unfocused A row reported zero completions and zero active weeks instead of one each. This proved the person-aware predicate still applied only to focus.

## GREEN

Focused real PostgreSQL result after review round 1:

```text
11 pass
0 fail
46 expect() calls
```

The cases cover principal focus, workspace-wide alphabetic switching, organization isolation, workload and flow formulas, strict cohort reconciliation, historical attribution, former and deleted users, unassigned work, the 100-person cap, assignment episodes, custom and all-time windows, and exact Task 8 personal sprint burn delegation.

Full core regression result before the final timeline hardening:

```text
Exited with code 0
```

Shared regression result:

```text
247 pass
0 fail
582 expect() calls
```

Core and shared typechecks, lint, comment policy, Bun import policy, dependency policy, and diff whitespace checks passed. The final repository verification result is recorded in DONE.

## People and My Work semantics

- A People lens request without an explicit person focuses the current principal.
- A single positive assignee selection focuses that person. The unassigned sentinel focuses the neutral Unassigned identity.
- The list includes every evidenced person in the workspace across roles and teams, remains organization isolated, sorts by name then id, and stops at 100 rows with total and truncation metadata.
- Current assignments count current non-archived and non-canceled open issues assigned to the person. Null estimates add zero points and stay visible in the unestimated count.
- Completed work uses final `completedAt` in the half-open report interval. It prefers a matching captured cycle close outcome, reconstructs the assignee at completion from assignment activity next, and labels current assignee as the fallback.
- Former members stay visible when current issues, sprint membership, close outcomes, or assignment activity supply evidence. Missing users render as Deleted user without dereferencing a deleted row.
- Active-week throughput divides completions by distinct seven-day report buckets that overlap an assignment episode or contain an attributed completion. The buckets are anchored at the resolved range start.
- Assignment episodes stop at reassignment or the earliest retained completion, cancellation, archive, and report boundary. Earlier close and reopen intervals are counted only when retained activity supports them, so fallback coverage does not invent reopen history.
- Focused historical metrics evaluate assignee predicates as booleans for that person inside the normalized AND and OR tree, including negated conditions. Current cohorts keep the exact current query. A disjunction with a non-assignee branch does not falsely collapse the People list to one selected person.
- Cycle time uses valid non-negative `startedAt` to `completedAt` intervals. Lead time uses valid non-negative `createdAt` to `completedAt` intervals. Both return valid sample count, p50, and p85.
- WIP age measures current started or review work from `stateEnteredAt` to the injected `asOf` time and reports valid count, p50, and p85.
- Blocked, overdue, stale, and unestimated are neutral current-work signals. No score, composite, rank, or productivity label is produced.
- Focus details include bounded project, milestone, sprint, and state groups plus a 120-point assignment and completion timeline.
- Current and previous personal sprint burn values are delegated to `loadSprintAnalytics` with the selected person and compare equal to Task 8 output.

## Drilldown reconciliation

Strict UUID or Unassigned person cohorts were added for current assignments, completed work, WIP, blocked, overdue, stale, unestimated, assignment buckets, and focused project, milestone, sprint, and state groups.

Current-work cohorts preserve current assignee filtering. Historical completion and assignment cohorts simplify the query's assignee predicates for the cohort person and apply captured or reconstructed person semantics. Pagination retains the existing signed cursor, 200-row hard cap, request binding, and frozen resolution behavior.

Assignment timeline facts are distinct by person, issue, and bucket before issue and point aggregation. Repeated evidence for one assignment therefore contributes one issue and one estimate, matching its semantic drilldown.

Completion and active-week aggregates now evaluate the simplified predicate for every visible identity in one bounded SQL statement per metric. The CASE is limited to the at-most-100 list plus an explicit focus, avoids N+1 queries, and supplies the same maps to table and focused rows.

The focused test opens every summary count cohort and proves that drilldown totals equal the displayed counts.

## Query plan

A representative `EXPLAIN (ANALYZE, BUFFERS)` used the isolated Task 10 PostgreSQL lane with an organization predicate, bounded People identity selection, materialized current work, and grouped metrics.

```text
Planning Time: 1.836 ms
Execution Time: 0.395 ms
Shared buffer hits: 15
Sort memory: 25 kB
```

The plan used `member_org_idx` and `issue_org_active_idx`, used workflow-state primary-key scans, stayed in memory, and had no response path beyond the 100-person and focused-detail caps.

Review round 1 generated migration `0008_colossal_dorian_gray.sql` with partial completion and assignee-activity attribution indexes. High-cardinality plans used both new indexes: the 50,000-row outcome lookup executed in `0.131 ms` with five shared buffers, and the 100,000-row mixed-field activity lookup executed in `0.044 ms` with five shared buffers. Migration-only installation passed `3/3`, schema index assertions passed `21/21`, and drift reported every declared table and column present.

## DONE

The repository gates were run with:

```sh
ORBIT_TEST_LANE=analyticst10finalb8ac19 bun run verify
```

Lint, comment policy, source-byte policy, Bun import policy, dependency policy, every typecheck, the 905-test core suite, and the People suite passed. The parallel repository test phase reproduced the known 30-second `@orbit/db` catchup hook timeout under package load. The run was stopped after the same timeout had already determined its nonzero result.

The database package was immediately rerun alone on a fresh lane:

```sh
ORBIT_TEST_LANE=analyticst10dbisolated7c2a bun run --filter '@orbit/db' test
```

```text
233 pass
0 fail
601 expect() calls
```

The timeout is environmental and does not reproduce without parallel package load. No Task 10 or other core test failed.

## Concerns

- Root lint reports the existing Biome schema information and the existing test string warning. It exits successfully.
- The full parallel test command cannot report exit 0 in this environment because the database catchup cleanup hook reaches its fixed 30-second timeout under repository-wide load. The isolated database suite exits 0.
- Review round 1 full core reached `903 pass` with six pre-existing `view-filter-repair` failures caused by postgres.js `UNSAFE_TRANSACTION`; all six reproduce when that file runs alone. Full database reached `235 pass` with the same known catchup cleanup hook timeout. People, migration, index, typecheck, lint, comment, byte, Bun import, dependency, and diff gates pass independently.

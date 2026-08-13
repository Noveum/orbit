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

## GREEN

Focused real PostgreSQL result:

```text
7 pass
0 fail
38 expect() calls
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
- Cycle time uses valid non-negative `startedAt` to `completedAt` intervals. Lead time uses valid non-negative `createdAt` to `completedAt` intervals. Both return valid sample count, p50, and p85.
- WIP age measures current started or review work from `stateEnteredAt` to the injected `asOf` time and reports valid count, p50, and p85.
- Blocked, overdue, stale, and unestimated are neutral current-work signals. No score, composite, rank, or productivity label is produced.
- Focus details include bounded project, milestone, sprint, and state groups plus a 120-point assignment and completion timeline.
- Current and previous personal sprint burn values are delegated to `loadSprintAnalytics` with the selected person and compare equal to Task 8 output.

## Drilldown reconciliation

Strict UUID or Unassigned person cohorts were added for current assignments, completed work, WIP, blocked, overdue, stale, unestimated, assignment buckets, and focused project, milestone, sprint, and state groups.

Current-work cohorts preserve current assignee filtering. Historical completion and assignment cohorts remove the query's current-assignee condition and apply captured or reconstructed person semantics instead. Pagination retains the existing signed cursor, 200-row hard cap, request binding, and frozen resolution behavior.

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

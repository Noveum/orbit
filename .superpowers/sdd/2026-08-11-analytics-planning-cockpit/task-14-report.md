# Task 14 report

## Outcome

The Overview and Sprint lenses now render the approved analytics response contracts with the shared interactive chart and evidence primitives.

Overview provides clickable planning cards, selected-period delivery totals and trends, workflow, project, and priority distributions, cycle-time outliers, exact hover and keyboard values, accessible tables, and semantic issue evidence.

Sprint analytics now uses the same `loadSprintAnalytics` truth on both `/analytics?lens=sprints` and `/sprints?tab=insights`. The page shows planned, completed, remaining, carryover, additions, removals, current scope, burn-down, burn-up, ideal and previous sprint overlays, velocity, explicit coverage, and honest first-sprint states. Today combines captured membership history with live completions and scope changes, so current sprint charts move between scheduled snapshots.

The current user receives a prominent My sprint burn without configuration. An explicitly selected employee is labeled as a selected person and uses the same historical assignment facts. Velocity remains inspectable without presenting a false evidence action.

Flow formulas are displayed beside their values: lead time is creation to completion, cycle time is start to completion, and unestimated work contributes zero points in points mode.

## RED

- Overview and Sprint lens tests initially failed because the lens modules did not exist.
- Selected sprint data failed because the shared selected-sprint loader and current-principal focus were absent.
- Inspection-only bar chart coverage failed because activation was required.
- Explicit employee coverage failed because every focused burn was labeled My sprint burn.

## GREEN

- Task 14 focused suite: 20 passed, 0 failed, 73 assertions.
- Full `@orbit/web` suite on `analytics-cockpit-task14`: 2,015 passed, 0 failed, 5,033 assertions across 253 files.
- `@orbit/web` typecheck: passed.
- Targeted Biome, comment policy, source byte policy, shipped Bun import policy, dependency policy, em dash scan, and diff checks: passed.

## Scope boundary

Project and People lens visualizations remain Task 15. Saved views, exact cohort CSV export, and aggregate realtime invalidation remain Task 16. End-to-end performance checks and review screenshots remain Task 17.

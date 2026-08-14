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

## Review fixes

The fresh review identified seven truthfulness and boundedness issues. Sprint facts now apply every visible non-cycle issue filter while treating the selected sprint as context rather than a second restriction. The current and previous burn series share a working-day x-domain and the comparison is trimmed to elapsed working days. Boolean assignee selection now distinguishes a real person constraint from a non-constraining OR, so My work cannot name another developer.

Flow time displays p50 and p85 with source coverage and says Not available when there is no valid sample. Tooltips, live announcements, data tables, personal burn, and velocity name the selected issue or point unit. A completed first sprint explains that no earlier sprint exists. Burn generation and rendering are capped at 120 sampled calendar boundaries while preserving the first and current day and aggregating scope changes across sampled intervals.

- Review RED: project-filtered sprint scope returned 2 instead of 1; a ten-year sprint rendered 2,418 points; non-constraining assignee OR omitted principal focus; flow rendered 0d; selected-person copy said assigned to you; and series used independent x spacing.
- Review GREEN: sprint core tests 21 passed with 56 assertions; focused web tests 23 passed with 93 assertions; full core passed 913 tests with 2,524 assertions; core and web typechecks passed.

## Scope boundary

Project and People lens visualizations remain Task 15. Saved views, exact cohort CSV export, and aggregate realtime invalidation remain Task 16. End-to-end performance checks and review screenshots remain Task 17.

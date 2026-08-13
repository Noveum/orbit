# Task 17 report

## Outcome

The analytics planning cockpit is verified end to end against a disposable current-schema database. The zero-configuration Analytics page, URL persistence, exact mouse and keyboard chart evidence, shared sprint truth, live burndown movement, and complete saved-view restoration all have browser coverage. The Sprint page Insights tab consumes the same sprint analytics service as the Analytics sprint lens.

The screenshot harness now captures Overview, Sprint, People, advanced-filter, and exact-hover states in both light and dark themes. The People capture selects a person with visible work so the review artifact shows assignments, completion throughput, work in progress, cycle time, lead time, WIP age, and personal sprint burn rather than an empty profile.

The branch includes the latest `origin/main` through a clean merge.

## Browser evidence

- Analytics loads a useful Overview with Active sprint selected on a clean URL.
- Lens, measure, and reporting-range changes survive a browser reload.
- Analytics and Sprint Insights show the same selected sprint and burn series.
- Mouse hover and keyboard focus expose exact chart values through an accessible tooltip.
- Completing a real active-sprint issue increases completed work by one and reduces remaining work by one through `/api/analytics/sprints`.
- A Projects, Points, Last 90 days query can be saved, shared, pinned, and restored from a clean Analytics URL.
- The four browser scenarios passed in the dedicated Playwright database.

## Formula semantics

- Lead time is the current issue-row `createdAt` to durable `completedAt` interval. Missing and negative intervals are excluded. Deleted issue rows cannot contribute to this current-row metric.
- Cycle time is the current mutable `startedAt` to durable completion interval. Completed sprint history labels this as reconstructed from the current column because close outcomes do not freeze the first-start timestamp.
- People percentiles use valid completions attributed to the person at completion. WIP age is the current state-entry timestamp to the resolved data-through timestamp.
- Sprint scope and churn use durable membership intervals. Active completion is derived through the reporting day, so it moves between scheduled snapshots. Completed sprints prefer frozen close outcomes and final snapshots.
- Legacy observed sprint membership can honestly report no planned scope when captured start facts do not exist. Coverage metadata exposes that limitation rather than inventing a committed baseline.

## Verification

- Production build passed: Next.js compiled, typechecked, generated 103 pages, and produced the standalone bundle.
- Database drift check passed against the disposable current-schema database.
- Full Core passed after the latest `main` merge: 916 tests, 0 failures, 2,528 assertions across 64 files.
- Full Web passed: 2,031 tests, 0 failures, 5,096 assertions across 257 files.
- The final root verification passed lint, comment policy, source-byte policy, Bun-import policy, dependency checks, and every package typecheck.
- The root parallel test process encountered the repository-known `packages/db` catchup cleanup-hook timeout at exactly 30 seconds. The affected file passed alone immediately afterward: 10 tests, 0 failures, 18 assertions in 321 ms.
- Earlier task gates on this final feature chain include Web 2,028/2,028 before the latest `main` merge; the final totals above include the merged tests.
- Representative query plans recorded during implementation remained bounded: sprint membership 0.321 ms, overview distributions 0.377 ms, project metrics 0.330 ms, and people metrics 0.395 ms on the seeded fixtures.

## Review artifacts

Twelve committed images cover Analytics Overview, Analytics Sprint, Analytics People, exact chart hover, advanced filters, and the Sprint page in both themes. The screenshots use a 1680 by 1000 viewport, device scale factor 2, reduced motion, and deterministic seeded data.

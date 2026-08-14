# Analytics planning cockpit final review

## Outcome

The review found no unresolved correctness issue in the analytics services, query boundary, or lens contracts. The branch uses one normalized analytics query across server hydration, client refresh, drilldowns, exports, saved views, Analytics, and Sprint Insights.

Two final usability gaps were fixed during this review:

- The Sprints lens now has a first-class sprint selector. It writes the existing cycle filter into canonical URL state, preserves nested Boolean filters, and can return to automatic sprint selection.
- Line and bar charts now show scale guides. Line charts use small visual points with separate eight-pixel pointer targets, start and end labels, crosshair inspection, and tooltips anchored to the active point. Bar tooltips are anchored to the active bar. Keyboard inspection and the accessible data tables remain unchanged.
- The legacy burndown adapter now uses the selected sprint's reporting calendar for its start, end, and current-day keys. A real-database regression covers a sprint whose local dates differ from UTC, including the live first-day value and future-day masking.

## Number audit

- Overview cards reconcile to issue evidence for WIP, blocked, overdue, stale, unestimated, throughput, cycle time p50, and cycle time p85.
- Delivery totals sum every bucket in the selected reporting period. Open work uses the final bucket because it is a point-in-time balance.
- Points mode is used consistently by Overview, Sprints, Projects, and People. Unestimated work contributes zero points and remains separately disclosed as an issue count.
- Sprint planned scope uses membership captured within the start tolerance and commitment state at entry. Scope, additions, removals, reopen episodes, carryover, and live completion use durable membership and activity history.
- Completed sprint comparisons use frozen outcomes and final snapshots when coverage is complete. Mixed and reconstructed histories are labeled instead of presented as frozen.
- Project progress, milestone progress, range completion, scope entry, health, and risk cohorts reconcile to their drilldowns.
- People assignments, historical completion attribution, active-week averages, cycle time, lead time, WIP age, personal burn, and assignment timelines reconcile to person-bound cohorts.
- Lead time is issue creation to valid completion. Cycle time is valid start to completion. Missing or negative intervals are excluded and coverage is shown.

## Filter audit

- Reporting ranges include automatic, active sprint, previous sprint, last 30 days, last 90 days, all time, and an inclusive custom date range.
- Comparisons include automatic, previous period, previous sprint, and none.
- Sprints can be selected directly on the Sprints lens or through the advanced cycle filter.
- Advanced filters cover state, assignee, creator, priority, estimate, labels, project, sprint, milestone, relations, links, content, due dates, created dates, updated dates, started dates, completed dates, and state age.
- Filters preserve nested AND, OR, and negation semantics and remain visible as editable chips.
- Scope can include archived and canceled work explicitly.
- Complete analytics queries can be saved, shared, pinned, restored, and copied through the URL.

## Verification

- Final focused analytics UI: 37 tests passed with 156 assertions.
- New sprint-selector and chart tests: 12 tests passed with 43 assertions.
- Focused real-database burndown tests: 10 tests passed with 38 assertions, including the timezone-boundary regression.
- Combined real-database reconciliation suites for Overview, Sprints, Projects, People, drilldowns, and burndown: 65 tests passed with 334 assertions.
- Web typecheck and scoped Biome checks passed.
- The previous full branch gate passed Core 916 of 916 and Web 2,031 of 2,031. GitHub unit, build, Playwright, migration drift, lint, type, and CodeQL checks passed on the prior review commit.
- The final review reran the focused burndown suite against local PostgreSQL. GitHub CI will reconfirm the full branch after the timezone correction is pushed.

## Deployment prerequisite

The Vercel preview database is behind the branch schema. It is missing sprint membership and outcome tables plus the final snapshot columns. The application build correctly refuses to deploy against that schema. Migrations and the documented catchup must be applied to the target database before this pull request can be merged safely.

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
- The production catchup regression first failed because the additive script did not exist, then passed against real PostgreSQL after applying the script twice and preserving unrelated deployed objects.
- Full database package after the rollout addition: 236 tests passed with 614 assertions.
- Final fresh-schema repository verification passed: Shared 256, Database 236, Realtime client 15, Realtime server 74, Services 553, Core 917, MCP 193, Realtime 39, and Web 2,035, all with zero failures.
- Web typecheck and scoped Biome checks passed.
- The previous full branch gate passed Core 916 of 916 and Web 2,031 of 2,031. GitHub unit, build, Playwright, migration drift, lint, type, and CodeQL checks passed on the prior review commit.
- The final review reran the focused burndown suite against local PostgreSQL. GitHub CI will reconfirm the full branch after the timezone correction is pushed.

## Deployment prerequisite

The Vercel database is behind the branch schema. It is missing sprint membership and outcome tables plus the final snapshot columns. The application build correctly refuses to deploy against that schema.

A read-only production audit on 2026-08-14 found:

- 585 issues, including 254 assigned to sprints.
- 12 sprints: 4 open, 8 archived, and none completed.
- No progress snapshot rows.
- No sprint membership or outcome tables and no final snapshot columns.
- The workspace sprint conversion is already reflected in the live constraints and indexes. Its data-impact query reports zero sprint merges, issue moves, team clears, and renumbers.
- Four Git links, none connected to a mirrored pull request.
- Zero rows in the undeclared GitHub pull request mirror tables.
- Zero rows in the four undeclared legacy Standup meeting tables.
- No Drizzle migration ledger, so replaying the complete migration journal is not safe for this database.

`db:push` must not be used for this rollout. It treats undeclared production tables as deletions, which is why it proposes dropping the empty GitHub mirror and legacy Standup meeting tables. The analytics rollout does not require those deletions.

`packages/db/catchup/analytics-planning-cockpit.sql` is the production path. It is transactional, additive, idempotent, and limited to the missing analytics tables, snapshot columns, constraints, and indexes. A real PostgreSQL regression applies it twice while preserving populated stand-in GitHub, Git link, and Standup objects. A schema-only backup of the relevant production objects was captured before rollout at `/private/tmp/orbit-production-analytics-schema-20260814T0715Z.sql`, mode `0600`, SHA-256 `b526743d331047efa0e2297d44a05e11e600790bf897134d68c46ca1f3f62d52`.

The committed catchup was applied to production on 2026-08-14. The post-change deploy guard reports every declared table and column present, all eight analytics indexes exist, and the issue and sprint totals remain 585 and 12. The new history tables and existing snapshot table contain zero rows before their first capture. The GitHub mirror, Git link, and legacy Standup objects still exist with their audited row counts unchanged.

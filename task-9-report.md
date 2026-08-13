# Task 9 report: project and milestone portfolio analytics

## Portfolio semantics

`loadProjectAnalytics(principal, query, context)` uses the shared analytics query resolver and workspace analytics issue predicate. Every workspace role sees projects and issue aggregates across teams in its own organization. The service never uses ordinary team-scoped project visibility and never crosses the organization boundary.

- Project health remains the stored manual signal. Each row labels `healthSource` as `manual`. Computed risks are separate named counts and are never combined into a score.
- Scope is current filtered, non-canceled work. The payload always returns issue and point totals together. Null estimates contribute zero points while `unestimated` and `estimateCoverage` make missing estimates explicit.
- Open work excludes completed and canceled workflow categories. WIP is current started or review work. Completed work uses the current completed category.
- Blocked work is current open work with a stored `blocked_by` relation.
- Overdue work is current open work whose due date is before the reporting day in the resolved timezone.
- Stale work is current open work whose update time is more than 14 days before `asOf`.
- Scope added in range means entered project in range. Captured project-change activities count at their movement time. Creation counts against the project reconstructed from the earliest later project change. A captured null origin remains unassigned, while only a complete absence of project history falls back to the current project. `scopeAddedCoverage` labels captured, current-project, and mixed attribution.
- Completed in range uses the current final completion timestamp in the half-open reporting interval.
- The next milestone is the first incomplete or empty milestone in stable project order. A completed milestone does not hide a later empty milestone.
- Project and milestone advanced filters use the same normalized issue predicate as every aggregate and drilldown. An explicitly selected empty milestone keeps its project and empty focused milestone row visible.
- Archived projects require `includeArchived`. Canceled projects require `includeCanceled`.

## Focused project and evidence

Focused detail returns a bounded delivery series, milestone rows, and recent manual health updates. Delivery bucket starts come from the shared resolver and retain the existing 120-bucket ceiling. Each delivery point exposes cumulative scope, started, completed, and open counts plus bucket additions and completions. Milestone progress exposes issue and point percentages independently and returns null rather than a fake percentage for empty scope.

Every project risk, range metric, delivery point, and milestone row carries a semantic cohort accepted by `listAnalyticsDrilldown`. Cumulative completion and completion inside one delivery bucket use distinct strict cohorts. The drilldown combines each cohort with the same normalized query and workspace analytics predicate, so evidence totals reconcile without returning raw issue rows in the portfolio payload.

Project selection preserves the normalized Boolean filter tree. Matching issue rows use the complete shared predicate. Explicit empty project and milestone selection evaluates nested AND, OR, and negation structure instead of flattening positive identifiers. Focus only selects detail from the eligible portfolio and never bypasses an active filter.

Next milestone selection computes actual non-canceled milestone scope independently from the current issue filter. Explicit milestone logic is then applied consistently to the summary choice and focused rows, so a completed earlier milestone cannot become an apparent empty milestone when a later selected milestone is next.

Delivery bucket labels use the resolved reporting calendar rather than UTC date slicing. This keeps local dates stable in positive-offset zones and across daylight-saving transitions.

## Bounds and ordering

- Projects sort by normalized name and project id, return at most 100 rows, and expose `totalProjects` plus `truncated`.
- Project teams sort by normalized name and id and are bounded to 50 per project.
- Focused milestones sort by milestone order, creation time, and id, return at most 200 rows, and expose their total and truncation flag.
- Focused health updates sort newest first and return at most 20 rows.
- Focused delivery uses at most 120 buckets from the shared range resolver.
- No portfolio response contains an issue row or composite project score.

## Query plan

Representative statements were inspected with `EXPLAIN (ANALYZE, BUFFERS)` against the isolated Task 9 PostgreSQL lane.

The bounded portfolio list completed in 0.186 ms after 1.082 ms planning. It used four shared buffers, 25 kB for stable name ordering, and 17 kB for the total-count window. PostgreSQL chose a sequential project scan for the one-row fixture.

The consolidated project metrics statement completed in 0.330 ms after 3.332 ms planning. It used six shared buffers, a workflow-state hash join, one grouped issue pass, and an index-only scan through `issue_relation_unique` for blocked evidence. The tiny fixture selected an issue sequential scan. Existing organization, project, milestone, and relation indexes cover the production predicates, so Task 9 adds no speculative index.

## RED

- RED: the focused real-PostgreSQL suite failed because `analytics/projects.ts` and `loadProjectAnalytics` did not exist.

## GREEN

- GREEN: the focused Task 9 suite passed 10 tests with 67 assertions after final review fixes.
- GREEN: focused overview, drilldown, and project regressions passed 18 tests with 158 assertions before the final reconciliation expansion.
- GREEN: the full core real-PostgreSQL suite passed 898 tests with 2,463 assertions after final review fixes.
- The first monorepo verification passed every static and type gate, then found five existing web sprint tests running against a stale local base database that lacked `cycle_progress_snapshot.captured_at`.
- `bun run db:test-setup` refreshed all six base test schemas before the final isolated verification run.
- The fresh-lane monorepo verification again passed every static and type gate and 1,961 web tests, then reported the same five existing sprint index, start, complete, and snapshot failures. A standalone run reproduced only those five failures with 24 related tests passing. Read-only inspection confirmed that both the web template and disposable lane lacked `cycle_issue_membership` and `cycle_progress_snapshot.captured_at`. The schema setup command exited successfully without materializing those objects, while direct Drizzle push reached an existing rename conflict that requires an interactive terminal. The Task 9 focused suite and full core suite remained green. No Task 9 file is on those failing web paths.

## DONE

Task 9 tests cover manual health labeling, status and target dates, issue and point progress, mixed estimates, open and completed work, blocked, overdue, stale, and unestimated counts, range additions and completions, multi-team projects, next milestone selection, empty milestones, project and milestone filters, archived toggles, workspace-wide guest, contributor, member, and admin visibility, organization isolation, stable portfolio ordering and bounds, and semantic risk, milestone, and delivery reconciliation through drilldown.

Review regression tests additionally cover AND mismatch, nested OR and negation, stale focus, actual Alpha completion with Beta selected as next, project-at-creation reconstruction for moves before and after the reporting range, explicit entry coverage, Asia/Kolkata and America/New_York bucket labels, strict completed-in-bucket parsing, and completed-in-bucket drilldown reconciliation.

The final history regression distinguishes a captured null project origin from a missing activity row. It proves that a later move into Beta does not rewrite the creation project, its cohort excludes that issue, and a truly history-free issue still uses current-project attribution with the matching coverage label.

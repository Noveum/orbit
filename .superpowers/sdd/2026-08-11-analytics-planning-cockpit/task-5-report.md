# Task 5 report

## Outcome

Added one `buildIssueWhere` boundary for ordinary team-visible issue queries and workspace-wide analytics queries. Ordinary lists, counts, board groups, summaries, and facets now compose through the boundary. Workspace analytics requires `analytics:read`, omits only team membership visibility, and always retains the organization predicate.

The boundary preserves direct issue filters, advanced nested filters, supplied-clock relative dates, label and milestone predicates, blocked relations, unset values, archive and sub-issue choices, and text search. Facets continue to ignore the advanced filter tree while applying the same scope filters, preserving their existing unfiltered-facet behavior.

## RED

The new real PostgreSQL suite was written before production code. The focused run failed with:

`Cannot find module '../../src/work/issue-query.ts'`

The first infrastructure attempt could not reach PostgreSQL because the container was stopped. The repository `.env` was also not parseable by Docker Compose, so PostgreSQL was started with `.env.example`. The rerun then produced the expected missing-boundary failure.

Review fix round 1 reproduced the mixed-clock test defect by moving the injected boundary clock and relative due-date fixture to 2036 without changing the ordinary list clock. The focused run failed with `titlesMatching` returning `Matching issue` while `listedTitles` returned no issues. This proved that the parity assertion depended on the host date rather than one shared clock.

## GREEN

- Focused issue query suite: 4 passed, 42 assertions.
- Full core suite: 793 passed, 2,054 assertions.
- Root lint: passed with one existing unrelated warning and one Biome schema-version notice.
- Comment policy: passed.
- Source byte policy: passed.
- Bun runtime import policy: passed.
- Dependency dedupe policy: passed.
- Root typecheck: passed for every package.
- Full `bun run verify`: passed, including 1,884 web tests.
- `git diff --check`: passed.

Review fix round 1 separated the two clock contracts without changing a production API:

- Stable non-relative filters retain direct parity checks against `listIssues`.
- A dedicated future-dated test verifies that the shared boundary evaluates relative dates from its supplied clock.
- Focused issue query suite: 5 passed, 41 assertions.
- Full core suite: 794 passed, 2,053 assertions.
- Root lint, comment policy, source byte policy, Bun runtime import policy, dependency dedupe policy, and root typecheck: passed.

## Self-review

- Organization isolation is unconditional and precedes both visibility modes.
- Team visibility retains the previous admin and team membership behavior.
- Workspace analytics removes only the team membership predicate and asserts `analytics:read`.
- Every authenticated workspace role is covered for team versus analytics visibility.
- Cross-organization rows remain hidden in team and analytics modes.
- Direct scope fields and text search are compared against `listIssues` results.
- Labels, milestones, blocked relations, unset values, and nested groups are compared against `listIssues` results with time-stable filters.
- Supplied-clock relative dates are covered independently with a clock ten years beyond the host test date.
- Archived work and sub-issue inclusion are covered independently.
- Facets deliberately omit the advanced tree through an explicit boundary option, matching the prior contract.
- The predicate module depends on no service module, so the extraction introduces no circular dependency.
- No comments, em dash characters, `any`, non-null assertions, or Bun runtime imports were added.

## Commit

Subject: `refactor(analytics): share issue predicates`

The commit SHA is reported in the Task 5 handoff because a commit cannot contain its own SHA.

## Concerns

The checked-out `.env` contains content Docker Compose cannot parse. Tests were run against the standard local PostgreSQL service started with `.env.example`. This did not affect the application test configuration or verification results.

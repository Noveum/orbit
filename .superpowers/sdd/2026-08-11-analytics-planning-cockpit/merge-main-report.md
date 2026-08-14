# Main Integration Report

## Scope

Merged the workspace sprint redesign from `origin/main` at `dc7dbfc4` into the analytics planning cockpit work. The resolution preserves workspace sprint product behavior while adapting analytics storage, attribution, snapshots, and close processing to nullable `cycle.teamId`.

## Conflict resolutions

- `packages/shared/src/validators/cycle.ts` keeps blank and custom sprint names, optional dates, and `shiftFollowing`, while adding optional validated IANA timezones on create and update.
- `packages/core/src/work/cycle-service.ts` keeps workspace-scoped sprint reads, writes, authorization, sequencing, custom naming, schedule shifting, close release behavior, and successor selection. Analytics integration adds organization-wide cycle assignment locking, stable issue and issue-team locks, final snapshots before rollover, outcome capture before mutation, membership self-healing on close, and membership closure before deletion.
- `packages/core/src/work/issue-service.ts` keeps cross-team assignment to a workspace sprint, team moves that preserve the sprint, default assignees, and extracted issue queries. Analytics integration captures membership in the same mutation transactions, rejects completed or archived sprint destinations, and serializes assignment with workspace plus stable team locks.
- `packages/core/tests/work/cycle-service.test.ts` keeps the workspace sprint behavior suite and adds database coverage for timezone persistence and rejection plus trigger-backed verification that membership closes before sprint deletion.

## Semantic compatibility work

- Membership and outcome rows derive `teamId` from each issue, never from the nullable sprint team.
- Membership bootstrap covers every issue in the organization assigned to the workspace sprint, uses stable issue ordering, and preserves the partial unique invariant of one open membership per issue.
- Sprint close captures a final local-day snapshot and frozen outcomes before release or rollover. Missing membership rows are repaired before outcomes are written.
- Triage and backlog issues are classified as incomplete and released on close. Open committed issues are carryover and open membership in the successor sprint.
- Snapshots aggregate all teams in the sprint organization and require workflow state organization and team to match the issue. Corrupt cross-organization issue assignments are excluded.
- Burndown, flow, velocity, cycle progress, and reconstructed outcomes include workspace sprint issues across teams while enforcing organization and issue-team isolation.
- Analytics sprint selection accepts nullable team attribution. Workspace sprint history compares to workspace sprint history, while an explicit team filter does not misclassify a workspace sprint as team-owned.
- Direct issue query extraction retains organization and team visibility policy and correctly treats the unset assignee filter as unassigned work.

## Added and adjusted coverage

- A real database test assigns issues from two teams to one workspace sprint, closes it, and verifies membership attribution, outcome attribution, rollover IDs, and successor open membership for both teams.
- Snapshot coverage verifies sibling-team inclusion, per-issue team attribution, and exclusion of a deliberately corrupt cross-workspace assignment.
- Close tests cover final snapshot timing, rollback, self-healing membership, release of uncommitted work, rollover of committed open work, and duplicate close serialization.
- Cycle service tests cover valid timezone storage and update, invalid timezone rejection, blank and custom names, workspace authorization, schedule shifting, cross-team issue assignment, release, rollover, and deletion ordering.

## Verification

- Full core suite after review fixes: 871 passed, 0 failed.
- Focused core integration suite: 206 passed, 0 failed.
- Shared validator suite: 18 passed, 0 failed.
- Web cycle API: 12 passed, 0 failed.
- Web analytics snapshot cron: 8 passed, 0 failed.
- Sprint web tests: 92 passed in the combined rerun, then the only stale-schema failure passed 9 of 9 after the disposable web test database received the current schema. Earlier pure sprint UI grouping passed 40 of 40.
- Monorepo typecheck passed for every package after the final refactor.
- Lint, comment policy, source byte check, Bun import check, dependency dedupe check, `git diff --check`, and conflict marker scan passed.

## Concerns

- The disposable `orbit_test_web` database predated the analytics membership tables and final snapshot columns. Applying the current schema resolved the single environment failure. No product code change was needed.
- Lint reports an informational Biome schema version mismatch and an existing warning in `packages/db/tests/check-source-bytes.test.ts`; lint exits successfully.

No unresolved merge markers or semantic blockers remain.

## Review fix round 1

- The workspace sprint catchup now records direct issue moves, conditionally reconciles analytics membership when that table exists, closes stale open source rows, and opens one destination row with issue-team attribution. A real scratch-database test verifies the upgrade path.
- Membership bootstrap now repairs stale open rows before opening the issue current sprint. Database coverage closes and rolls the repaired sprint, verifies the frozen outcome, and proves no duplicate open interval remains.
- Realtime cycle query deltas now use the cycle identifier at query key index 2. Browser tests cover cross-team insert, unrelated update retention, and removal when an issue leaves the sprint.
- Completion snapshots and outcomes exclude released triage and backlog work from scope, completion, and point aggregates while preserving per-issue close outcomes.
- Sprint completion allocates its canonical sync identifier after internal snapshot writes. The closed sprint and changed issues persist and emit that highest identifier, and snapshot actions do not outrank or duplicate the canonical close. A real catchup test verifies replay from a pre-close cursor.
- Completion toasts use the custom successor name or the numbered sprint fallback when the stored name is blank.

### TDD evidence

- Stale membership bootstrap first failed on the one-open-membership invariant, then passed after stale-row repair.
- Catchup SQL first left only the stale source membership, then passed with closed source and open destination rows.
- Workspace sprint delta insertion and retention first missed the cycle cache, then all bridge cases passed after cycle-key handling.
- Released-work aggregation first counted four issues, then passed with two committed issues and eight committed points.
- Completion sync ordering first placed snapshot sync 5 above cycle sync 4, then passed with the canonical completion sync highest and reconnect replay ordered.
- Blank successor toast first rendered an empty name, then passed with `Sprint 2`.

### Final review verification

- Full core: 871 passed, 0 failed across 61 files.
- Focused core integration: 114 passed, 0 failed.
- Catchup SQL: 10 passed, 0 failed.
- Realtime bridge and completion toast: 23 passed, 0 failed.
- Expanded sprint browser group: 42 passed, 0 failed.
- Cycle API: 12 passed, 0 failed.
- Monorepo typecheck passed for every package.
- Lint, comment policy, source byte check, Bun import check, dependency dedupe check, diff check, and conflict marker scan passed. Lint retains only the existing warning and Biome schema information noted above.

## Review fix round 2

- Drizzle generated `0007_faulty_skaar.sql`, `0007_snapshot.json`, and journal entry 7 after the analytics migrations at entries 5 and 6.
- Generation found exactly the workspace sprint schema delta: nullable `cycle.team_id`, `ON DELETE SET NULL` for its team foreign key, removal of the team number and date indexes, and addition of organization number and date indexes. A second generation reported no schema changes.
- The generated migration was hardened for existing per-team data by deterministically renumbering every organization before creating the organization-wide unique index. Conditional index and constraint DDL lets it follow the manual catchup safely.
- The catchup drops organization cycle indexes before merging and renumbering, then recreates them. This makes migration then catchup and catchup then migration safe. Production upgrades should run the catchup before deploying workspace sprint code so overlapping open team sprints are consolidated before the new behavior is exposed. Fresh installs need only the migration journal.
- A fresh migration-only database now reports `cycle.team_id` nullable, the team foreign key delete rule as `SET NULL`, the organization unique and date indexes, no former team indexes, and accepts a cycle row with no team.
- `createCycle` coverage now asserts that a created workspace sprint has a null `teamId`.

### Round 2 TDD evidence

- The fresh migration test first reported `team_id` as `NO` for nullability and rejected a teamless cycle with SQLSTATE 23502. It passed after generation of migration 0007.
- The upgrade-order test first failed to create `cycle_org_number_unique` because two legacy teams both owned Sprint 1. It passed after deterministic organization renumbering and now executes migration, catchup, then the migration SQL again.

### Round 2 verification

- Fresh migration assertions: 2 passed, 0 failed.
- Full database package: 233 passed, 0 failed across 16 files.
- Focused core cycle service: 61 passed, 0 failed.
- Fresh disposable migration command completed through journal entry 7.
- Drift check against the freshly migrated disposable database reported every declared table and column present.
- Monorepo typecheck, lint, comment policy, source byte check, Bun import check, and dependency dedupe check passed. Lint retains only the existing warning and Biome schema information noted above.

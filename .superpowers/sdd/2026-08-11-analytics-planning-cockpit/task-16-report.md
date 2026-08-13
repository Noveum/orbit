# Task 16 report

## Outcome

Analytics views now persist the complete planning query rather than only the selected measure. A saved view restores its lens, range, comparison, measure, nested filters, archived and canceled toggles, and project or person focus. Owners can rename, share, update, pin, and delete a view. Each owner has at most one pinned default, and a clean Analytics URL opens that default automatically.

Chart evidence now exports the exact semantic cohort shown in the drilldown. The CSV contains the resolved predicate, measure formula, reporting timezone, range, data-through timestamp, coverage statement, total count, and bounded issue rows. Spreadsheet formulas in user content are neutralized. Large exports stop at 10,000 rows and declare truncation in response headers.

Analytics aggregate queries now refresh after issue, sprint, project, milestone, workflow, label, member, team, and saved-view changes. Bursts coalesce into one invalidation. A mutation from the current tab invalidates analytics before its ordinary row echo is suppressed.

## RED

- A complete saved People query could not be restored because legacy saved dashboards retained only measure-level configuration.
- The prior export route produced legacy breakdown data rather than the selected chart or card cohort.
- Issue and sprint deltas did not invalidate analytics aggregates, so a burndown could remain unchanged after work moved or completed.
- Multiple pinned dashboards could remain active for one owner.

## GREEN

- Focused saved-view integration: 8 passed, 0 failed, 17 assertions.
- Analytics cockpit: 13 passed, 0 failed, 56 assertions.
- Export route: 2 passed, 0 failed, 11 assertions before the final coverage metadata assertion.
- Chart evidence and realtime focused set: 27 passed, 0 failed, 49 assertions.
- Full Core: 916 passed, 0 failed, 2,528 assertions across 64 files.
- Full Web: 2,028 passed, 0 failed, 5,092 assertions across 256 files.
- Core and Web typechecks passed.
- Targeted Biome checks and diff checks passed.

## Notes

Checkpoints remain separate from dashboard views and retain their frozen sprint semantics. Dashboard defaults are personal even when the view itself is shared. Shared viewers can apply a view, while mutation remains limited to the owner or a workspace administrator by the existing service boundary.

# Task 13 report

## Outcome

Analytics now has lightweight accessible chart and evidence primitives. A line chart holds one keyboard focus surface, exposes the same exact point through pointer and keyboard input, moves across dates and series with Arrow keys, supports Home, End, Enter, and Escape, announces the active value, and links every point to a visible data table row.

The evidence dialog consumes the signed semantic drilldown route, validates every response, caps each page at 50 rows, loads additional pages through the server cursor, links directly to issue detail, shows the server predicate and freshness timestamp, sorts visible evidence by update time, adapts to a full-screen mobile surface, and restores focus to the activating control.

The reviewed chart contract now includes bar chart table parity, bounded geometry for dense series, pointer targets for zero values, pointer-leave cleanup, and stable keyboard position across a dialog round trip. The legacy CSV export link remains hidden until Task 16 can guarantee cohort, range, filter, and focus parity.

The chart palette uses semantic theme tokens in light and dark modes. Dense SVG points are not individual tab stops.

## RED

Focused chart and dialog tests failed because `line-plot.tsx` and `analytics-drilldown-dialog.tsx` did not exist.

The tests require pointer and keyboard parity, exact tooltip values, two-dimensional Arrow navigation, Home and End, Escape, Enter activation, linked table activation and highlighting, signed cursor pagination, semantic export parameters, and focus restoration.

## GREEN

- Focused chart and dialog tests: 3 passed, 0 failed, 18 assertions.
- Combined Task 12 and Task 13 focused checks: 18 passed, 0 failed, 66 assertions.
- Full `@orbit/web` suite on `analytics-cockpit-task13`: 2,005 passed, 0 failed, 4,995 assertions across 249 files.
- `@orbit/web` typecheck: passed.
- Targeted Biome, comment policy through the pre-commit boundary, and diff checks: passed.

The review-fix RED suite had four expected failures: optional inspection called an absent activation callback, keyboard position reset after focus moved, bar geometry overflowed with 80 values and gave zero no hit target, and the evidence dialog omitted predicate, freshness, sorting, and truthful export behavior. The final focused review suite passed 7 tests with 36 assertions, and `@orbit/web` typecheck passed.

## Scope boundary

The primitives produce semantic cohorts and the dialog consumes them. Task 14 replaces the temporary Overview and Sprint content with these primitives. Task 16 upgrades the existing export route from legacy breakdown exports to exact semantic cohort CSV content.

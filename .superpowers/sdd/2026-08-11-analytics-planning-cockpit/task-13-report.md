# Task 13 report

## Outcome

Analytics now has lightweight accessible chart and evidence primitives. A line chart holds one keyboard focus surface, exposes the same exact point through pointer and keyboard input, moves across dates and series with Arrow keys, supports Home, End, Enter, and Escape, announces the active value, and links every point to a visible data table row.

The evidence dialog consumes the signed semantic drilldown route, validates every response, caps each page at 50 rows, loads additional pages through the server cursor, links directly to issue detail, exposes the matching semantic export URL, adapts to a full-screen mobile surface, and restores focus to the activating control.

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

## Scope boundary

The primitives produce semantic cohorts and the dialog consumes them. Task 14 replaces the temporary Overview and Sprint content with these primitives. Task 16 upgrades the existing export route from legacy breakdown exports to exact semantic cohort CSV content.

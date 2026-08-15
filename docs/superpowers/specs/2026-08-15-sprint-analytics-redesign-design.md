# Sprint analytics redesign: Linear-grade burn charts and an insights grammar

Date: 2026-08-15
Branch: `analytics-insights-redesign`
Delivery: both phases in one pull request, built phase 1 first, with small scoped commits.

## Executive decision

The analytics charts shipped in PR 313 are honest but useless for planning. A sprint adopted mid-flight renders a nearly empty frame, the fixed 640x260 viewBox stretches every label to roughly 2.6x its intended size, the x axis shows three irregular dates, Planned reads 0 for a sprint holding 194 issues, and no number on the page answers the questions a lead actually asks: what is our velocity, what should the burn be, where will we land.

This redesign rebuilds the sprint experience to the standard of Linear's cycle graph and then, as a second phase, adds a Measure by Slice by Segment insights grammar modeled on Linear Insights. Orbit keeps its own tokens, density, typography, and component language: this adapts Linear's interaction model, not its skin.

Decisions locked with the user:

1. Scope: both phases designed in this one spec, built and shipped separately, sprint graph first.
2. Mid-flight adoption: retroactive baseline. The first captured scope is treated as the sprint's baseline from day 1.
3. Measures: one chart with a points and issues toggle; the header stat strip always shows both measures.
4. Charts stay hand-rolled SVG. No chart library: it would fight the single-instance dependency rule, the transform-and-opacity-only motion rule, CSS variable theming, and the existing keyboard access model.

References:

- [Linear cycle graph](https://linear.app/docs/cycle-graph)
- [Linear project graph](https://linear.app/docs/project-graph)
- [Linear Insights](https://linear.app/docs/insights)
- [Linear dashboards](https://linear.app/docs/dashboards)

## Problems being fixed, verified against the code

1. Scale bug: `LinePlot` and `BarPlot` render a fixed `viewBox="0 0 640 260"` SVG with `w-full`, so an 1650px card scales 11px text to about 29px. This one bug produces most of the "gigantic and empty" impression.
2. Axis poverty: three x ticks chosen by array index produce sequences like Aug 11, Aug 13, Aug 24. No tick per day, no weekend distinction, no dots on the ideal line.
3. Adoption emptiness: capture began Aug 14 for a sprint started Aug 11, so `available: false` blanks three of four days, the personal chart draws one dot, and the frame carries no ideal context for the sprint's future.
4. Planned 0: planned counts membership captured within 24 hours of sprint start. A bootstrap capture three days in yields planned 0 against a real scope of 194. Technically defined, practically wrong.
5. No planning answers: no needed versus actual burn rate, no forecast date stat, no started series on the chart, no people count, one measure at a time, a long flat data table.

The arithmetic that does render is correct: scope 194 minus remaining 178 equals completed 16, matching the summary cards. The failures are framing and coverage, not sums.

## Phase 1: the sprint graph

### 1. Rendering model

- Charts measure their container with a `ResizeObserver` and render the SVG at native pixel size. An 11px label is 11px at every viewport. No stretched viewBox anywhere in analytics.
- Chart height approximately 280px; width fills the card.
- X axis spans the full sprint in calendar days, sprint start through the last included day (the half-open interval convention from PR 313 stands: the `endsAt` day belongs to the next sprint).
- Every calendar day owns an x slot. Weekend columns get a faint background tint using an existing surface token. Tick labels render every 1 to 3 days depending on measured width, always including the first and last day and today.
- Y axis: 4 or 5 gridlines with values, formatted by the active measure.
- Fonts 10 to 11px, weights and colors from existing tokens. Reduced motion is already respected; nothing here animates layout.
- `BarPlot` receives the same native-scale treatment.

### 2. Burn chart series

Burn down mode:

- Remaining: solid line, actual data points only on days with capture.
- Scope: gray step line across captured days, so scope creep reads as steps.
- Ideal: dotted line from day 1 at the baseline scope to zero on the last working day, flat across weekends, with a small dot on each working day so "where should we be on the 19th" is readable directly.
- Forecast: dotted extension from today's remaining to projected zero, drawn only when at least three captured working days exist and the fitted slope is negative (the PR 313 guard stands). The projected date also appears as a header stat.

Burn up mode:

- Completed: solid rising line.
- Started: stacked on top of completed, Linear's yellow-on-blue arrangement using the analytics series tokens.
- Scope: gray line above.
- Target: dotted rising line, the inverse of the ideal.

Hover and keyboard focus snap to the nearest day column and show one tooltip listing every series value for that day, not one point at a time. Arrow keys move by day, Home and End jump, Enter drills down, matching the existing access model.

### 3. Header stat strip

One dense strip replaces the four large summary cards:

- Scope: `194 issues · 502 pts`
- Completed: `16 (8%)`
- Started: `42 (22%)`
- Remaining: `178`
- Churn: `+1 added · 0 removed`
- Pace: `needed 17.8/day · actual 5.3/day`
- Forecast: `Aug 28, 3 days late` (accent color when on or before sprint end, warning color when after)
- People: `9`

Definitions:

- Needed pace: remaining divided by working days left including today.
- Actual pace: completed since baseline divided by elapsed working days since baseline.
- People: distinct persons in the sprint detail's people series.
- Both measures always appear in the Scope stat. The chart's measure toggle does not change the strip.
- In points mode, an unestimated issue counts as 1 point, and the caption states the count: `18 unestimated counted as 1 pt each`. A configurable team default estimate is out of scope for this spec.

### 4. Retroactive baseline semantics

- The first captured burn point defines the baseline: its date and scope.
- Planned adopts the baseline scope when no membership was captured inside the planning window. The formulas metadata says so explicitly.
- The ideal line starts at day 1 with the baseline scope, not at the baseline date.
- Days before capture draw no actual-series points. The `available` flag stays in the contract and the server keeps computing it; the client stops letting it blank the frame.
- One caption line replaces the current gap warnings: `Capture began Aug 14. Earlier days show targets only.`
- Added and removed keep excluding the bootstrap capture (PR 313 behavior stands): a baseline is not churn.

### 5. Data table

- Pivoted: one row per day, one column per series, right-aligned numbers, compact row height.
- A 14-day sprint renders 14 rows instead of a 40-plus row series list.
- Row hover highlights the matching day column in the chart; the existing activation behavior (Enter or click drills into the day's cohort) is preserved.

### 6. Personal burn

- Same frame as the team chart: full sprint x axis, weekend tint, native scale.
- The person's ideal runs from day 1 at the person's baseline scope share to zero at sprint end.
- Same retroactive baseline caption. No more single-dot charts with `3 dates unavailable`.

### 7. Velocity

- Paired bars per completed sprint: planned versus completed, in the active measure.
- A horizontal average line across the shown sprints, labeled with the value.
- The current sprint appears as a lighter in-progress pair so the strip is never empty for a first sprint.

### Server changes for phase 1

- `SprintBurnPoint` gains one field: `readonly future: boolean`. The series already carries date, scope, started, completed, remaining, ideal, available, workingDay.
- The burn series extends through the last included sprint day. Future points carry only the ideal value with `future: true` and zeroed actual fields; the client draws no actual series for them, so it never invents geometry.
- `SprintDetail` gains a `baseline` object: date, scope in both measures, and whether it was adopted retroactively.
- `summaryFor` adopts the baseline scope for planned when the planning window captured nothing, and the formulas text changes accordingly.
- Points-mode valuation counts unestimated issues as 1 with the unestimated count already present in the summary.

### Testing phase 1

- Chart primitives: bun DOM tests for native sizing (mocked ResizeObserver), day-slot ticks including weekend flags, per-day tooltip aggregation, keyboard day navigation, table pivot and linked highlight.
- Core: baseline adoption of planned, ideal-from-day-1 values, future ideal-only points, pace stats inputs, all against the real test database.
- The PR 313 regression suite (weekend ideal zero, half-open boundary, bootstrap churn exclusion) must stay green unchanged.
- Playwright: the analytics sprint page renders the full-span chart with a mid-flight fixture, both toggle states, and the stat strip.
- Light and dark screenshots at 1680x1000 in the PR.

## Phase 2: the insights grammar

Built after phase 1 ships. Everything below reuses the phase 1 primitives.

### Grammar

- The analytics page gains an Insights lens over the filtered dataset: Measure by Slice by optional Segment. The existing filter bar and saved views make the current view the dataset, so this covers filtered issue exploration without mounting a panel into every issue list.
- Measures: issue count, points, cycle time, lead time, issue age.
- Slices: assignee, state, state category, project, label, priority, sprint, week created, week completed.
- Segment: a second dimension rendered as stacked color within each slice, bar charts only.
- The existing drilldown cohort machinery (extended for state categories in PR 313) is the click-through: every bar, point, and table row resolves to a cohort listing the exact issues.

### Chart forms

- Bar chart: counts and points, horizontal ranked layout as today, segments stacked.
- Scatterplot: duration measures (cycle time, lead time, age), one point per issue, with horizontal percentile lines at 25, 50, 75, 95. Hovering a percentile shows its value; selecting a point opens the issue.
- Burn up: selecting the time slice with a cumulative setting produces the cumulative flow variant using the phase 1 line chart.

### Interactivity

- Chart and table are linked: hovering a bar highlights its row and the reverse.
- Clicking a bar or segment filters the underlying view temporarily, matching Linear's temporary-filter behavior.
- Keyboard access mirrors phase 1: arrows move across slices, Enter drills down.

### Explicit non-goals

- Dashboards as a separate composable surface. Linear gates these to Enterprise; Orbit's saved views already cover persistence. Revisit only after phase 2 is in use.
- Linear's cycle success score (completed plus a quarter of started). No user asked for it.
- Optimistic and pessimistic forecast bands. A single forecast line is enough at sprint scale; bands earn their keep on multi-month projects.
- Triage time as a measure, until Orbit captures triage state durations.
- A configurable team default estimate setting.

### Testing phase 2

- Core: each measure and slice pair against seeded data, percentile math, segment stacking sums, cohort round-trips from every chart form.
- Web: scatterplot rendering and percentile interaction, linked table highlighting, temporary filter application and removal.

## Rollout

1. One pull request carries both phases, phase 1 commits first, phase 2 commits after, each small and scoped.
2. Verify on the live workspace against the running Sprint 1: the mid-flight baseline path is the very case that prompted this redesign.

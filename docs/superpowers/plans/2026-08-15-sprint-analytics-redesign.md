# Sprint Analytics Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the sprint burn experience to Linear cycle-graph quality (native-scale charts, full-span ideal, forecast, pace stats, retroactive baseline) and add a Measure by Slice by Segment insights lens, both in one pull request.

**Architecture:** Phase 1 changes `burnFor` in core to emit a full-span series with a retroactive baseline, future ideal-only points, and a counterpart-measure summary, then rebuilds the two SVG chart primitives to render at measured native pixel size with a calendar-day domain. Phase 2 adds an `insights` lens: one core aggregation function compiled from the existing workspace analytics predicate, new drilldown cohorts for the new slice dimensions, a scatterplot primitive with percentile lines, and stacked segments in the bar primitive.

**Tech Stack:** Bun 1.3+, TypeScript 5.9, Next.js 16 App Router, React 19, PostgreSQL, Drizzle ORM, Zod 4, TanStack Query 5, Bun test, Testing Library, Playwright.

## Global Constraints

- Use Bun only. No npm, pnpm, yarn, turbo.
- Shipped web and core code runs on Node and must not import Bun built-ins.
- No code comments except functional directives accepted by `bun run check-comments`.
- No em-dash characters in code, docs, commits, branch names, or pull request text.
- No AI attribution anywhere.
- Strict types: no `any`, no non-null assertions, Zod parsing for every external input.
- Tests live in each package's `tests/` tree, import from `bun:test`, and mirror `src/` layout.
- Database-backed test commands use `ORBIT_TEST_LANE=analytics-redesign`.
- Charts stay hand-rolled SVG: no chart library. Colors only through CSS custom properties (`var(--analytics-series-N)`, surface and border tokens). Motion transform and opacity only.
- The PR 313 regression suite must stay green in meaning: weekend ideal reaches zero, half-open sprint boundary, bootstrap capture excluded from churn. Expectation values may change where this spec redefines the ideal line; the properties may not.
- The approved design is `docs/superpowers/specs/2026-08-15-sprint-analytics-redesign-design.md`.
- Branch: `analytics-insights-redesign`. Small scoped commits, imperative subjects.

---

## File structure map

### Phase 1: server

- Modify `packages/core/src/analytics/sprints.ts`: `SprintBurnPoint.future`, retroactive ideal from day 1, future points through sprint end, baseline object, planned adoption, counterpart summary, points valuation.
- Modify `packages/core/tests/analytics/sprints.test.ts`: updated expectations plus new baseline and future-point tests.
- Modify `packages/core/tests/analytics/burndown.test.ts` only if ideal expectations shift.

### Phase 1: web

- Create `apps/web/src/lib/use-measured-width.ts`: ResizeObserver width hook.
- Create `apps/web/src/features/analytics/burn-math.ts`: pace, forecast date, day-domain helpers (pure, unit-tested).
- Rewrite `apps/web/src/features/analytics/charts/line-plot.tsx`: native scale, day domain, weekend tint, day-snap tooltip, pivoted table rows.
- Modify `apps/web/src/features/analytics/charts/plot-guides.tsx`, `plot-frame.tsx`, `chart-tooltip.tsx` as the new geometry requires.
- Modify `apps/web/src/features/analytics/charts/bar-plot.tsx`: native scale, grouped pairs, average marker.
- Create `apps/web/src/features/analytics/sprint-stats.tsx`: the stat strip.
- Modify `apps/web/src/features/analytics/sprint-lens.tsx`, `people-lens.tsx`, `contracts.ts`.
- Tests under `apps/web/tests/features/analytics/` and `apps/web/tests/lib/`.

### Phase 2

- Modify `packages/shared/src/validators/analytics.ts`: insight constants and schemas, `insights` lens.
- Modify `packages/core/src/analytics/drilldown.ts`: cohorts for assignee, label, sprint, created-week, completed-week.
- Create `packages/core/src/analytics/insights.ts` and `packages/core/tests/analytics/insights.test.ts`.
- Create `apps/web/src/app/api/analytics/insights/route.ts` and its test.
- Create `apps/web/src/features/analytics/charts/scatter-plot.tsx` and test.
- Create `apps/web/src/features/analytics/insights-lens.tsx` and test.
- Modify `analytics-tabs.tsx`, `data.ts`, `contracts.ts`, `analytics-keys.ts`, `query-state.ts`, `page.tsx`.
- Modify `apps/web/e2e/analytics.spec.ts`.

---

### Task 1: Retroactive baseline and full-span burn series in core

**Files:**
- Modify: `packages/core/src/analytics/sprints.ts`
- Test: `packages/core/tests/analytics/sprints.test.ts`

**Interfaces:**
- Consumes: existing `burnFor`, `summaryFor`, `detailFor`, `idealRemaining`, `workingDaysBetween`, `dateText`, `addDate`, `isWorkingDay`.
- Produces: `SprintBurnPoint` gains `readonly future: boolean`; `SprintDetail` gains `readonly baseline: SprintBaseline | null` and `readonly counterpart: SprintMeasureSummary` where `SprintBaseline = { readonly date: string; readonly scope: number; readonly retroactive: boolean }`. Points valuation counts unestimated as 1. The sprint `formulas().points` text becomes `Unestimated work counts as 1 point until estimated.`

- [ ] **Step 1: Write the failing tests**

Add to `packages/core/tests/analytics/sprints.test.ts`:

```ts
it('extends the burn with ideal-only future points through sprint end', async () => {
  const cycleId = await cycle(1, '2026-08-11T00:00:00.000Z', '2026-08-25T00:00:00.000Z');
  const issueId = await insertIssue(workspace, {
    number: 1,
    state: 'Todo',
    cycleId,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
  });
  await membership(cycleId, issueId, {
    addedAt: '2026-08-14T07:00:00.000Z',
    coverage: 'observed',
    entryKind: 'bootstrap',
  });

  const result = await loadSprintAnalytics(workspace.admin, sprintQuery(cycleId), {
    now: new Date('2026-08-14T12:00:00.000Z'),
  });
  const burn = currentOf(result).burn;
  const past = burn.filter((point) => !point.future);
  const future = burn.filter((point) => point.future);

  expect(burn.at(-1)?.date).toBe('2026-08-24');
  expect(past.map((point) => point.date).at(-1)).toBe('2026-08-14');
  expect(future.every((point) => point.scope === 0 && point.remaining === 0)).toBe(true);
  expect(future.at(-1)?.ideal).toBe(0);
});

it('draws the ideal from day 1 at the retroactive baseline scope', async () => {
  const cycleId = await cycle(1, '2026-08-11T00:00:00.000Z', '2026-08-25T00:00:00.000Z');
  const issueId = await insertIssue(workspace, {
    number: 1,
    state: 'Todo',
    cycleId,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
  });
  await membership(cycleId, issueId, {
    addedAt: '2026-08-14T07:00:00.000Z',
    coverage: 'observed',
    entryKind: 'bootstrap',
  });

  const result = await loadSprintAnalytics(workspace.admin, sprintQuery(cycleId), {
    now: new Date('2026-08-14T12:00:00.000Z'),
  });
  const burn = currentOf(result).burn;

  expect(burn[0]?.ideal).toBe(1);
  expect(burn[3]?.ideal).toBeCloseTo(6 / 9, 5);
  expect(currentOf(result).baseline).toEqual({
    date: '2026-08-14',
    scope: 1,
    retroactive: true,
  });
  expect(currentOf(result).summary.planned).toBe(1);
});

it('reports the counterpart measure summary alongside the requested one', async () => {
  const cycleId = await cycle(1, '2026-08-11T00:00:00.000Z', '2026-08-25T00:00:00.000Z');
  const estimated = await insertIssue(workspace, {
    number: 1,
    state: 'Todo',
    cycleId,
    estimate: 5,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
  });
  const unestimated = await insertIssue(workspace, {
    number: 2,
    state: 'Todo',
    cycleId,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
  });
  await membership(cycleId, estimated, { addedAt: '2026-08-11T00:00:00.000Z', estimate: 5 });
  await membership(cycleId, unestimated, { addedAt: '2026-08-11T00:00:00.000Z' });

  const result = await loadSprintAnalytics(workspace.admin, sprintQuery(cycleId), {
    now: new Date('2026-08-12T12:00:00.000Z'),
  });

  expect(currentOf(result).summary.currentScope).toBe(2);
  expect(currentOf(result).counterpart.currentScope).toBe(6);
  expect(result.formulas.points).toContain('counts as 1 point');
});
```

The counterpart expectation encodes the new points valuation: 5 estimated plus 1 default for the unestimated issue.

- [ ] **Step 2: Run and confirm the new tests fail**

Run: `cd packages/core && ORBIT_TEST_LANE=analytics-redesign bun --env-file=../../.env test tests/analytics/sprints.test.ts`

Expected: FAIL on `future`, `baseline`, `counterpart` being undefined.

- [ ] **Step 3: Implement in `sprints.ts`**

1. Extend the interfaces:

```ts
export interface SprintBurnPoint {
  readonly date: string;
  readonly calendarDay: number;
  readonly workingDay: number | null;
  readonly scope: number;
  readonly started: number;
  readonly completed: number;
  readonly remaining: number;
  readonly added: number;
  readonly removed: number;
  readonly ideal: number;
  readonly available: boolean;
  readonly future: boolean;
  readonly coverage: AnalyticsCoverage['kind'];
}

export interface SprintBaseline {
  readonly date: string;
  readonly scope: number;
  readonly retroactive: boolean;
}
```

`SprintDetail` gains `readonly baseline: SprintBaseline | null;` and `readonly counterpart: SprintMeasureSummary;`.

2. In `valueAt`, change the points fallback from `?? 0` to `?? 1`.

3. In `burnFor`, after the existing loop over observed days, append future days: starting at `addDate(lastDay, 1)` through `sprintFinalDay` (already computed), push a point per calendar day with `scope: 0, started: 0, completed: 0, remaining: 0, added: 0, removed: 0, available: false, future: true`, `calendarDay` continuing the count, `workingDay` via the existing working-day logic. Existing observed points get `future: false`.

4. Replace the ideal mapping. The baseline stays the first available point, but the trajectory anchors at day 1:

```ts
const baseline = points.find((point) => point.available && !point.future);
const initialScope = baseline?.scope ?? 0;
const plannedWorkingDays = Math.max(1, workingDaysBetween(startDay, sprintFinalDay));
return points.map((point) => ({
  ...point,
  ideal: idealRemaining(
    initialScope,
    workingDaysBetween(startDay, point.date) - 1,
    plannedWorkingDays - 1,
  ),
}));
```

Every point gets an ideal, including pre-capture and future days. Weekends inherit the previous working day's value because `workingDaysBetween` does not advance on them, which is the flat-weekend behavior.

5. In `detailFor`, compute the baseline and counterpart:

```ts
const baselinePoint = burn.find((point) => point.available && !point.future);
const capturedPlanned = cohortsPlannedValue;
const baseline =
  baselinePoint === undefined
    ? null
    : {
        date: baselinePoint.date,
        scope: baselinePoint.scope,
        retroactive: capturedPlanned === 0 && baselinePoint.scope > 0,
      };
const otherMeasure = measure === 'issues' ? ('points' as const) : ('issues' as const);
const counterpartBurn = burnFor(facts, otherMeasure, now, null);
const counterpart = summaryFor(facts, counterpartBurn, cohorts, otherMeasure, now, null);
```

where `cohortsPlannedValue` is the existing `sumCohort(cohorts.planned)` result surfaced from `summaryFor`. The cleanest cut: give `summaryFor` an options argument `{ baselineScope: number | null }` and inside it set `planned: captured > 0 ? captured : (baselineScope ?? 0)`. `detailFor` passes the team baseline for the team summary and each person's own first available burn scope for person summaries.

6. Update `formulas()`: `points: 'Unestimated work counts as 1 point until estimated.'` and extend the `burn` text with `The ideal line starts at sprint day 1 using the first reliable scope baseline and holds flat over weekends.`

7. Fix the existing expectations this intentionally changes:
   - `marks dates before observed membership capture as unavailable`: the series now runs to sprint end; assert on `burn.filter((point) => !point.future)` for the availability array, change `burn[3]?.ideal` to `toBeCloseTo(6 / 9, 5)`, and drop the assertion that unavailable ideals are 0 in favor of `burn[0]?.ideal` being the baseline scope.
   - Any burndown test that consumed trailing ideal values shifts the same way; `cycleBurndown` reads `point.ideal` from the series so its reference expectations may need the day-1 anchor values.

- [ ] **Step 4: Run the suite**

Run: `cd packages/core && ORBIT_TEST_LANE=analytics-redesign bun --env-file=../../.env test tests/analytics/`

Expected: PASS, including the untouched weekend-zero, half-open boundary, and bootstrap churn tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/analytics/sprints.ts packages/core/tests/analytics/sprints.test.ts packages/core/tests/analytics/burndown.test.ts
git commit -m "feat(analytics): anchor sprint burn on a retroactive baseline"
```

### Task 2: Web contracts for the new burn shape

**Files:**
- Modify: `apps/web/src/features/analytics/contracts.ts`
- Modify: `apps/web/tests/features/analytics/sprint-lens.test.tsx`, `people-lens.test.tsx` (fixtures only in this task)

**Interfaces:**
- Consumes: Task 1's `future`, `baseline`, `counterpart`.
- Produces: `sprintBurnPointSchema` gains `future: z.boolean()`; the sprint detail schema gains `baseline: z.object({ date: z.iso.date(), scope: z.number(), retroactive: z.boolean() }).nullable()` and `counterpart: sprintMeasureSummarySchema`. Fixture burn points across web tests carry `future: false`.

- [ ] **Step 1: Extend the Zod schemas** in `contracts.ts` exactly as above, next to `sprintBurnPointSchema` (line 96).

- [ ] **Step 2: Update every web fixture** that builds burn points (`sprint-lens.test.tsx`, `people-lens.test.tsx`) to add `future: false`, and give the sprint fixtures `baseline: { date: '2026-08-13', scope: 9, retroactive: false }` and a `counterpart` mirroring `summary`.

- [ ] **Step 3: Typecheck and run the web analytics tests**

Run: `cd apps/web && bun run typecheck && ORBIT_TEST_LANE=analytics-redesign bun --env-file=../../.env test tests/features/analytics/`

Expected: PASS. The UI does not consume the fields yet.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/features/analytics/contracts.ts apps/web/tests/features/analytics/
git commit -m "feat(analytics): carry baseline and future points in the wire contract"
```

### Task 3: Native-width hook and burn math helpers

**Files:**
- Create: `apps/web/src/lib/use-measured-width.ts`
- Create: `apps/web/src/features/analytics/burn-math.ts`
- Test: `apps/web/tests/lib/use-measured-width.test.tsx`, `apps/web/tests/features/analytics/burn-math.test.ts`

**Interfaces:**
- Produces:

```ts
export function useMeasuredWidth(fallback?: number): {
  readonly ref: RefObject<HTMLDivElement | null>;
  readonly width: number;
};

export interface SprintDay {
  readonly date: string;
  readonly weekend: boolean;
  readonly today: boolean;
  readonly future: boolean;
}
export function sprintDays(burn: readonly BurnPointLike[], today: string): readonly SprintDay[];
export function neededPace(remaining: number, burn: readonly BurnPointLike[]): number | null;
export function actualPace(burn: readonly BurnPointLike[]): number | null;
export function forecastDate(
  burn: readonly BurnPointLike[],
  completionWorkingDay: number,
): string | null;
```

with `BurnPointLike = Pick<SprintBurnPoint, 'date' | 'workingDay' | 'available' | 'future' | 'completed' | 'remaining'>`.

- [ ] **Step 1: Write the failing math tests**

```ts
import { describe, expect, test } from 'bun:test';
import {
  actualPace,
  forecastDate,
  neededPace,
  sprintDays,
} from '../../../src/features/analytics/burn-math.ts';

const point = (
  date: string,
  workingDay: number | null,
  extra: Partial<{ available: boolean; future: boolean; completed: number; remaining: number }> = {},
) => ({
  date,
  workingDay,
  available: extra.available ?? true,
  future: extra.future ?? false,
  completed: extra.completed ?? 0,
  remaining: extra.remaining ?? 0,
});

describe('sprintDays', () => {
  test('flags weekends, today, and future days', () => {
    const days = sprintDays(
      [
        point('2026-08-13', 1),
        point('2026-08-14', 2),
        point('2026-08-15', null, { future: true }),
        point('2026-08-16', null, { future: true }),
        point('2026-08-17', 3, { future: true }),
      ],
      '2026-08-14',
    );
    expect(days.map((day) => day.weekend)).toEqual([false, false, true, true, false]);
    expect(days[1]?.today).toBe(true);
    expect(days[4]?.future).toBe(true);
  });
});

describe('pace', () => {
  test('needed pace divides remaining by working days left including today', () => {
    const burn = [
      point('2026-08-13', 1, { remaining: 8 }),
      point('2026-08-14', 2, { remaining: 7 }),
      point('2026-08-17', 3, { future: true }),
      point('2026-08-18', 4, { future: true }),
    ];
    expect(neededPace(7, burn)).toBeCloseTo(7 / 3, 5);
  });

  test('actual pace divides completed since baseline by elapsed working days', () => {
    const burn = [
      point('2026-08-11', 1, { available: false }),
      point('2026-08-13', 3, { completed: 2 }),
      point('2026-08-14', 4, { completed: 5 }),
    ];
    expect(actualPace(burn)).toBeCloseTo(5 / 2, 5);
  });
});

describe('forecastDate', () => {
  test('maps a completion working day to a calendar date beyond the series', () => {
    const burn = [point('2026-08-13', 1), point('2026-08-14', 2)];
    expect(forecastDate(burn, 4)).toBe('2026-08-18');
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `cd apps/web && ORBIT_TEST_LANE=analytics-redesign bun --env-file=../../.env test tests/features/analytics/burn-math.test.ts`

Expected: FAIL, module missing.

- [ ] **Step 3: Implement `burn-math.ts`**

```ts
const DAY = 86_400_000;

function weekday(date: string): number {
  return new Date(`${date}T12:00:00.000Z`).getUTCDay();
}

function isWeekend(date: string): boolean {
  const day = weekday(date);
  return day === 0 || day === 6;
}

function nextDate(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + DAY).toISOString().slice(0, 10);
}

export function sprintDays(burn: readonly BurnPointLike[], today: string): readonly SprintDay[] {
  return burn.map((point) => ({
    date: point.date,
    weekend: isWeekend(point.date),
    today: point.date === today,
    future: point.future,
  }));
}

export function neededPace(remaining: number, burn: readonly BurnPointLike[]): number | null {
  const current = burn.filter((point) => !point.future).at(-1);
  const last = burn.at(-1);
  if (current?.workingDay == null || last?.workingDay == null) return null;
  const daysLeft = last.workingDay - current.workingDay + 1;
  return daysLeft <= 0 ? null : remaining / daysLeft;
}

export function actualPace(burn: readonly BurnPointLike[]): number | null {
  const observed = burn.filter((point) => point.available && !point.future);
  const first = observed[0];
  const current = observed.at(-1);
  if (first?.workingDay == null || current?.workingDay == null) return null;
  const elapsed = Math.max(1, current.workingDay - first.workingDay + 1);
  return current.completed / elapsed;
}

export function forecastDate(
  burn: readonly BurnPointLike[],
  completionWorkingDay: number,
): string | null {
  const inSeries = burn.find((point) => point.workingDay === completionWorkingDay);
  if (inSeries !== undefined) return inSeries.date;
  const last = burn.at(-1);
  if (last?.workingDay == null) return null;
  let date = last.date;
  let workingDay = last.workingDay;
  while (workingDay < completionWorkingDay) {
    date = nextDate(date);
    if (!isWeekend(date)) workingDay += 1;
  }
  return date;
}
```

`neededPace` uses the current working day when today is a working day because `current.workingDay` is that day's number; on a weekend the last non-future point carries the weekend date with `workingDay: null`, so walk back to the latest point with a working day before dividing (implement exactly that: take the last non-future point whose `workingDay` is not null).

Implement `use-measured-width.ts`:

```ts
import { type RefObject, useEffect, useRef, useState } from 'react';

export function useMeasuredWidth(fallback = 640): {
  readonly ref: RefObject<HTMLDivElement | null>;
  readonly width: number;
} {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const node = ref.current;
    if (node === null || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const measured = entries[0]?.contentRect.width;
      if (measured !== undefined && measured > 0) setWidth(Math.round(measured));
    });
    observer.observe(node);
    setWidth(Math.round(node.getBoundingClientRect().width) || fallback);
    return () => observer.disconnect();
  }, [fallback]);
  return { ref, width };
}
```

The hook test renders a div, asserts the fallback width when `ResizeObserver` is absent in happy-dom, and asserts the ref is attached. Follow `apps/web/src/features/docs/diagram-viewer.tsx:82` for the guard pattern.

- [ ] **Step 4: Run both test files, expect PASS**

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/use-measured-width.ts apps/web/src/features/analytics/burn-math.ts apps/web/tests/lib/use-measured-width.test.tsx apps/web/tests/features/analytics/burn-math.test.ts
git commit -m "feat(analytics): add native width hook and burn math"
```

### Task 4: Rebuild LinePlot on a native-scale day domain

**Files:**
- Rewrite: `apps/web/src/features/analytics/charts/line-plot.tsx`
- Modify: `apps/web/src/features/analytics/charts/plot-guides.tsx`, `chart-tooltip.tsx`
- Test: `apps/web/tests/features/analytics/line-plot.test.tsx`

**Interfaces:**
- Consumes: `useMeasuredWidth`, `SprintDay` from Task 3.
- Produces:

```ts
export interface PlotPoint {
  readonly id: string;
  readonly label: string;
  readonly value: number;
  readonly cohort: AnalyticsDrilldownCohort;
  readonly x?: number;
  readonly available?: boolean;
}
export interface PlotSeries {
  readonly id: string;
  readonly label: string;
  readonly points: readonly PlotPoint[];
  readonly dashed?: boolean;
  readonly step?: boolean;
  readonly dots?: boolean;
}
interface LinePlotProps {
  readonly label: string;
  readonly series: readonly PlotSeries[];
  readonly days?: readonly SprintDay[];
  readonly onActivate?: (cohort: AnalyticsDrilldownCohort) => void;
  readonly valueFormatter?: (value: number) => string;
  readonly xAxisLabel?: string;
  readonly yAxisLabel?: string;
  readonly annotation?: string;
}
```

When `days` is provided the x domain is one slot per day, points map to slots by `point.label` matching `day.date`, weekend slots draw a `var(--color-surface-raised)` background band, hover and keyboard focus select a day (not a point), and the tooltip lists every series with a value on that day. Without `days` the existing index and explicit-x behavior remains for velocity and timeline callers. `step` renders the scope staircase (horizontal then vertical segments). `dots` renders a small dot on each working-day point of that series (the ideal).

- [ ] **Step 1: Write the failing tests**

Keep the existing keyboard, gap, and table tests, then add:

```ts
test('renders one slot per sprint day with weekend bands and a full-day tooltip', async () => {
  const user = userEvent.setup();
  const days = [
    { date: '2026-08-13', weekend: false, today: false, future: false },
    { date: '2026-08-14', weekend: false, today: true, future: false },
    { date: '2026-08-15', weekend: true, today: false, future: true },
    { date: '2026-08-16', weekend: true, today: false, future: true },
    { date: '2026-08-17', weekend: false, today: false, future: true },
  ];
  render(
    <LinePlot
      days={days}
      label="Burn"
      series={[
        {
          id: 'remaining',
          label: 'Remaining',
          points: [
            { id: 'r1', label: '2026-08-13', value: 8, cohort: { cohort: 'open' } },
            { id: 'r2', label: '2026-08-14', value: 7, cohort: { cohort: 'open' } },
          ],
        },
        {
          id: 'ideal',
          label: 'Ideal',
          dashed: true,
          dots: true,
          points: days.map((day, index) => ({
            id: `i${index}`,
            label: day.date,
            value: 8 - index,
            cohort: { cohort: 'open' },
          })),
        },
      ]}
    />,
  );

  expect(screen.getAllByTestId('plot-weekend-band')).toHaveLength(2);
  expect(screen.getAllByTestId('plot-day-hit')).toHaveLength(5);
  await user.hover(screen.getAllByTestId('plot-day-hit')[1] as Element);
  const tooltip = screen.getByRole('tooltip');
  expect(tooltip).toHaveTextContent('Remaining 7');
  expect(tooltip).toHaveTextContent('Ideal 7');
});

test('renders the svg at the measured width instead of stretching a viewBox', () => {
  render(
    <LinePlot
      label="Burn"
      series={[
        {
          id: 'remaining',
          label: 'Remaining',
          points: [{ id: 'r1', label: '2026-08-13', value: 8, cohort: { cohort: 'open' } }],
        },
      ]}
    />,
  );
  const svg = screen.getByRole('application');
  expect(svg.getAttribute('viewBox')).toBeNull();
  expect(svg.getAttribute('width')).toBe('640');
});
```

- [ ] **Step 2: Run, confirm the new tests fail**

- [ ] **Step 3: Rewrite the component**

Geometry: `const { ref, width } = useMeasuredWidth();` and `const HEIGHT = 280; const LEFT = 56; const RIGHT = 16; const TOP = 12; const BOTTOM = 44;`. The `<svg>` gets `width={width} height={HEIGHT}` and no `viewBox`. Wrap it in `<div ref={ref} className="w-full">`.

Day domain: `const slot = (width - LEFT - RIGHT) / Math.max(1, days.length - 1);` and `xForDay(index) = LEFT + index * slot`. Weekend bands: for each weekend day render `<rect data-testid="plot-weekend-band" x={xForDay(index) - slot / 2} width={slot} y={TOP} height={HEIGHT - TOP - BOTTOM} fill="var(--color-surface-raised)" opacity="0.5" />` before the gridlines. Day hits: one `<rect data-testid="plot-day-hit" data-day-index={index}>` per day spanning the full plot height with `fill="transparent"`, driving `onPointerOver` and click. Ticks: label every `Math.ceil(days.length / Math.floor((width - LEFT - RIGHT) / 56))` days, always the first, last, and `today` slots.

Series drawing: for each series, map points into day slots via a `Map(day.date -> index)`; a point whose label is not in the map falls back to the legacy index positioning. `step: true` emits `H` then `V` path segments between consecutive points. `dots: true` draws `r=2.5` circles on points whose day is not a weekend. Availability gaps keep the existing `M`-restart behavior.

Tooltip: active state becomes `{ dayIndex: number }` when `days` is present. The tooltip body lists every series that has a point at that day: series label, formatted value, one line each, using the existing `ChartTooltip` extended with a `rows?: readonly { series: string; value: string }[]` prop. Keyboard: ArrowLeft and ArrowRight move the day index, Home and End jump, Enter activates the cohort of the first series with a point on that day, Escape clears. The announcement string joins the same rows for the live region.

Table rows: when `days` is present, pivot: one `AnalyticsDataRow` per day whose `cells` map series id to formatted value, columns built from the series list, first column the day date. Without `days`, keep the existing long format.

Legacy mode: everything currently passing (velocity, people timeline, forecast series with explicit `x`) must still render; keep the explicit-x code path intact behind `days === undefined`.

Update `plot-guides.tsx` to take `width`, `height`, and pixel margins as before but with 5 gridlines: `const ticks = [max, (3 * max) / 4, max / 2, max / 4, 0];` and font sizes stay 10 and 11.

- [ ] **Step 4: Run the full web analytics chart tests**

Run: `cd apps/web && ORBIT_TEST_LANE=analytics-redesign bun --env-file=../../.env test tests/features/analytics/line-plot.test.tsx tests/features/analytics/sprint-lens.test.tsx tests/features/analytics/people-lens.test.tsx tests/features/analytics/overview-lens.test.tsx`

Expected: PASS. Fix any caller fallout inside this task.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/analytics/charts/ apps/web/tests/features/analytics/
git commit -m "feat(analytics): render line charts native scale on a day domain"
```

### Task 5: BarPlot native scale, pairs, and average marker

**Files:**
- Modify: `apps/web/src/features/analytics/charts/bar-plot.tsx`
- Test: `apps/web/tests/features/analytics/bar-plot.test.tsx`

**Interfaces:**
- Produces: `BarPlotProps` gains `readonly pairs?: readonly { readonly id: string; readonly label: string; readonly primary: PlotPoint; readonly secondary: PlotPoint }[];` and `readonly averageLine?: { readonly value: number; readonly label: string };`. `primary` renders in `var(--analytics-series-1)`, `secondary` in `var(--color-border-strong)`, two thin bars per row. The average line is a vertical dashed line at its value with an end label. The svg renders at measured width like Task 4.

- [ ] **Step 1: Write failing tests**: paired rows render two bars each (`plot-bar-primary-<id>`, `plot-bar-secondary-<id>`), the average line renders at the correct x proportion with its label, and the svg has explicit `width` and no `viewBox`.

- [ ] **Step 2: Run, confirm failure.**

- [ ] **Step 3: Implement** using `useMeasuredWidth`; pairs mode computes `max` over both values of every pair; each row is `ROW_HEIGHT = 30` with two 8px bars. Average line: `<line x1={x} x2={x} y1={TOP} y2={TOP + plotHeight} strokeDasharray="4 4" stroke="var(--color-border-strong)" data-testid="plot-average-line" />` plus an 10px text label above.

- [ ] **Step 4: Run bar-plot and overview-lens tests, expect PASS.**

- [ ] **Step 5: Commit** `feat(analytics): bar plot native scale with pairs and average marker`.

### Task 6: Sprint stat strip

**Files:**
- Create: `apps/web/src/features/analytics/sprint-stats.tsx`
- Test: `apps/web/tests/features/analytics/sprint-stats.test.tsx`

**Interfaces:**
- Consumes: `neededPace`, `actualPace`, `forecastDate`, `burnForecast` (exported from `sprint-lens.tsx` or moved into `burn-math.ts`; move it into `burn-math.ts` and re-export), the Task 1 contract fields.
- Produces: `export function SprintStats({ current, measure }: { current: SprintCurrent; measure: AnalyticsMeasure })` rendering one dense strip with items: Scope (`194 issues · 502 pts`, both measures from `summary` plus `counterpart`), Completed with percent, Started with percent, Remaining, Churn (`+1 added · 0 removed`), Pace (`needed 17.8/d · actual 5.3/d`), Forecast (date plus `N days late` in `text-warning` when past sprint end, `on track` in accent otherwise, `needs 3 working days` when null), People (count of `current.people`).

- [ ] **Step 1: Failing test**: render with the sprint fixture and assert the strip shows both measures in Scope, computed percentages, pace values from the fixture burn, `9 people` for a nine-entry people array, and the late forecast case colors via `toHaveClass('text-warning')` on the forecast value when the forecast date exceeds the sprint end date.

- [ ] **Step 2: Run, confirm failure.**

- [ ] **Step 3: Implement.** Layout: `flex flex-wrap gap-x-5 gap-y-1 text-xs`, each item `<span className="text-muted">Label <strong className="font-medium text-text">value</strong></span>`. Percentages: `Math.round((completed / Math.max(1, scope)) * 100)`. Started value comes from the last non-future burn point's `started`.

- [ ] **Step 4: Run, expect PASS.**

- [ ] **Step 5: Commit** `feat(analytics): add the sprint stat strip`.

### Task 7: Wire the sprint lens

**Files:**
- Modify: `apps/web/src/features/analytics/sprint-lens.tsx`
- Test: `apps/web/tests/features/analytics/sprint-lens.test.tsx`

**Interfaces:**
- Consumes: everything from Tasks 1 through 6.
- Produces: the sprint page renders `SprintStats` instead of the four summary cards, a full-span day-domain burn chart, and honest captions.

- [ ] **Step 1: Failing tests**

```ts
test('frames the whole sprint with weekend bands and a day tooltip', async () => {
  const user = userEvent.setup();
  render(<SprintLens data={dataWithFutureBurn} query={sprintQueryFixture} />);
  expect(screen.getAllByTestId('plot-weekend-band').length).toBeGreaterThanOrEqual(4);
  expect(screen.getAllByTestId('plot-day-hit')).toHaveLength(14);
  await user.hover(screen.getAllByTestId('plot-day-hit')[3] as Element);
  const tooltip = screen.getByRole('tooltip');
  expect(tooltip).toHaveTextContent('Remaining');
  expect(tooltip).toHaveTextContent('Ideal');
});

test('states the capture start once instead of blanking the frame', () => {
  render(<SprintLens data={dataWithRetroBaseline} query={sprintQueryFixture} />);
  expect(screen.getByText(/capture began aug 14/i)).toBeVisible();
  expect(screen.queryByText(/dates unavailable/i)).not.toBeInTheDocument();
});
```

`dataWithFutureBurn` builds a 14-day burn (Aug 13 sprint fixture start Aug 13 to Aug 27 exclusive gives Aug 13 through Aug 26: use 14 points, days 1 and 2 observed, the rest `future: true`).

- [ ] **Step 2: Run, confirm failure.**

- [ ] **Step 3: Rewire `SprintBurnChart`:**
  - Build `days = sprintDays(current.burn, todayDate)` where `todayDate` is the last non-future point's date, pass `days` to `LinePlot`.
  - Burn-down series: Remaining (`available && !future` points only), Scope (`step: true`, gray via series token 4, observed points only), Ideal (`dashed: true, dots: true`, every point), Forecast (existing dotted extension, explicit x preserved by mapping its two points onto day labels: current date and `forecastDate` result; when the forecast lands past sprint end, clamp the segment at the final day and let the stat strip carry the date).
  - Burn-up series: Completed, Started rendered as `completed + started` (stacked visually by drawing Started above Completed), Scope, Target (`dashed`, `initialScope - ideal` per point).
  - Delete the local `workingDayNumber`, `sprintEnd` computation, and synthetic `sprint-end-ideal` point: the server now supplies the full span. Delete `trackingAnnotation`'s multi-line gap warnings; replace with the single caption `Capture began {readableDate(baseline.date)}. Earlier days show targets only.` shown only when `baseline?.retroactive` is true.
  - Replace the summary card grid with `<SprintStats current={current} measure={current.measure} />`.
  - Update the unestimated copy to `N unestimated issues count as 1 point each.`
- Move `burnForecast` into `burn-math.ts` unchanged and import it.

- [ ] **Step 4: Run the sprint lens suite, expect PASS.** Update surviving expectations (`plot-x-end` now reads the final sprint day, the old `sprint-end-ideal` assertions are deleted with the feature they tested, weekend expectations move to the new day-domain test).

- [ ] **Step 5: Commit** `feat(analytics): rebuild the sprint lens on the full sprint frame`.

### Task 8: Personal burn on the same frame

**Files:**
- Modify: `apps/web/src/features/analytics/people-lens.tsx` and the `focus` section of `sprint-lens.tsx`
- Test: `apps/web/tests/features/analytics/people-lens.test.tsx`

- [ ] **Step 1: Failing test**: the personal chart renders one `plot-day-hit` per sprint day and an `plot-line-ideal-person` series; with a retro baseline fixture it shows the capture caption and no `dates unavailable` text.

- [ ] **Step 2: Run, confirm failure.**

- [ ] **Step 3: Implement:** `PersonalSprintBurn` passes `days={sprintDays(current.burn, today)}`, adds an Ideal series from `point.ideal` (`dashed, dots`), keeps Remaining on observed points, keeps the previous-sprint overlay in legacy explicit-x form clamped to elapsed days. Apply the same to the `focus` burn card in `sprint-lens.tsx`.

- [ ] **Step 4: Run, expect PASS.**

- [ ] **Step 5: Commit** `feat(analytics): give personal burn the full sprint frame`.

### Task 9: Velocity pairs and phase 1 verification

**Files:**
- Modify: `apps/web/src/features/analytics/sprint-lens.tsx` (velocity card)
- Modify: `apps/web/e2e/analytics.spec.ts`
- Test: `apps/web/tests/features/analytics/sprint-lens.test.tsx`

- [ ] **Step 1: Failing test**: velocity renders paired bars (planned secondary, completed primary) per past sprint, an average line labeled with the mean completed value, and the current sprint appended with `--analytics-series` lightened styling (`data-testid="plot-pair-current"`).

- [ ] **Step 2: Run, confirm failure.**

- [ ] **Step 3: Implement** with Task 5's `pairs` and `averageLine`: pairs from `data.velocity` (`planned` and `completed` fields), average over completed values, current sprint pair from `current.summary` marked in-progress.

- [ ] **Step 4: Update the Playwright spec:** the sprint page shows `plot-day-hit` count equal to sprint length, the stat strip with both measures, and toggling Burn up swaps series without losing the frame. Run `cd apps/web && bun run test:e2e -- analytics.spec.ts` if the project defines it, otherwise `bunx playwright test e2e/analytics.spec.ts`.

- [ ] **Step 5: Run the full phase 1 gate**

Run: `ORBIT_TEST_LANE=analytics-redesign bun run verify`

Expected: green. Capture light and dark screenshots of the sprint page at 1680x1000 for the PR.

- [ ] **Step 6: Commit** `feat(analytics): pair velocity bars and verify phase 1`.

### Task 10: Insight contract and lens registration

**Files:**
- Modify: `packages/shared/src/validators/analytics.ts`
- Test: `packages/shared/tests/validators/analytics.test.ts`

**Interfaces:**
- Produces:

```ts
export const INSIGHT_MEASURES = ['count', 'points', 'cycle_time', 'lead_time', 'age'] as const;
export const INSIGHT_SLICES = [
  'assignee',
  'state',
  'state_category',
  'project',
  'label',
  'priority',
  'sprint',
  'created_week',
  'completed_week',
] as const;
export const insightConfigSchema = z
  .object({
    measure: z.enum(INSIGHT_MEASURES).default('count'),
    slice: z.enum(INSIGHT_SLICES).default('state_category'),
    segment: z.enum(INSIGHT_SLICES).optional(),
    cumulative: z.boolean().default(false),
  })
  .refine((config) => config.segment !== config.slice, {
    message: 'Segment must differ from slice.',
    path: ['segment'],
  });
export const analyticsInsightsQuerySchema = analyticsQuerySchema.extend({
  insight: insightConfigSchema.default({}),
});
export type InsightMeasure = (typeof INSIGHT_MEASURES)[number];
export type InsightSlice = (typeof INSIGHT_SLICES)[number];
export type InsightConfig = z.infer<typeof insightConfigSchema>;
export type AnalyticsInsightsQuery = z.infer<typeof analyticsInsightsQuerySchema>;
```

`ANALYTICS_LENSES` gains `'insights'`. Segments are only meaningful for `count` and `points`; the schema allows them anywhere and the server ignores them for scatter measures (documented in the route test).

- [ ] **Step 1: Failing tests**: defaults fill, `segment === slice` rejects, `'insights'` is a valid lens.

- [ ] **Step 2: Run shared tests, confirm failure.**

- [ ] **Step 3: Implement, run shared tests and typecheck, expect PASS.** Check every `switch` over `AnalyticsLens` in web and core still typechecks; add `insights` arms where the compiler demands.

- [ ] **Step 4: Commit** `feat(analytics): define the insight query contract`.

### Task 11: Drilldown cohorts for the new slices

**Files:**
- Modify: `packages/core/src/analytics/drilldown.ts`
- Test: `packages/core/tests/analytics/drilldown.test.ts`

**Interfaces:**
- Produces: valid cohort keys `assignee:<id>`, `assignee:none`, `label:<id>`, `label:none`, `sprint:<id>`, `sprint:none`, `created-week:<iso-date>`, `completed-week:<iso-date>` with matching predicates in `dimensionCohortPredicate`:

```ts
if (cohort.cohort.startsWith('assignee:')) {
  const id = cohort.cohort.slice('assignee:'.length);
  return id === 'none' ? isNull(schema.issue.assigneeId) : eq(schema.issue.assigneeId, id);
}
if (cohort.cohort.startsWith('label:')) {
  const id = cohort.cohort.slice('label:'.length);
  return id === 'none'
    ? sql`not exists (select 1 from issue_label where issue_label.issue_id = ${schema.issue.id})`
    : sql`exists (select 1 from issue_label where issue_label.issue_id = ${schema.issue.id} and issue_label.label_id = ${id})`;
}
if (cohort.cohort.startsWith('sprint:')) {
  const id = cohort.cohort.slice('sprint:'.length);
  return id === 'none' ? isNull(schema.issue.cycleId) : eq(schema.issue.cycleId, id);
}
if (cohort.cohort.startsWith('created-week:')) {
  const week = cohort.cohort.slice('created-week:'.length);
  return sql`date_trunc('week', ${schema.issue.createdAt}) = ${week}::date`;
}
if (cohort.cohort.startsWith('completed-week:')) {
  const week = cohort.cohort.slice('completed-week:'.length);
  return sql`date_trunc('week', ${schema.issue.completedAt}) = ${week}::date`;
}
```

`validDimensionCohort` accepts the id forms via `validIdCohort(value, 'assignee', new Set(['none']))` and the week forms via `/^(created|completed)-week:\d{4}-\d{2}-\d{2}$/`.

- [ ] **Step 1: Failing tests**: one positive drilldown per new cohort (create issues, assert the filtered listing) and the malformed list extended with `assignee:`, `label:not-an-id`, `sprint:`, `created-week:junk`, `completed-week:2026-13-99` still rejecting before SQL.

- [ ] **Step 2: Run, confirm failure. Step 3: Implement. Step 4: Run drilldown tests, expect PASS.**

- [ ] **Step 5: Commit** `feat(analytics): drill into assignee, label, sprint, and week cohorts`.

### Task 12: Core insights aggregation

**Files:**
- Create: `packages/core/src/analytics/insights.ts`
- Modify: `packages/core/src/analytics/index.ts`, `packages/core/src/analytics/math.ts`
- Test: `packages/core/tests/analytics/insights.test.ts`, `packages/core/tests/analytics/math.test.ts`

**Interfaces:**
- Consumes: `baseAnalyticsPredicate` and the query resolution helpers exported by `drilldown.ts` (export them if still module-private), `assertCan(principal, 'analytics:read')`.
- Produces:

```ts
export interface InsightSegmentValue {
  readonly id: string;
  readonly label: string;
  readonly value: number;
}
export interface InsightBucket {
  readonly id: string;
  readonly label: string;
  readonly value: number;
  readonly segments: readonly InsightSegmentValue[];
  readonly cohort: AnalyticsDrilldownCohort;
}
export interface InsightScatterPoint {
  readonly issueId: string;
  readonly identifier: string;
  readonly title: string;
  readonly days: number;
}
export interface InsightPercentiles {
  readonly p25: number;
  readonly p50: number;
  readonly p75: number;
  readonly p95: number;
}
export type InsightResult =
  | { readonly kind: 'bars'; readonly unit: 'issues' | 'points'; readonly buckets: readonly InsightBucket[] }
  | { readonly kind: 'scatter'; readonly unit: 'days'; readonly points: readonly InsightScatterPoint[]; readonly percentiles: InsightPercentiles | null };

export async function loadAnalyticsInsights(
  principal: Principal,
  query: AnalyticsQuery,
  insight: InsightConfig,
  context: { readonly now: Date; readonly timezone?: string },
): Promise<InsightResult>;
```

`math.ts` gains `export function percentilesOf(values: readonly number[]): InsightPercentiles | null` (null for empty input, linear interpolation between ranks).

Slice SQL, one dimension table used by both the id and the label expression:

```ts
const SLICE_SQL: Record<InsightSlice, { id: SQL<unknown>; label: SQL<unknown>; cohortPrefix: string }> = {
  assignee: {
    id: sql`coalesce(${schema.issue.assigneeId}, 'none')`,
    label: sql`coalesce("user".name, 'Unassigned')`,
    cohortPrefix: 'assignee',
  },
  state: {
    id: sql`${schema.issue.stateId}`,
    label: sql`workflow_state.name`,
    cohortPrefix: 'state',
  },
  state_category: {
    id: sql`workflow_state.category::text`,
    label: sql`workflow_state.category::text`,
    cohortPrefix: 'state-category',
  },
  project: {
    id: sql`coalesce(${schema.issue.projectId}, 'none')`,
    label: sql`coalesce(project.name, 'No project')`,
    cohortPrefix: 'project',
  },
  label: {
    id: sql`coalesce(issue_label.label_id, 'none')`,
    label: sql`coalesce(label.name, 'No label')`,
    cohortPrefix: 'label',
  },
  priority: {
    id: sql`${schema.issue.priority}::text`,
    label: sql`${schema.issue.priority}::text`,
    cohortPrefix: 'priority',
  },
  sprint: {
    id: sql`coalesce(${schema.issue.cycleId}, 'none')`,
    label: sql`coalesce(cycle.name, 'No sprint')`,
    cohortPrefix: 'sprint',
  },
  created_week: {
    id: sql`to_char(date_trunc('week', ${schema.issue.createdAt}), 'YYYY-MM-DD')`,
    label: sql`to_char(date_trunc('week', ${schema.issue.createdAt}), 'YYYY-MM-DD')`,
    cohortPrefix: 'created-week',
  },
  completed_week: {
    id: sql`to_char(date_trunc('week', ${schema.issue.completedAt}), 'YYYY-MM-DD')`,
    label: sql`to_char(date_trunc('week', ${schema.issue.completedAt}), 'YYYY-MM-DD')`,
    cohortPrefix: 'completed-week',
  },
};
```

Bars query: from `issue` joined to `workflow_state` (always), left joined to `user`, `project`, `cycle`, `issue_label` plus `label` only when the slice or segment needs them, where the base predicate holds, `completed_week` additionally requires `completedAt is not null`, group by slice id and label plus segment id and label when present, weight `sql`1`` for count and `coalesce(issue.estimate, 1)` for points (matching Task 1's default), ordered by total descending, slices capped at 30 and segments per slice at 8 with an `other` rollup, priority labels mapped through `PRIORITY_LABELS` in TypeScript after the query.

Scatter query: `cycle_time` selects `extract(epoch from (completed_at - started_at)) / 86400` where both timestamps exist, `lead_time` uses `created_at`, `age` uses `now - created_at` for issues whose state category is not completed or canceled. Cap at 500 points ordered by duration descending, and compute percentiles in TypeScript from the full value list fetched as durations only (`select` the duration column for all matching rows, cap only the joined issue details).

- [ ] **Step 1: Failing tests**: percentile math unit tests (`percentilesOf([1,2,3,4])`), a bars test (two states, segment by priority, sums and cohorts assert), a labels test (an issue with two labels appears under both and the caption count reflects it), a scatter test (two completed issues with known durations produce points and exact percentiles), and an authorization test that a principal without `analytics:read` is rejected (follow the existing drilldown test's pattern).

- [ ] **Step 2: Run, confirm failure. Step 3: Implement. Step 4: Run insights, math, and drilldown suites, expect PASS.**

- [ ] **Step 5: Commit** `feat(analytics): aggregate insights by measure, slice, and segment`.

### Task 13: Insights API route and web contract

**Files:**
- Create: `apps/web/src/app/api/analytics/insights/route.ts`
- Modify: `apps/web/src/features/analytics/contracts.ts`, `analytics-keys.ts`, `data.ts`
- Test: `apps/web/tests/app/api/analytics/insights/route.test.ts`

**Interfaces:**
- Consumes: `loadAnalyticsInsights`, `analyticsInsightsQuerySchema`.
- Produces: `GET /api/analytics/insights?query=<url-encoded json>` following the exact parse-authenticate-respond pattern of `apps/web/src/app/api/analytics/drilldown/route.ts`, returning `InsightResult` as JSON; `analyticsInsightsWireResponse` Zod schema in `contracts.ts` (discriminated union on `kind`); `analyticsKeys.insights(input)` query key; a `fetchInsights` helper beside the other fetchers in `data.ts`.

- [ ] **Step 1: Failing route test**: authenticated request with a valid query returns 200 and a `kind`; malformed `insight.measure` returns 422; unauthenticated returns 401. Copy the harness style from the existing drilldown route test.

- [ ] **Step 2 through 4: Run failing, implement, run passing.**

- [ ] **Step 5: Commit** `feat(analytics): serve insights over the analytics api`.

### Task 14: Scatterplot primitive

**Files:**
- Create: `apps/web/src/features/analytics/charts/scatter-plot.tsx`
- Test: `apps/web/tests/features/analytics/scatter-plot.test.tsx`

**Interfaces:**
- Consumes: `useMeasuredWidth`, `PlotFrame`, `ChartTooltip`, `InsightScatterPoint`, `InsightPercentiles`.
- Produces:

```ts
interface ScatterPlotProps {
  readonly label: string;
  readonly points: readonly InsightScatterPoint[];
  readonly percentiles: InsightPercentiles | null;
  readonly unitLabel: string;
}
```

X is the point's index ordered by duration ascending (rank), y is `days`. Percentile lines: horizontal dashed lines at p25, p50, p75, p95 with `data-testid="plot-percentile-p50"` and right-edge labels; hovering a line shows its exact value in the tooltip. Each point is a 3px circle plus a 9px hit circle carrying `data-testid={`plot-scatter-${identifier}`}`; hover shows identifier, title, and `N days`; click and Enter open `/issue/${identifier}` via `next/link` semantics (render each hit inside an `<a href>` wrapper so keyboard access is native). Arrow keys walk points by rank.

- [ ] **Step 1: Failing tests**: four points render four hits, the four percentile lines exist, hovering a point shows its identifier and formatted days, the point link points at `/issue/NOV-1`.

- [ ] **Step 2 through 4: fail, implement, pass.**

- [ ] **Step 5: Commit** `feat(analytics): add the percentile scatterplot`.

### Task 15: Insights lens UI

**Files:**
- Create: `apps/web/src/features/analytics/insights-lens.tsx`
- Modify: `apps/web/src/features/analytics/charts/bar-plot.tsx` (stacked segments), `analytics-tabs.tsx`, `query-state.ts`, `apps/web/src/app/(app)/analytics/page.tsx`, `data.ts`
- Test: `apps/web/tests/features/analytics/insights-lens.test.tsx`, `apps/web/tests/features/analytics/bar-plot.test.tsx`

**Interfaces:**
- Consumes: Task 13's fetcher and keys, Task 14's scatterplot, Task 5's bar plot.
- Produces:
  - `BarPlot` gains `readonly segments?: boolean` mode: when a point carries `readonly segments: readonly InsightSegmentValue[]`, the row renders stacked rectangles colored `var(--analytics-series-N)` cycling 1 through 4, tooltip lists each segment value.
  - `InsightsLens` renders three `MeasureToggle`-style pickers (Measure, Slice, Segment with a None option) that write `insight.measure`, `insight.slice`, `insight.segment`, `insight.cumulative` into the URL through `query-state.ts`, fetches via TanStack Query, renders bars for count and points, scatter for durations, and for `created_week` and `completed_week` slices offers a `Cumulative` toggle that turns the bar data into a running-total line rendered with `LinePlot` (legacy mode, week labels on x).
  - Bar activation: property slices push a temporary filter chip: build the matching filter condition (`property: 'assignee' | 'state' | 'project' | 'label' | 'priority' | 'cycle'`, `operator: 'in'`, `values: [id]`) into `query.filter` through the existing filter helpers in `query-state.ts`, rendered with the toolbar's existing chip removal. Week slices open the drilldown dialog with the `created-week:` or `completed-week:` cohort instead.
  - Chart and table link: hovering a bar row highlights the matching table row through the existing `activeRowId` mechanism and the reverse through `onActivate`.
  - `analytics-tabs.tsx` adds the Insights tab for lens `insights`; `page.tsx` renders the lens; `data.ts` prefetches the default insight for the lens on the server like the other lenses.

- [ ] **Step 1: Failing tests**: lens renders pickers and a bar chart from a mocked bars response; switching measure to `cycle_time` renders the scatterplot; clicking a state bar calls the filter-push handler with the `in` condition; segment stacking renders one rect per segment; cumulative toggle renders a line plot for `completed_week`.

- [ ] **Step 2 through 4: fail, implement, pass.** Include `analytics-tabs` and `query-state` test updates for the new lens value.

- [ ] **Step 5: Commit** `feat(analytics): add the insights lens`.

### Task 16: End-to-end coverage and final verification

**Files:**
- Modify: `apps/web/e2e/analytics.spec.ts`
- Modify: `docs/superpowers/specs/2026-08-15-sprint-analytics-redesign-design.md` only if reality diverged; note divergences in the PR body instead where possible.

- [ ] **Step 1: Extend the Playwright spec**: navigate to the insights lens, assert the pickers render, choose slice assignee, assert bars and the linked table, choose measure cycle time, assert the scatterplot and percentile lines.

- [ ] **Step 2: Run the whole gate**

Run: `ORBIT_TEST_LANE=analytics-redesign bun run verify`
Run: `cd apps/web && bun run build`

Expected: everything green, production build clean.

- [ ] **Step 3: Capture light and dark screenshots** of the sprint lens and insights lens at 1680x1000 for the PR body.

- [ ] **Step 4: Commit** `test(analytics): cover the redesigned lenses end to end`, then open the PR titled `feat(analytics): planning-grade sprint burn and insights lens` with the spec linked, screenshots, and the verification evidence. Merge the current `main` in first and let checks run against the merged state per the repository review rules.

---

## Self-review notes

- Spec coverage: rendering model (Task 4), burn series (Tasks 1, 7), stat strip (Task 6), retroactive baseline (Tasks 1, 7), pivoted table (Task 4), personal burn (Task 8), velocity (Task 9), grammar and measures (Tasks 10, 12), scatter percentiles (Tasks 12, 14), linked table and temporary filters (Task 15), burn-up cumulative (Task 15), drill cohorts (Task 11), route (Task 13), e2e and screenshots (Tasks 9, 16). Non-goals stay out.
- The PR 313 properties are restated in Global Constraints so expectation updates in Task 1 cannot silently delete them.
- Type names used across tasks: `SprintDay`, `InsightBucket`, `InsightScatterPoint`, `InsightPercentiles`, `InsightResult`, `InsightConfig` are defined once (Tasks 3, 10, 12) and only consumed elsewhere.

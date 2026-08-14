# Analytics Planning Cockpit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Orbit's basic analytics report with a fast, zero-configuration planning cockpit for workspace, sprint, project, milestone, and person decisions.

**Architecture:** A versioned analytics query contract drives server-rendered defaults, URL state, lens APIs, saved views, drilldowns, and exports. Core services compile one workspace-scoped issue predicate into bounded aggregates, while an immutable sprint membership and outcome ledger makes previous burn, churn, and carryover trustworthy from rollout forward. The web app hydrates the default lens into TanStack Query, renders lightweight accessible SVG charts, and invalidates mounted analytics queries through the existing realtime bridge.

**Tech Stack:** Bun 1.3+, TypeScript 5.9, Next.js 16 App Router, React 19, PostgreSQL, Drizzle ORM, Zod 4, TanStack Query 5, Radix UI, cmdk, Tailwind CSS 4, Bun test, Testing Library, Playwright.

## Global Constraints

- Use Bun only. Do not use npm, pnpm, yarn, or turbo.
- Shipped web and core code runs on Node and must not import Bun built-ins.
- Add no code comments except functional directives accepted by `bun run check-comments`.
- Use no em-dash characters in code, docs, commits, branch names, or pull request text.
- Add no AI attribution.
- Use strict types, no `any`, no non-null assertions, and Zod parsing for external input.
- Tests live in each package's `tests/` tree and import from `bun:test`.
- Authorization is enforced in `packages/shared/src/policy` and core services.
- Every feature task starts with a failing test and ends with a focused commit.
- Use `ORBIT_TEST_LANE=analytics-cockpit` for database-backed test commands.
- Keep organization isolation strict while analytics data is workspace-wide inside one organization.
- Do not fabricate pre-rollout sprint history. Expose coverage as observed, reconstructed, or frozen.
- Preserve Orbit's design tokens and component language while adopting Linear's interaction patterns.
- The approved design is `docs/superpowers/specs/2026-08-11-analytics-planning-cockpit-design.md`.

---

## File structure map

### Shared contract and policy

- Create `packages/shared/src/validators/analytics.ts` for the versioned query, date range, comparison, lens, measure, focus, and drilldown cohort schemas.
- Create `packages/shared/tests/validators/analytics.test.ts` for defaults, malformed values, and URL-safe round trips.
- Modify `packages/shared/src/validators/index.ts` to export the contract.
- Modify `packages/shared/src/policy/index.ts` and `packages/shared/tests/policy/policy.test.ts` to add `analytics:read` for every workspace role.

### Database and core facts

- Modify `packages/db/src/schema/work.ts` for `cycle_issue_membership`, `cycle_issue_outcome`, and final snapshot metadata.
- Generate the next Drizzle migration and snapshot under `packages/db/drizzle/`.
- Create `packages/core/src/analytics/membership.ts` for transaction-safe sprint membership and outcome writes.
- Modify `packages/core/src/work/issue-service.ts` and `packages/core/src/work/cycle-service.ts` to call membership capture inside existing mutations.
- Modify `packages/core/src/analytics/snapshot.ts` for sprint-local dates and final capture.
- Create `apps/web/src/app/api/cron/analytics-snapshots/route.ts` and its route test.

### Query services

- Create `packages/core/src/work/issue-query.ts` for reusable team-scoped and workspace-analytics predicates.
- Create `packages/core/src/analytics/types.ts` for shared metric, bucket, coverage, and freshness types.
- Create `packages/core/src/analytics/filter.ts` for default and date/comparison resolution.
- Create `packages/core/src/analytics/overview.ts`, `sprints.ts`, `projects.ts`, `people.ts`, and `drilldown.ts` for bounded lens payloads.
- Modify `packages/core/src/analytics/index.ts` and `packages/core/src/index.ts` to export public entry points.
- Retire duplicated current analytics queries only after their replacements are covered.

### Web data and interaction

- Create `apps/web/src/features/analytics/contracts.ts` for response schemas and query-key inputs.
- Create `apps/web/src/features/analytics/query-state.ts` and `use-analytics-query.ts` for canonical defaults and URL synchronization.
- Create `apps/web/src/features/analytics/analytics-cockpit.tsx`, `analytics-toolbar.tsx`, `analytics-tabs.tsx`, and `date-range-picker.tsx`.
- Create `apps/web/src/features/analytics/charts/` for a shared plot frame, tooltip model, line/burn plot, bar plot, and linked data table.
- Create `overview-lens.tsx`, `sprint-lens.tsx`, `projects-lens.tsx`, `people-lens.tsx`, and `analytics-drilldown-dialog.tsx`.
- Replace the current page composition in `apps/web/src/app/(app)/analytics/page.tsx` and update `loading.tsx` and analytics skeletons.
- Add one route per lens plus drilldown and extend export and saved-view routes.
- Modify `apps/web/src/lib/query/keys.ts` and `apps/web/src/lib/realtime/delta-bridge.tsx` for canonical analytics invalidation.

### Verification

- Add focused component and route tests under `apps/web/tests/features/analytics/` and `apps/web/tests/app/api/analytics/`.
- Add `apps/web/e2e/analytics.spec.ts` for the complete browser flow.
- Extend `apps/web/scripts/capture-screenshots.ts` with analytics hover and advanced-filter states.

---

### Task 1: Add the versioned analytics contract and permission

**Files:**
- Create: `packages/shared/src/validators/analytics.ts`
- Create: `packages/shared/tests/validators/analytics.test.ts`
- Modify: `packages/shared/src/validators/index.ts`
- Modify: `packages/shared/src/policy/index.ts`
- Modify: `packages/shared/tests/policy/policy.test.ts`

**Interfaces:**
- Consumes: `filterGroupQuerySchema` from `@orbit/shared/filters`.
- Produces: `analyticsQuerySchema`, `analyticsDrilldownQuerySchema`, `AnalyticsQuery`, `AnalyticsLens`, `AnalyticsMeasure`, `AnalyticsRange`, `AnalyticsCompare`, and permission `analytics:read`.

- [ ] **Step 1: Write failing validator and policy tests**

```ts
import { describe, expect, it } from 'bun:test';
import { analyticsQuerySchema } from '../../src/validators/analytics.ts';

describe('analyticsQuerySchema', () => {
  it('fills the clean URL defaults', () => {
    expect(analyticsQuerySchema.parse({})).toMatchObject({
      version: 1,
      lens: 'overview',
      range: { preset: 'auto' },
      compare: 'auto',
      measure: 'issues',
      includeArchived: false,
      includeCanceled: false,
    });
  });

  it('rejects a reversed custom range', () => {
    expect(() =>
      analyticsQuerySchema.parse({
        range: { preset: 'custom', from: '2026-08-11', to: '2026-08-01' },
      }),
    ).toThrow();
  });
});
```

Add a policy test that asserts `permissionsFor(role)` contains `analytics:read` for `guest`, `contributor`, `member`, and `admin`.

- [ ] **Step 2: Run the tests and confirm the new exports and permission fail**

Run: `bun run --filter '@orbit/shared' test`

Expected: FAIL because `analytics.ts` and `analytics:read` do not exist.

- [ ] **Step 3: Implement the schemas and permission**

```ts
export const ANALYTICS_LENSES = ['overview', 'sprints', 'projects', 'people'] as const;
export const ANALYTICS_MEASURES = ['issues', 'points'] as const;
export const ANALYTICS_COMPARE = ['auto', 'none', 'previous_period', 'previous_sprint'] as const;
export const ANALYTICS_RANGE_PRESETS = [
  'auto',
  'active_sprint',
  'previous_sprint',
  'last_30_days',
  'last_90_days',
  'all_time',
  'custom',
] as const;

export const analyticsQuerySchema = z.object({
  version: z.literal(1).default(1),
  lens: z.enum(ANALYTICS_LENSES).default('overview'),
  range: analyticsRangeSchema.default({ preset: 'auto' }),
  compare: z.enum(ANALYTICS_COMPARE).default('auto'),
  measure: z.enum(ANALYTICS_MEASURES).default('issues'),
  filter: filterGroupQuerySchema.default({ kind: 'group', operator: 'and', children: [] }),
  includeArchived: z.boolean().default(false),
  includeCanceled: z.boolean().default(false),
  focus: analyticsFocusSchema.default({}),
});
```

Add `analytics:read` to `PERMISSIONS` and `GUEST_PERMISSIONS` so every higher role inherits it.

- [ ] **Step 4: Run shared tests, typecheck, and repository policy checks**

Run: `bun run --filter '@orbit/shared' test`

Run: `bun run --filter '@orbit/shared' typecheck`

Run: `bun run check-comments`

Expected: PASS.

- [ ] **Step 5: Commit the contract**

```bash
git add packages/shared/src/validators/analytics.ts packages/shared/src/validators/index.ts packages/shared/src/policy/index.ts packages/shared/tests/validators/analytics.test.ts packages/shared/tests/policy/policy.test.ts
git commit -m "feat(analytics): define query contract"
```

### Task 2: Add immutable sprint membership and outcome schema

**Files:**
- Modify: `packages/db/src/schema/work.ts`
- Modify: `packages/db/tests/schema/index.test.ts`
- Create: next generated files under `packages/db/drizzle/`

**Interfaces:**
- Consumes: existing `organization`, `team`, `cycle`, `issue`, `user`, `project`, and `milestone` tables.
- Produces: `schema.cycleIssueMembership`, `schema.cycleIssueOutcome`, and final snapshot metadata.

- [ ] **Step 1: Write failing schema tests**

```ts
it('exports immutable sprint analytics facts', () => {
  expect(schema.cycleIssueMembership).toBeDefined();
  expect(schema.cycleIssueOutcome).toBeDefined();
  expect(schema.cycleProgressSnapshot.isFinal).toBeDefined();
  expect(schema.cycleProgressSnapshot.capturedAt).toBeDefined();
});
```

Add a database test that inserts two membership intervals for one issue and rejects a second outcome for the same cycle and issue.

- [ ] **Step 2: Run the database schema test and verify failure**

Run: `ORBIT_TEST_LANE=analytics-cockpit bun run --filter '@orbit/db' test`

Expected: FAIL because the new exports and columns are absent.

- [ ] **Step 3: Add the tables and indexes**

```ts
export const cycleIssueMembership = pgTable(
  'cycle_issue_membership',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
    teamId: text('team_id').notNull().references(() => team.id, { onDelete: 'cascade' }),
    cycleId: text('cycle_id').notNull().references(() => cycle.id, { onDelete: 'cascade' }),
    issueId: text('issue_id').notNull(),
    issueIdentifier: text('issue_identifier').notNull(),
    addedAt: timestamp('added_at', { withTimezone: true }).notNull(),
    removedAt: timestamp('removed_at', { withTimezone: true }),
    entryKind: text('entry_kind').notNull(),
    estimateAtAdd: integer('estimate_at_add'),
    assigneeIdAtAdd: text('assignee_id_at_add').references(() => user.id, { onDelete: 'set null' }),
    projectIdAtAdd: text('project_id_at_add').references(() => project.id, { onDelete: 'set null' }),
    milestoneIdAtAdd: text('milestone_id_at_add').references(() => milestone.id, { onDelete: 'set null' }),
    coverage: text('coverage').notNull().default('captured'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('cycle_issue_membership_cycle_added_idx').on(table.cycleId, table.addedAt),
    index('cycle_issue_membership_cycle_removed_idx').on(table.cycleId, table.removedAt),
    index('cycle_issue_membership_issue_added_idx').on(table.issueId, table.addedAt),
  ],
);
```

Define `cycleIssueOutcome` with unique `(cycleId, issueId)`, an `issueIdentifier` snapshot, close-time dimensions, estimate values, outcome, completion time, closed time, and optional rollover destination. Keep the durable issue identifier as data rather than a cascading foreign key so hard issue deletion does not erase sprint history. Add `capturedAt` and `isFinal` to `cycleProgressSnapshot`.

- [ ] **Step 4: Generate migration and verify schema drift**

Run: `bun run db:generate`

Run: `bun run db:check-drift`

Run: `ORBIT_TEST_LANE=analytics-cockpit bun run --filter '@orbit/db' test`

Expected: PASS with the next migration and metadata snapshot committed.

- [ ] **Step 5: Commit the schema**

```bash
git add packages/db/src/schema/work.ts packages/db/tests/schema/index.test.ts packages/db/drizzle
git commit -m "feat(analytics): add sprint history facts"
```

### Task 3: Capture sprint membership and close outcomes transactionally

**Files:**
- Create: `packages/core/src/analytics/membership.ts`
- Create: `packages/core/tests/analytics/membership.test.ts`
- Modify: `packages/core/src/work/issue-service.ts`
- Modify: `packages/core/src/work/cycle-service.ts`
- Modify: `packages/core/tests/work/issue-service.test.ts`
- Modify: `packages/core/tests/work/cycle-service.test.ts`

**Interfaces:**
- Consumes: Task 2 tables and existing Drizzle transaction executor.
- Produces: `captureCreatedCycleMembership`, `captureCycleMembershipChange`, `captureCycleCloseOutcomes`, and `bootstrapActiveCycleMemberships`.

- [ ] **Step 1: Write failing membership lifecycle tests**

```ts
it('records create, move, and rollover membership in mutation transactions', async () => {
  const created = await createIssue(member, { ...issueInput, cycleId: first.id });
  await updateIssue(member, created.issue.id, { cycleId: second.id });
  await completeCycle(admin, second.id, closeTime);

  const memberships = await db
    .select()
    .from(schema.cycleIssueMembership)
    .where(eq(schema.cycleIssueMembership.issueId, created.issue.id));

  expect(memberships.map((entry) => entry.cycleId)).toEqual([first.id, second.id, third.id]);
  expect(memberships[0]?.removedAt).not.toBeNull();
  expect(memberships[2]?.entryKind).toBe('rollover');
});
```

Add a close test that verifies completed, incomplete, canceled, removed, and carryover outcomes and captures close-time estimate and dimensions.

- [ ] **Step 2: Run the focused core tests and verify failure**

Run: `ORBIT_TEST_LANE=analytics-cockpit bun run --filter '@orbit/core' test`

Expected: FAIL because no membership capture exists.

- [ ] **Step 3: Implement focused transaction helpers**

```ts
export async function captureCycleMembershipChange(
  tx: Executor,
  input: {
    readonly issue: IssueRow;
    readonly fromCycleId: string | null;
    readonly toCycleId: string | null;
    readonly occurredAt: Date;
    readonly entryKind: 'added' | 'rollover';
  },
): Promise<void> {
  if (input.fromCycleId !== null) await closeOpenMembership(tx, input);
  if (input.toCycleId !== null) await openMembership(tx, input);
}
```

Call the helper after issue insertion, during ordinary and regrouped `cycleId` changes, cycle deletion unassignment, and automatic rollover. Write close outcomes before updating `cycle.completedAt`, all inside the existing transaction.

- [ ] **Step 4: Run core tests and inspect rollback behavior**

Run: `ORBIT_TEST_LANE=analytics-cockpit bun run --filter '@orbit/core' test`

Expected: PASS, including a test that forces a later transaction failure and observes no membership row.

- [ ] **Step 5: Commit membership capture**

```bash
git add packages/core/src/analytics/membership.ts packages/core/src/work/issue-service.ts packages/core/src/work/cycle-service.ts packages/core/tests/analytics/membership.test.ts packages/core/tests/work/issue-service.test.ts packages/core/tests/work/cycle-service.test.ts
git commit -m "feat(analytics): capture sprint membership"
```

### Task 4: Schedule timezone-correct daily and final sprint snapshots

**Files:**
- Modify: `packages/core/src/analytics/snapshot.ts`
- Modify: `packages/core/tests/analytics/snapshot.test.ts`
- Create: `apps/web/src/app/api/cron/analytics-snapshots/route.ts`
- Create: `apps/web/tests/app/api/cron/analytics-snapshots/route.test.ts`
- Modify: `apps/web/vercel.json`
- Modify: `.env.example`
- Modify: `docs/configuration.md`

**Interfaces:**
- Consumes: `writeCycleSnapshots`, realtime `publish`, `CRON_SECRET`, and Task 2 final metadata.
- Produces: `writeCycleSnapshots({ now, finalCycleId? })` and protected `GET /api/cron/analytics-snapshots`.

- [ ] **Step 1: Write failing local-date, final, and cron tests**

```ts
it('captures the cycle local calendar day idempotently', async () => {
  await writeCycleSnapshots({ now: new Date('2026-08-11T20:30:00.000Z') });
  await writeCycleSnapshots({ now: new Date('2026-08-11T21:00:00.000Z') });
  const rows = await rowsFor(cycle.id);
  expect(rows).toHaveLength(1);
  expect(rows[0]?.capturedOn).toBe('2026-08-12');
});
```

Route tests must cover missing secret, wrong secret, valid secret, published actions, and retry idempotence.

- [ ] **Step 2: Run snapshot and route tests and verify failure**

Run: `ORBIT_TEST_LANE=analytics-cockpit bun run --filter '@orbit/core' test`

Run: `ORBIT_TEST_LANE=analytics-cockpit bun run --filter '@orbit/web' test`

Expected: FAIL for UTC bucketing and the absent cron route.

- [ ] **Step 3: Implement local-day capture and cron route**

```ts
export async function GET(request: Request): Promise<Response> {
  return await handleRoute(async () => {
    const secret = process.env['CRON_SECRET'] ?? '';
    if (secret.length === 0) {
      return Response.json({ error: 'analytics snapshots are not configured' }, { status: 503 });
    }
    if (!matches(presented(request), secret)) {
      return Response.json({ error: 'unauthorized' }, { status: 401 });
    }
    const result = await writeCycleSnapshots({ now: new Date() });
    await publishDeltas(result.actions);
    return Response.json({ captured: result.captured });
  });
}
```

Use `Intl.DateTimeFormat` with `cycle.timezone` to derive `capturedOn`. Write the final row during cycle close before the cycle leaves the active set. Schedule the route in `apps/web/vercel.json` and document `CRON_SECRET`.

- [ ] **Step 4: Run focused tests and schema drift check**

Run: `ORBIT_TEST_LANE=analytics-cockpit bun run --filter '@orbit/core' test`

Run: `ORBIT_TEST_LANE=analytics-cockpit bun run --filter '@orbit/web' test`

Run: `bun run db:check-drift`

Expected: PASS.

- [ ] **Step 5: Commit snapshot scheduling**

```bash
git add packages/core/src/analytics/snapshot.ts packages/core/tests/analytics/snapshot.test.ts apps/web/src/app/api/cron/analytics-snapshots/route.ts apps/web/tests/app/api/cron/analytics-snapshots/route.test.ts apps/web/vercel.json .env.example docs/configuration.md
git commit -m "feat(analytics): schedule sprint snapshots"
```

### Task 5: Extract one issue predicate boundary for lists and analytics

**Files:**
- Create: `packages/core/src/work/issue-query.ts`
- Create: `packages/core/tests/work/issue-query.test.ts`
- Modify: `packages/core/src/work/issue-service.ts`
- Modify: `packages/core/src/work/issue-predicates.ts`

**Interfaces:**
- Consumes: existing advanced filter compiler and Task 1 `AnalyticsQuery`.
- Produces: `buildIssueWhere(principal, input)` with visibility `team` or `workspace-analytics`.

- [ ] **Step 1: Write failing visibility and predicate parity tests**

```ts
it('keeps ordinary lists team scoped and analytics workspace scoped', async () => {
  const listWhere = buildIssueWhere(member, { visibility: 'team', filter, now });
  const analyticsWhere = buildIssueWhere(member, {
    visibility: 'workspace-analytics',
    filter,
    now,
  });
  expect(await identifiersMatching(listWhere)).toEqual(['ENG-1']);
  expect(await identifiersMatching(analyticsWhere)).toEqual(['ENG-1', 'OPS-1']);
});
```

Add parity cases for labels, milestones, blocked relations, unset values, nested groups, archived work, and cross-organization rows.

- [ ] **Step 2: Run the focused core test and verify failure**

Run: `ORBIT_TEST_LANE=analytics-cockpit bun run --filter '@orbit/core' test`

Expected: FAIL because the shared boundary is absent.

- [ ] **Step 3: Extract without changing list semantics**

```ts
export interface IssueWhereInput {
  readonly visibility: 'team' | 'workspace-analytics';
  readonly filter: IssueFilterInput;
  readonly now: Date;
}

export function buildIssueWhere(
  principal: Principal,
  input: IssueWhereInput,
): SQL<unknown> {
  if (input.visibility === 'workspace-analytics') assertCan(principal, 'analytics:read');
  else assertCan(principal, 'issue:read');
  return and(organizationPredicate(principal), visibilityPredicate(principal, input), ...compiledFilters(input));
}
```

Move existing private composition into the new module and have issue list, facets, and analytics consumers call it.

- [ ] **Step 4: Run all core tests to prove no list regression**

Run: `ORBIT_TEST_LANE=analytics-cockpit bun run --filter '@orbit/core' test`

Expected: PASS with existing issue-list authorization tests unchanged.

- [ ] **Step 5: Commit the predicate boundary**

```bash
git add packages/core/src/work/issue-query.ts packages/core/src/work/issue-service.ts packages/core/src/work/issue-predicates.ts packages/core/tests/work/issue-query.test.ts
git commit -m "refactor(analytics): share issue predicates"
```

### Task 6: Resolve zero-configuration defaults and comparison windows

**Files:**
- Create: `packages/core/src/analytics/types.ts`
- Create: `packages/core/src/analytics/filter.ts`
- Create: `packages/core/tests/analytics/filter.test.ts`
- Modify: `packages/core/src/analytics/index.ts`

**Interfaces:**
- Consumes: Task 1 query and cycles available to the workspace.
- Produces: `AnalyticsCoverage`, `AnalyticsMetric`, `AnalyticsBucket`, `resolveAnalyticsQuery(query, context): ResolvedAnalyticsQuery`, and `bucketDates(range)`.

- [ ] **Step 1: Write failing pure resolution tests**

```ts
it('uses one active sprint and falls back to 30 days for overlapping teams', () => {
  expect(resolveAnalyticsQuery(defaultQuery, oneActiveContext).range).toEqual(activeRange);
  expect(resolveAnalyticsQuery(defaultQuery, twoActiveContext).range).toEqual(last30Days);
});

it('uses the previous equal period and caps plotted buckets', () => {
  const resolved = resolveAnalyticsQuery(last90Query, context);
  expect(resolved.comparisonRange).toEqual(previous90Days);
  expect(bucketDates(resolved.range, resolved.bucket).length).toBeLessThanOrEqual(120);
});
```

- [ ] **Step 2: Run the filter test and verify failure**

Run: `ORBIT_TEST_LANE=analytics-cockpit bun run --filter '@orbit/core' test`

Expected: FAIL because the resolver is absent.

- [ ] **Step 3: Implement deterministic range resolution**

```ts
export interface ResolvedAnalyticsQuery extends AnalyticsQuery {
  readonly from: Date;
  readonly to: Date;
  readonly comparisonFrom: Date | null;
  readonly comparisonTo: Date | null;
  readonly bucket: 'day' | 'week' | 'month';
  readonly timezone: string;
}

export interface AnalyticsCoverage {
  readonly kind: 'live' | 'observed' | 'reconstructed' | 'frozen';
  readonly from: string | null;
  readonly asOf: string;
}

export interface AnalyticsMetric {
  readonly id: string;
  readonly label: string;
  readonly value: number;
  readonly unit: 'issues' | 'points' | 'days' | 'percent';
  readonly comparisonDelta: number | null;
  readonly cohort: AnalyticsDrilldownCohort;
}
```

Use day buckets through 45 days, week buckets through 15 months, and month buckets above that. Resolve all date boundaries in the chosen reporting timezone and emit the concrete UTC instants.

- [ ] **Step 4: Run tests and typecheck**

Run: `ORBIT_TEST_LANE=analytics-cockpit bun run --filter '@orbit/core' test`

Run: `bun run --filter '@orbit/core' typecheck`

Expected: PASS.

- [ ] **Step 5: Commit the resolver**

```bash
git add packages/core/src/analytics/types.ts packages/core/src/analytics/filter.ts packages/core/src/analytics/index.ts packages/core/tests/analytics/filter.test.ts
git commit -m "feat(analytics): resolve planning windows"
```

### Task 7: Build the overview service and semantic drilldown foundation

**Files:**
- Create: `packages/core/src/analytics/overview.ts`
- Create: `packages/core/src/analytics/drilldown.ts`
- Create: `packages/core/tests/analytics/overview.test.ts`
- Create: `packages/core/tests/analytics/drilldown.test.ts`
- Modify: `packages/core/src/analytics/index.ts`

**Interfaces:**
- Consumes: Tasks 5 and 6.
- Produces: `loadAnalyticsOverview(principal, query)`, `listAnalyticsDrilldown(principal, input)`, `AnalyticsOverview`, and semantic cohort keys.

- [ ] **Step 1: Write failing reconciliation tests**

```ts
it('reconciles every overview card with its drilldown', async () => {
  const overview = await loadAnalyticsOverview(member, query);
  for (const card of overview.cards) {
    const rows = await listAnalyticsDrilldown(member, {
      query,
      cohort: card.cohort,
      limit: 100,
    });
    expect(rows.total).toBe(card.value);
  }
});
```

Add tests for current WIP, blocked, overdue, stale, unestimated, throughput, cycle-time p50/p85, date comparison, points, and cross-organization isolation.

- [ ] **Step 2: Run overview tests and verify failure**

Run: `ORBIT_TEST_LANE=analytics-cockpit bun run --filter '@orbit/core' test`

Expected: FAIL because the services are absent.

- [ ] **Step 3: Implement one bounded aggregate service**

```ts
export interface AnalyticsOverview {
  readonly asOf: string;
  readonly coverage: AnalyticsCoverage;
  readonly cards: readonly AnalyticsMetric[];
  readonly delivery: readonly DeliveryPoint[];
  readonly state: readonly AnalyticsBucket[];
  readonly projects: readonly AnalyticsBucket[];
  readonly priorities: readonly AnalyticsBucket[];
  readonly outliers: readonly FlowOutlier[];
}
```

Build current-state and interval CTEs from one normalized issue predicate. Keep raw issue rows out of the overview payload. Implement keyset pagination in drilldown and reuse the exact cohort predicates.

- [ ] **Step 4: Run tests and inspect the query plan**

Run: `ORBIT_TEST_LANE=analytics-cockpit bun run --filter '@orbit/core' test`

Run the representative overview SQL through `EXPLAIN (ANALYZE, BUFFERS)` using the local seeded workspace and record the plan summary in the pull request notes.

Expected: PASS, bounded bucket count, and no unbounded issue-row response.

- [ ] **Step 5: Commit overview and drilldown**

```bash
git add packages/core/src/analytics/overview.ts packages/core/src/analytics/drilldown.ts packages/core/src/analytics/index.ts packages/core/tests/analytics/overview.test.ts packages/core/tests/analytics/drilldown.test.ts
git commit -m "feat(analytics): add workspace overview"
```

### Task 8: Build trustworthy sprint analytics and previous burn

**Files:**
- Create: `packages/core/src/analytics/sprints.ts`
- Create: `packages/core/tests/analytics/sprints.test.ts`
- Modify: `packages/core/src/analytics/burndown.ts`
- Modify: `packages/core/src/analytics/index.ts`

**Interfaces:**
- Consumes: membership intervals, frozen outcomes, daily snapshots, and resolved query.
- Produces: `loadSprintAnalytics(principal, query)` and sprint cohorts for planned, added, removed, completed, incomplete, and carryover.

- [ ] **Step 1: Write failing sprint truth tests**

```ts
it('keeps removed work in history and aligns previous burn by working day', async () => {
  const result = await loadSprintAnalytics(member, sprintQuery);
  expect(result.current.scopeChanges).toMatchObject({ added: 2, removed: 1 });
  expect(result.current.burn.map((point) => point.scope)).toEqual([8, 10, 9]);
  expect(result.previous?.burn[0]?.workingDay).toBe(1);
});

it('returns an honest first-sprint state', async () => {
  const result = await loadSprintAnalytics(member, firstSprintQuery);
  expect(result.previous).toBeNull();
  expect(result.coverage.kind).toBe('observed');
});
```

Cover the 24-hour planned rule, same-day add/remove, re-addition, mixed estimates, rollover, frozen versus reconstructed results, and cycle timezone.

- [ ] **Step 2: Run sprint tests and verify failure**

Run: `ORBIT_TEST_LANE=analytics-cockpit bun run --filter '@orbit/core' test`

Expected: FAIL against current-membership burndown behavior.

- [ ] **Step 3: Implement the sprint service from immutable facts**

```ts
export interface SprintAnalytics {
  readonly selected: SprintSummary;
  readonly current: SprintDetail;
  readonly previous: SprintDetail | null;
  readonly velocity: readonly VelocityPoint[];
  readonly flow: FlowDistributions;
  readonly coverage: AnalyticsCoverage;
}
```

Use membership intervals for scope and churn, snapshots for daily state, close outcomes for completed sprint summaries, and current issue state only for live open work. Do not call current scope `planned` without captured facts.

- [ ] **Step 4: Run core tests and compare old fixture output**

Run: `ORBIT_TEST_LANE=analytics-cockpit bun run --filter '@orbit/core' test`

Expected: PASS. Existing analytics tests either keep their explicit legacy semantics or migrate to the new service with renamed assertions.

- [ ] **Step 5: Commit sprint analytics**

```bash
git add packages/core/src/analytics/sprints.ts packages/core/src/analytics/burndown.ts packages/core/src/analytics/index.ts packages/core/tests/analytics/sprints.test.ts packages/core/tests/analytics/burndown.test.ts
git commit -m "feat(analytics): add sprint comparisons"
```

### Task 9: Build project and milestone portfolio analytics

**Files:**
- Create: `packages/core/src/analytics/projects.ts`
- Create: `packages/core/tests/analytics/projects.test.ts`
- Modify: `packages/core/src/analytics/index.ts`

**Interfaces:**
- Consumes: normalized query, project and milestone tables, shared issue predicates.
- Produces: `loadProjectAnalytics(principal, query)` and project risk cohorts.

- [ ] **Step 1: Write failing portfolio and detail tests**

```ts
it('summarizes portfolio risk and focused project evidence', async () => {
  const portfolio = await loadProjectAnalytics(member, query);
  expect(portfolio.projects[0]).toMatchObject({
    health: 'at_risk',
    blocked: 1,
    overdue: 2,
    nextMilestoneName: 'Beta',
  });
  expect(portfolio.focused?.delivery.length).toBeGreaterThan(0);
});
```

Cover multi-team projects, milestone filtering, target dates, empty milestones, scope change, archived projects, and mixed estimate scales.

- [ ] **Step 2: Run the project test and verify failure**

Run: `ORBIT_TEST_LANE=analytics-cockpit bun run --filter '@orbit/core' test`

Expected: FAIL because the service is absent.

- [ ] **Step 3: Implement bounded portfolio and focus queries**

```ts
export interface ProjectAnalytics {
  readonly asOf: string;
  readonly projects: readonly ProjectAnalyticsRow[];
  readonly focused: ProjectAnalyticsDetail | null;
  readonly coverage: AnalyticsCoverage;
}
```

Return stable sort keys and semantic cohorts rather than raw issue rows. Keep project health as a manual signal and name computed counts directly.

- [ ] **Step 4: Run tests and inspect portfolio SQL**

Run: `ORBIT_TEST_LANE=analytics-cockpit bun run --filter '@orbit/core' test`

Expected: PASS with a bounded portfolio and focused-series payload.

- [ ] **Step 5: Commit project analytics**

```bash
git add packages/core/src/analytics/projects.ts packages/core/src/analytics/index.ts packages/core/tests/analytics/projects.test.ts
git commit -m "feat(analytics): add project portfolio"
```

### Task 10: Build person workload and delivery analytics

**Files:**
- Create: `packages/core/src/analytics/people.ts`
- Create: `packages/core/tests/analytics/people.test.ts`
- Modify: `packages/core/src/analytics/index.ts`

**Interfaces:**
- Consumes: normalized query, membership/activity facts, workspace members, and shared issue predicates.
- Produces: `loadPeopleAnalytics(principal, query)` and person assignment/completion cohorts.

- [ ] **Step 1: Write failing workspace-wide person tests**

```ts
it('lets a guest inspect a person outside their teams without crossing organizations', async () => {
  const result = await loadPeopleAnalytics(guest, { ...query, focus: { personId: engineer.id } });
  expect(result.focused?.person.id).toBe(engineer.id);
  expect(result.focused?.currentAssignments).toBe(3);
  const otherResult = await loadPeopleAnalytics(otherOrgGuest, query);
  expect(otherResult.people.some((person) => person.id === engineer.id)).toBe(false);
});
```

Cover current assignments, completed range, active-week average, median/p85, WIP age, blocked, overdue, stale, unestimated, all-time range, former members, and incomplete historical attribution.

- [ ] **Step 2: Run people tests and verify failure**

Run: `ORBIT_TEST_LANE=analytics-cockpit bun run --filter '@orbit/core' test`

Expected: FAIL because the service is absent.

- [ ] **Step 3: Implement neutral workload analytics**

```ts
export interface PeopleAnalytics {
  readonly asOf: string;
  readonly people: readonly PersonAnalyticsRow[];
  readonly focused: PersonAnalyticsDetail | null;
  readonly coverage: AnalyticsCoverage;
}
```

Sort the cross-person table by normalized display name unless the user explicitly changes sort. Expose no composite score. Label historical completion attribution as captured or current-assignee based on coverage.

- [ ] **Step 4: Run tests and policy regression suite**

Run: `ORBIT_TEST_LANE=analytics-cockpit bun run --filter '@orbit/core' test`

Run: `bun run --filter '@orbit/shared' test`

Expected: PASS.

- [ ] **Step 5: Commit people analytics**

```bash
git add packages/core/src/analytics/people.ts packages/core/src/analytics/index.ts packages/core/tests/analytics/people.test.ts
git commit -m "feat(analytics): add people insights"
```

### Task 11: Add lens routes, response contracts, query keys, and hydrated defaults

**Files:**
- Create: `apps/web/src/features/analytics/contracts.ts`
- Create: `apps/web/src/features/analytics/query-state.ts`
- Create: `apps/web/src/features/analytics/use-analytics-query.ts`
- Create: `apps/web/src/app/api/analytics/overview/route.ts`
- Create: `apps/web/src/app/api/analytics/sprints/route.ts`
- Create: `apps/web/src/app/api/analytics/projects/route.ts`
- Create: `apps/web/src/app/api/analytics/people/route.ts`
- Create: `apps/web/src/app/api/analytics/drilldown/route.ts`
- Create: route tests under `apps/web/tests/app/api/analytics/`
- Modify: `apps/web/src/lib/query/keys.ts`
- Modify: `apps/web/src/app/(app)/analytics/page.tsx`

**Interfaces:**
- Consumes: Tasks 7 through 10 and existing `apiFetch`, `handle`, QueryClient, and HydrationBoundary patterns.
- Produces: `analyticsKeys`, `parseAnalyticsSearchParams`, `searchParamsForAnalytics`, and one typed route per lens.

- [ ] **Step 1: Write failing route and URL-state tests**

```ts
it('omits defaults and round trips advanced state', () => {
  expect(searchParamsForAnalytics(defaultAnalyticsQuery).toString()).toBe('');
  const encoded = searchParamsForAnalytics(projectPersonQuery);
  expect(parseAnalyticsSearchParams(encoded)).toEqual(projectPersonQuery);
});

it('serves a workspace-wide overview with strict organization isolation', async () => {
  const response = await GET(authenticatedRequest('/api/analytics/overview'));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ lens: 'overview' });
});
```

- [ ] **Step 2: Run web tests and verify failure**

Run: `ORBIT_TEST_LANE=analytics-cockpit bun run --filter '@orbit/web' test`

Expected: FAIL because the contracts and routes are absent.

- [ ] **Step 3: Implement thin routes and hydrated server default**

```ts
export const analyticsKeys = {
  all: ['analytics'] as const,
  lens: (lens: AnalyticsLens, query: AnalyticsQuery) =>
    [...analyticsKeys.all, lens, canonicalAnalyticsQuery(query)] as const,
  drilldown: (input: AnalyticsDrilldownQuery) =>
    [...analyticsKeys.all, 'drilldown', canonicalDrilldownQuery(input)] as const,
};
```

Server-render `/analytics` by resolving the clean-URL default, loading only its active lens, schema-parsing the JSON-safe payload, setting the matching query data, and rendering a HydrationBoundary.

- [ ] **Step 4: Run route, type, and build-focused checks**

Run: `ORBIT_TEST_LANE=analytics-cockpit bun run --filter '@orbit/web' test`

Run: `bun run --filter '@orbit/web' typecheck`

Expected: PASS.

- [ ] **Step 5: Commit web data plumbing**

```bash
git add apps/web/src/features/analytics/contracts.ts apps/web/src/features/analytics/query-state.ts apps/web/src/features/analytics/use-analytics-query.ts apps/web/src/app/api/analytics apps/web/tests/app/api/analytics apps/web/src/lib/query/keys.ts apps/web/src/app/\(app\)/analytics/page.tsx
git commit -m "feat(analytics): add lens data routes"
```

### Task 12: Build the zero-configuration cockpit shell and progressive toolbar

**Files:**
- Create: `apps/web/src/features/analytics/analytics-cockpit.tsx`
- Create: `apps/web/src/features/analytics/analytics-toolbar.tsx`
- Create: `apps/web/src/features/analytics/analytics-tabs.tsx`
- Create: `apps/web/src/features/analytics/date-range-picker.tsx`
- Create: component tests under `apps/web/tests/features/analytics/`
- Modify: `apps/web/src/features/analytics/analytics-skeleton.tsx`
- Modify: `apps/web/src/app/(app)/analytics/loading.tsx`

**Interfaces:**
- Consumes: Task 11 URL/query hook and existing Button, Popover, cmdk filter menu, Tooltip, Select, and skeleton primitives.
- Produces: `AnalyticsCockpit` and accessible lens/date/filter controls.

- [ ] **Step 1: Write failing default, tabs, date, and responsive tests**

```tsx
it('renders useful defaults without configuration', async () => {
  renderAnalytics();
  expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('button', { name: /Active sprint|Last 30 days/ })).toBeVisible();
  expect(screen.queryByText('Choose a dataset')).not.toBeInTheDocument();
});

it('moves between tabs with arrow keys and writes the URL', async () => {
  await user.click(screen.getByRole('tab', { name: 'Overview' }));
  await user.keyboard('{ArrowRight}');
  expect(screen.getByRole('tab', { name: 'Sprints' })).toHaveFocus();
});
```

Test Home, End, custom range validation, clear/reset, collapsed advanced filters, and narrow layouts.

- [ ] **Step 2: Run component tests and verify failure**

Run: `bun run --filter '@orbit/web' test`

Expected: FAIL because the cockpit components are absent.

- [ ] **Step 3: Implement semantic tabs and progressive controls**

```tsx
<div role="tablist" aria-label="Analytics views">
  {ANALYTICS_LENSES.map((lens, index) => (
    <button
      key={lens}
      role="tab"
      aria-selected={query.lens === lens}
      tabIndex={query.lens === lens ? 0 : -1}
      onKeyDown={(event) => moveTabFocus(event, index)}
      onClick={() => update({ lens })}
    >
      {ANALYTICS_LENS_LABELS[lens]}
    </button>
  ))}
</div>
```

Use existing filter chips and cmdk menus, but keep only date, comparison, measure, and Add filter visible by default. Use two labeled native date inputs inside the custom-range popover unless an accessible repository-native calendar is added in this same task.

- [ ] **Step 4: Run component tests, lint, and typecheck**

Run: `bun run --filter '@orbit/web' test`

Run: `bun run lint`

Run: `bun run --filter '@orbit/web' typecheck`

Expected: PASS.

- [ ] **Step 5: Commit the cockpit shell**

```bash
git add apps/web/src/features/analytics/analytics-cockpit.tsx apps/web/src/features/analytics/analytics-toolbar.tsx apps/web/src/features/analytics/analytics-tabs.tsx apps/web/src/features/analytics/date-range-picker.tsx apps/web/src/features/analytics/analytics-skeleton.tsx apps/web/src/app/\(app\)/analytics/loading.tsx apps/web/tests/features/analytics
git commit -m "feat(analytics): add planning cockpit shell"
```

### Task 13: Add accessible interactive charts and evidence drilldown

**Files:**
- Create: `apps/web/src/features/analytics/charts/plot-frame.tsx`
- Create: `apps/web/src/features/analytics/charts/line-plot.tsx`
- Create: `apps/web/src/features/analytics/charts/bar-plot.tsx`
- Create: `apps/web/src/features/analytics/charts/chart-tooltip.tsx`
- Create: `apps/web/src/features/analytics/charts/analytics-data-table.tsx`
- Create: `apps/web/src/features/analytics/analytics-drilldown-dialog.tsx`
- Create: chart and dialog tests under `apps/web/tests/features/analytics/`
- Modify: `apps/web/src/features/charts/geometry.ts`

**Interfaces:**
- Consumes: existing chart geometry, Dialog, Tooltip, ScrollArea, issue rows, and Task 11 drilldown query.
- Produces: focus-managed chart primitives with `onActivate(cohort)` and linked tables.

- [ ] **Step 1: Write failing hover, keyboard, table-link, and dialog tests**

```tsx
it('exposes the same datapoint to pointer and keyboard users', async () => {
  render(<LinePlot series={series} onActivate={activate} />);
  await user.hover(screen.getByTestId('plot-hit-2026-08-11-completed'));
  expect(screen.getByRole('tooltip')).toHaveTextContent('Completed 7');
  screen.getByRole('application', { name: 'Delivery trend' }).focus();
  await user.keyboard('{ArrowRight}{Enter}');
  expect(activate).toHaveBeenCalledWith({ cohort: 'completed', bucket: '2026-08-11' });
});
```

Add tests for Up/Down series movement, Home/End, Escape, reduced motion, non-color series labels, table cross-highlighting, focus restoration, mobile dialog mode, pagination, and export parity.

- [ ] **Step 2: Run chart tests and verify failure**

Run: `bun run --filter '@orbit/web' test`

Expected: FAIL because the interactive primitives are absent.

- [ ] **Step 3: Implement one chart focus surface and semantic cohorts**

```tsx
<svg
  role="application"
  aria-label={label}
  tabIndex={0}
  onKeyDown={handleChartKeyDown}
  onPointerMove={handlePointerMove}
  onPointerLeave={clearActivePoint}
>
  <title>{label}</title>
  <PlotSeries activePoint={activePoint} />
  <PlotCrosshair activePoint={activePoint} />
</svg>
```

Do not make every dense point a tab stop. Maintain one active point, announce it through an aria-live region, and send the same semantic cohort to the dialog and table.

- [ ] **Step 4: Run tests and inspect accessibility tree manually**

Run: `bun run --filter '@orbit/web' test`

Run: `bun run --filter '@orbit/web' typecheck`

Expected: PASS with pointer and keyboard parity.

- [ ] **Step 5: Commit chart interactions**

```bash
git add apps/web/src/features/analytics/charts apps/web/src/features/analytics/analytics-drilldown-dialog.tsx apps/web/src/features/charts/geometry.ts apps/web/tests/features/analytics
git commit -m "feat(analytics): add interactive evidence charts"
```

### Task 14: Build Overview and Sprints lenses

**Files:**
- Create: `apps/web/src/features/analytics/overview-lens.tsx`
- Create: `apps/web/src/features/analytics/sprint-lens.tsx`
- Create: tests under `apps/web/tests/features/analytics/overview-lens.test.tsx` and `sprint-lens.test.tsx`
- Modify: `apps/web/src/features/analytics/analytics-cockpit.tsx`
- Remove or migrate replaced current analytics scope, cycle, burndown, and distribution components after parity is proven.

**Interfaces:**
- Consumes: Tasks 7, 8, 11, 12, and 13.
- Produces: complete default workspace and sprint planning surfaces.

- [ ] **Step 1: Write failing lens behavior tests**

```tsx
it('opens overview metrics and chart cohorts in evidence', async () => {
  renderOverview(overviewFixture);
  await user.click(screen.getByRole('button', { name: /Blocked work 3/ }));
  expect(screen.getByRole('dialog', { name: 'Blocked work' })).toBeVisible();
});

it('shows first-sprint guidance instead of fake velocity', () => {
  renderSprint(firstSprintFixture);
  expect(screen.getByText(/comparison will appear after this sprint closes/i)).toBeVisible();
  expect(screen.queryByText('Sprint 2')).not.toBeInTheDocument();
});
```

Cover burnup/burndown toggle, previous overlay, metric formulas, coverage, points warnings, exact hover values, and issue/table activation.

- [ ] **Step 2: Run the lens tests and verify failure**

Run: `bun run --filter '@orbit/web' test`

Expected: FAIL because the lenses are absent.

- [ ] **Step 3: Implement lens layouts with shared primitives**

```tsx
export function OverviewLens({ data, query }: OverviewLensProps) {
  return (
    <div className="space-y-4">
      <MetricStrip metrics={data.cards} onActivate={openCohort} />
      <AnalyticsCard title="Delivery trend" freshness={data.asOf}>
        <LinePlot series={deliverySeries(data.delivery)} onActivate={openCohort} />
      </AnalyticsCard>
      <OverviewSupportingGrid data={data} onActivate={openCohort} />
    </div>
  );
}
```

Use `EmptyState` for first-sprint and no-match states. Remove manual checkpoint prominence because automatic snapshots now provide history.

- [ ] **Step 4: Run web tests, typecheck, and screenshots against fixtures**

Run: `bun run --filter '@orbit/web' test`

Run: `bun run --filter '@orbit/web' typecheck`

Expected: PASS in light and dark component render checks.

- [ ] **Step 5: Commit Overview and Sprints**

```bash
git add apps/web/src/features/analytics/overview-lens.tsx apps/web/src/features/analytics/sprint-lens.tsx apps/web/src/features/analytics/analytics-cockpit.tsx apps/web/tests/features/analytics apps/web/src/features/analytics
git commit -m "feat(analytics): add overview and sprint lenses"
```

### Task 15: Build Projects and People lenses

**Files:**
- Create: `apps/web/src/features/analytics/projects-lens.tsx`
- Create: `apps/web/src/features/analytics/people-lens.tsx`
- Create: tests under `apps/web/tests/features/analytics/projects-lens.test.tsx` and `people-lens.test.tsx`
- Modify: `apps/web/src/features/analytics/analytics-cockpit.tsx`

**Interfaces:**
- Consumes: Tasks 9 through 13, project health chip, avatars, issue glyphs, and virtualizer.
- Produces: portfolio, project focus, cross-person workload, and person detail surfaces.

- [ ] **Step 1: Write failing portfolio and person interaction tests**

```tsx
it('focuses a project without leaving analytics', async () => {
  renderProjects(projectFixture);
  await user.click(screen.getByRole('button', { name: /Platform migration/ }));
  expect(screen.getByHeading('Platform migration')).toBeVisible();
  expect(currentUrl()).toContain('projectId=project-platform');
});

it('shows assignments and averages without a productivity score', () => {
  renderPeople(peopleFixture);
  expect(screen.getByText('Average throughput')).toBeVisible();
  expect(screen.getByText('Current assignments')).toBeVisible();
  expect(screen.queryByText(/productivity score/i)).not.toBeInTheDocument();
});
```

Cover milestone narrowing, risk sort, target marker, person selection, all-time range, neutral name sort, former member display, mixed estimates, and incomplete attribution copy.

- [ ] **Step 2: Run the lens tests and verify failure**

Run: `bun run --filter '@orbit/web' test`

Expected: FAIL because the lenses are absent.

- [ ] **Step 3: Implement portfolio and workload surfaces**

```tsx
<AnalyticsDataTable
  ariaLabel="Project portfolio"
  columns={projectColumns}
  rows={data.projects}
  sort={sort}
  onSortChange={setSort}
  onActivate={(project) => updateFocus({ projectId: project.id })}
/>
```

Use TanStack Virtual only when the returned row count exceeds the static threshold established in the component test. Keep all aggregate-to-evidence activation semantic.

- [ ] **Step 4: Run web tests and accessibility checks**

Run: `bun run --filter '@orbit/web' test`

Run: `bun run --filter '@orbit/web' typecheck`

Expected: PASS.

- [ ] **Step 5: Commit Projects and People**

```bash
git add apps/web/src/features/analytics/projects-lens.tsx apps/web/src/features/analytics/people-lens.tsx apps/web/src/features/analytics/analytics-cockpit.tsx apps/web/tests/features/analytics
git commit -m "feat(analytics): add project and people lenses"
```

### Task 16: Complete saved views, exports, and realtime freshness

**Files:**
- Modify: `packages/core/src/analytics/saved-view.ts`
- Modify: `packages/core/tests/analytics/saved-view.test.ts`
- Modify: `apps/web/src/features/analytics/saved-view-bar.tsx`
- Modify: `apps/web/src/app/api/analytics/views/route.ts`
- Modify: `apps/web/src/app/api/analytics/views/[id]/route.ts`
- Modify: `apps/web/src/app/api/analytics/export/route.ts`
- Modify: `apps/web/tests/features/analytics/csv.test.ts`
- Create: `apps/web/tests/app/api/analytics/export/route.test.ts`
- Modify: `apps/web/src/lib/realtime/delta-bridge.tsx`
- Modify: `apps/web/tests/lib/realtime/delta-bridge.test.tsx`

**Interfaces:**
- Consumes: full Task 1 config, Task 11 query keys, and semantic drilldowns.
- Produces: versioned full saved views, pinned personal default, exact cohort CSV, and realtime aggregate invalidation.

- [ ] **Step 1: Write failing persistence, export, and invalidation tests**

```ts
it('restores the complete saved analytics configuration', async () => {
  const saved = await createSavedAnalyticsView(member, { name: 'Launch risk', config: fullQuery });
  expect(saved.config).toEqual(fullQuery);
});

it('coalesces relevant sync actions into one analytics invalidation', async () => {
  emitSyncActions([{ model: 'issue' }, { model: 'project' }, { model: 'label' }]);
  await flushDeltas();
  expect(invalidateQueries).toHaveBeenCalledTimes(1);
  expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['analytics'] });
});
```

Cover legacy config migration, personal/shared mutation rules, pinning, owner-tab issue mutation invalidation, unrelated events, reconnect, truncated catchup, export row ceiling, and formula-injection defense.

- [ ] **Step 2: Run focused core and web tests and verify failure**

Run: `ORBIT_TEST_LANE=analytics-cockpit bun run --filter '@orbit/core' test`

Run: `ORBIT_TEST_LANE=analytics-cockpit bun run --filter '@orbit/web' test`

Expected: FAIL because saved views still restore only measure and analytics has no canonical realtime root.

- [ ] **Step 3: Implement full persistence and invalidation**

```ts
const ANALYTICS_MODELS = new Set([
  'issue',
  'cycle',
  'project',
  'milestone',
  'workflow_state',
  'label',
  'member',
  'team',
  'saved_analytics_view',
]);
```

Parse legacy saved configs into version 1 defaults. Export from the same semantic drilldown service and include filter, formula, timezone, and coverage metadata. Invalidate `analyticsKeys.all` once per realtime burst and explicitly invalidate after same-tab mutations.

- [ ] **Step 4: Run persistence, route, and realtime tests**

Run: `ORBIT_TEST_LANE=analytics-cockpit bun run --filter '@orbit/core' test`

Run: `ORBIT_TEST_LANE=analytics-cockpit bun run --filter '@orbit/web' test`

Expected: PASS.

- [ ] **Step 5: Commit saved views and freshness**

```bash
git add packages/core/src/analytics/saved-view.ts packages/core/tests/analytics/saved-view.test.ts apps/web/src/features/analytics/saved-view-bar.tsx apps/web/src/app/api/analytics/views apps/web/src/app/api/analytics/export/route.ts apps/web/tests/app/api/analytics/export apps/web/tests/features/analytics/csv.test.ts apps/web/src/lib/realtime/delta-bridge.tsx apps/web/tests/lib/realtime/delta-bridge.test.tsx
git commit -m "feat(analytics): persist and refresh insights"
```

### Task 17: Complete browser verification, performance evidence, screenshots, and cleanup

**Files:**
- Create: `apps/web/e2e/analytics.spec.ts`
- Modify: `apps/web/scripts/capture-screenshots.ts`
- Modify or remove: replaced files under `apps/web/src/features/analytics/`
- Modify: `.github/PULL_REQUEST_TEMPLATE.md` only if the existing template cannot describe before and after analytics evidence without a repository change.

**Interfaces:**
- Consumes: all prior tasks.
- Produces: verified production build, complete browser evidence, screenshots, and a review-ready branch.

- [ ] **Step 1: Write the failing end-to-end scenarios**

```ts
test('analytics is useful by default and supports a full investigation', async ({ page }) => {
  await page.goto('/analytics');
  await expect(page.getByRole('heading', { name: 'Analytics' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: 'Sprints' }).click();
  await page.getByRole('application', { name: 'Sprint burn' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tooltip')).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
});
```

Add scenarios for project, person, custom date, reload/share URL, saved default, first-sprint empty comparison, points warning, keyboard parity, light theme, dark theme, and realtime update.

- [ ] **Step 2: Run E2E against an isolated database and verify any missing behavior**

Start the worktree server on dedicated ports with a dedicated E2E database. Then run: `bun run --filter '@orbit/web' test:e2e -- analytics.spec.ts`

Expected: initial failures identify only integration gaps in the completed feature, not shared development database mutations.

- [ ] **Step 3: Close integration gaps and remove superseded analytics code**

Delete old components and endpoints only after `rg` proves no imports remain. Keep reusable chart geometry and CSV defense. Update skeletons and screenshot actions to capture default, hover, and advanced-filter states in both themes.

```ts
{
  name: 'analytics-hover',
  path: '/analytics',
  caption: 'Analytics tooltip',
  act: async (page) => {
    await page.getByRole('application', { name: 'Delivery trend' }).hover();
  },
}
```

- [ ] **Step 4: Run the complete verification matrix**

Run: `ORBIT_TEST_LANE=analytics-cockpit bun run verify`

Run: `bun run db:check-drift`

Run: `bun run build`

Run: `bun run --filter '@orbit/web' test:e2e -- analytics.spec.ts`

Run: `bun run screenshots`

Inspect the default lens SQL with `EXPLAIN (ANALYZE, BUFFERS)`, confirm the initial payload is below 150 KB, confirm no plotted series exceeds 120 buckets, and review Web Vitals for `/analytics` after repeated navigation.

Expected: every command exits 0, both themes are readable, no comment or em-dash policy violation exists, and screenshots show default, hover, and advanced filter states.

- [ ] **Step 5: Commit final verification assets and cleanup**

```bash
git add apps/web/e2e/analytics.spec.ts apps/web/scripts/capture-screenshots.ts apps/web/src/features/analytics apps/web/src/app/api/analytics docs/assets/screenshots
git commit -m "test(analytics): verify planning cockpit"
```

- [ ] **Step 6: Review, update from main, push, and open the pull request**

Run: `git status --short`

Run: `git diff --check origin/main...HEAD`

Run: `git log --oneline origin/main..HEAD`

Merge the latest `origin/main` into the branch, resolve conflicts without discarding user changes, rerun Step 4, push `codex/analytics-planning-insights`, and open a pull request into `main`. The pull request includes design and implementation links, schema rollout behavior, data coverage limitations, test commands, query-plan evidence, before and after images, and light and dark screenshots.

Expected: the remote branch and pull request exist, CI starts, and the branch remains unmerged for user review.

---

## Coverage map

| Design requirement | Implemented by |
| --- | --- |
| Zero-configuration daily return | Tasks 6, 11, 12, 14 |
| Linear-style progressive filters | Tasks 1, 5, 11, 12 |
| Date presets and custom dates | Tasks 1, 6, 12 |
| Hover, focus, exact values, and linked table | Task 13 |
| Evidence drilldown and CSV parity | Tasks 7, 11, 13, 16 |
| Previous burn and sprint comparison | Tasks 2, 3, 4, 8, 14 |
| Project and milestone planning | Tasks 9 and 15 |
| Person assignments and averages | Tasks 10 and 15 |
| Workspace-wide analytics policy | Tasks 1, 5, 7 through 11 |
| Saved and pinned deep investigations | Tasks 11, 12, 16 |
| Realtime freshness | Task 16 |
| Honest coverage and first-sprint state | Tasks 3, 8, 14 |
| Performance and bounded payloads | Tasks 6 through 11 and 17 |
| Responsive light and dark UI | Tasks 12 through 15 and 17 |
| Full verification and PR | Task 17 |

# Sprint workstream A: roll up and sprint page shell

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the eight stacked sprint panels on `/sprints` with one row per team that drills into a tabbed, team scoped sprint page whose name, dates and duration are editable in place.

**Architecture:** `/sprints` becomes a thin server page backed by a single grouped aggregate query, `listSprintRollUp`, instead of one full `getActiveCycleView` per team. The sprint itself moves under `/team/[key]/sprint/*` as a header plus tab shell. Later workstreams fill the tabs; this one delivers the Board tab pointing at today's existing list so the page is usable the moment it lands.

**Tech Stack:** Next.js 16 App Router, React 19, Drizzle over postgres.js, TanStack Query, Zod, Tailwind with CSS custom properties, `bun test`.

**Source spec:** `docs/superpowers/specs/2026-08-10-sprint-planning-redesign-design.md`

## Global Constraints

- Bun is the package manager and script runner. Every command starts with `bun`. Never `npm`, `pnpm`, `yarn`.
- Shipped server code must not import a Bun built-in. Test files may.
- No comments in code, ever. `bun run check-comments` fails the build on any comment that is not a functional directive.
- No em-dash characters in code, copy, docs or commit messages.
- `any` is a lint error. Non-null assertions are a lint error. `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` are on.
- Every external input is validated with a Zod schema from `@orbit/shared`.
- Tests live in each package's own `tests/` tree mirroring `src/`, never beside the code.
- No layout animation. Nothing that triggers reflow may animate. Transitions come from the tokens in `apps/web/src/lib/interaction.ts`.
- Never hardcode a hex value in a component. Theming is CSS custom properties.
- Run `bun run verify` before the final commit of each task group.
- Never mention AI tooling in commits, branches, PRs, code or docs.

## File structure

| File | Responsibility |
| --- | --- |
| `packages/core/src/work/cycle-roll-up.ts` | Create. One grouped aggregate over active cycles across teams. |
| `packages/core/tests/work/cycle-roll-up.test.ts` | Create. Aggregate correctness including uncommitted exclusion. |
| `packages/core/src/index.ts` | Modify. Export the new module. |
| `apps/web/src/features/sprints/**` | Rename of `apps/web/src/features/cycles/**`. |
| `apps/web/src/features/sprints/sprint-roll-up.tsx` | Create. One row per team. |
| `apps/web/src/features/sprints/sprint-header.tsx` | Create. Name, dates, duration, day N of M, actions. |
| `apps/web/src/features/sprints/sprint-tabs.tsx` | Create. Tab bar, link based, no client state. |
| `apps/web/src/features/sprints/sprint-dates-dialog.tsx` | Create. Duration presets and date editing. |
| `apps/web/src/app/(app)/sprints/page.tsx` | Modify. Roll up only. |
| `apps/web/src/app/(app)/team/[key]/sprint/active/page.tsx` | Modify. Redirect to the running sprint number. |
| `apps/web/src/app/(app)/team/[key]/sprint/[number]/page.tsx` | Modify. Header plus tab shell. |

Cadence generation is deliberately **not** in this plan. It is a team setting plus generation logic plus a settings surface, which is its own pull request. It becomes workstream A2 and is listed at the end.

---

### Task 1: Rename the feature directory

Purely mechanical, no behaviour change. Doing it first means every later task writes its files in the right place once.

**Files:**
- Rename: `apps/web/src/features/cycles/` to `apps/web/src/features/sprints/`
- Rename: `apps/web/tests/features/cycles/` to `apps/web/tests/features/sprints/`
- Modify: the eleven files importing `features/cycles`

**Interfaces:**
- Consumes: nothing
- Produces: `@/features/sprints/data.ts`, `@/features/sprints/cycle-board.tsx`, `@/features/sprints/sprint-actions.tsx`, `@/features/sprints/sprint-history.tsx`, `@/features/sprints/burn-up.ts`, `@/features/sprints/cycle-skeleton.tsx`, all with unchanged exports

- [ ] **Step 1: Move both directories with git so history follows**

```bash
git mv apps/web/src/features/cycles apps/web/src/features/sprints
git mv apps/web/tests/features/cycles apps/web/tests/features/sprints
```

- [ ] **Step 2: Rewrite every import**

```bash
grep -rl "features/cycles" apps/web/src apps/web/tests \
  | xargs sed -i '' 's|features/cycles|features/sprints|g'
```

- [ ] **Step 3: Confirm nothing still points at the old path**

Run: `grep -rn "features/cycles" apps/web || echo clean`
Expected: `clean`

- [ ] **Step 4: Typecheck and test**

Run: `bun run verify`
Expected: PASS, with no change in the number of tests

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(sprints): name the feature directory the way the product does"
```

---

### Task 2: The roll up aggregate query

Today `/sprints` awaits `getActiveCycleView` once per team, and each call loads every issue in the sprint and replays its activity history for the burn up. Eight teams is roughly twenty four sequential round trips. The roll up draws no chart, so it needs one grouped query and no history.

**Files:**
- Create: `packages/core/src/work/cycle-roll-up.ts`
- Create: `packages/core/tests/work/cycle-roll-up.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `Principal` from `@orbit/shared/policy`, `db`, `schema` from `@orbit/db`
- Produces:

```ts
export interface SprintRollUpRow {
  readonly teamId: string;
  readonly cycleId: string;
  readonly number: number;
  readonly name: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly committedIssues: number;
  readonly completedIssues: number;
  readonly committedPoints: number;
  readonly completedPoints: number;
}

export function listSprintRollUp(
  principal: Principal,
  teamIds: readonly string[],
  now?: Date,
): Promise<SprintRollUpRow[]>;
```

- [ ] **Step 1: Write the failing test**

Create `packages/core/tests/work/cycle-roll-up.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'bun:test';
import { createTeam } from '../../src/org/team-service.ts';
import {
  createWorkspace,
  resetDatabase,
  stateNamed,
  type Workspace,
} from '../../src/test-support.ts';
import { createCycle } from '../../src/work/cycle-service.ts';
import { listSprintRollUp } from '../../src/work/cycle-roll-up.ts';
import { createIssue, updateIssue } from '../../src/work/issue-service.ts';

let workspace: Workspace;

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Nova');
});

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 86_400_000);
}

async function runningCycle() {
  const { cycle } = await createCycle(workspace.admin, {
    teamId: workspace.teamId,
    name: 'Sprint A',
    startsAt: daysFromNow(-1),
    endsAt: daysFromNow(13),
  });
  return cycle;
}

async function issueIn(cycleId: string, stateName: string, estimate: number) {
  const state = stateNamed(workspace.states, stateName);
  const { issue } = await createIssue(workspace.admin, {
    teamId: workspace.teamId,
    title: `${stateName} ${estimate}`,
    estimate,
  });
  await updateIssue(workspace.admin, issue.id, { cycleId, stateId: state.id });
  return issue;
}

describe('listSprintRollUp', () => {
  it('counts committed work and ignores triage and backlog', async () => {
    const cycle = await runningCycle();
    await issueIn(cycle.id, 'Todo', 3);
    await issueIn(cycle.id, 'Done', 5);
    await issueIn(cycle.id, 'Backlog', 8);

    const [row] = await listSprintRollUp(workspace.admin, [workspace.teamId]);

    expect(row).toBeDefined();
    expect(row?.committedIssues).toBe(2);
    expect(row?.completedIssues).toBe(1);
    expect(row?.committedPoints).toBe(8);
    expect(row?.completedPoints).toBe(5);
  });

  it('returns a running sprint that holds no issues', async () => {
    await runningCycle();

    const [row] = await listSprintRollUp(workspace.admin, [workspace.teamId]);

    expect(row?.committedIssues).toBe(0);
    expect(row?.committedPoints).toBe(0);
  });

  it('omits a team the principal cannot see', async () => {
    const cycle = await runningCycle();
    await issueIn(cycle.id, 'Todo', 3);
    const other = await createTeam(workspace.admin, { name: 'Design', key: 'DES' });
    const stranger = { ...workspace.admin, role: 'member' as const, teamIds: [other.team.id] };

    const rows = await listSprintRollUp(stranger, [workspace.teamId, other.team.id]);

    expect(rows.map((row) => row.teamId)).not.toContain(workspace.teamId);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd packages/core && bun test tests/work/cycle-roll-up.test.ts`
Expected: FAIL, cannot find module `../../src/work/cycle-roll-up.ts`

- [ ] **Step 3: Write the implementation**

Create `packages/core/src/work/cycle-roll-up.ts`:

```ts
import { and, asc, db, eq, gt, inArray, isNull, lte, schema, sql } from '@orbit/db';
import type { Principal } from '@orbit/shared/policy';
import { assertCan } from '@orbit/shared/policy';

export interface SprintRollUpRow {
  readonly teamId: string;
  readonly cycleId: string;
  readonly number: number;
  readonly name: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly committedIssues: number;
  readonly completedIssues: number;
  readonly committedPoints: number;
  readonly completedPoints: number;
}

const COMMITTED = sql`${schema.workflowState.category} not in ('triage', 'backlog', 'canceled')`;
const DONE = sql`${schema.workflowState.category} = 'completed'`;

function visibleTeams(principal: Principal, teamIds: readonly string[]): string[] {
  if (principal.role === 'admin') return [...teamIds];
  return teamIds.filter((id) => principal.teamIds.includes(id));
}

export async function listSprintRollUp(
  principal: Principal,
  teamIds: readonly string[],
  now: Date = new Date(),
): Promise<SprintRollUpRow[]> {
  assertCan(principal, 'issue:read');
  const visible = visibleTeams(principal, teamIds);
  if (visible.length === 0) return [];

  return await db
    .select({
      teamId: schema.cycle.teamId,
      cycleId: schema.cycle.id,
      number: schema.cycle.number,
      name: schema.cycle.name,
      startsAt: schema.cycle.startsAt,
      endsAt: schema.cycle.endsAt,
      committedIssues: sql<number>`count(${schema.issue.id}) filter (where ${COMMITTED})`.mapWith(
        Number,
      ),
      completedIssues:
        sql<number>`count(${schema.issue.id}) filter (where ${COMMITTED} and ${DONE})`.mapWith(
          Number,
        ),
      committedPoints:
        sql<number>`coalesce(sum(${schema.issue.estimate}) filter (where ${COMMITTED}), 0)`.mapWith(
          Number,
        ),
      completedPoints:
        sql<number>`coalesce(sum(${schema.issue.estimate}) filter (where ${COMMITTED} and ${DONE}), 0)`.mapWith(
          Number,
        ),
    })
    .from(schema.cycle)
    .leftJoin(
      schema.issue,
      and(eq(schema.issue.cycleId, schema.cycle.id), isNull(schema.issue.archivedAt)),
    )
    .leftJoin(schema.workflowState, eq(schema.workflowState.id, schema.issue.stateId))
    .where(
      and(
        eq(schema.cycle.organizationId, principal.organizationId),
        inArray(schema.cycle.teamId, visible),
        isNull(schema.cycle.archivedAt),
        isNull(schema.cycle.completedAt),
        lte(schema.cycle.startsAt, now),
        gt(schema.cycle.endsAt, now),
      ),
    )
    .groupBy(schema.cycle.id)
    .orderBy(asc(schema.cycle.endsAt));
}
```

- [ ] **Step 4: Export it**

In `packages/core/src/index.ts`, beside the existing `export * from './work/cycle-service.ts';`:

```ts
export * from './work/cycle-roll-up.ts';
```

- [ ] **Step 5: Run the tests**

Run: `cd packages/core && bun test tests/work/cycle-roll-up.test.ts`
Expected: PASS, three tests

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/work/cycle-roll-up.ts packages/core/src/index.ts packages/core/tests/work/cycle-roll-up.test.ts
git commit -m "feat(sprints): read every team's running sprint in one query"
```

---

### Task 3: The roll up row and the new `/sprints`

**Files:**
- Create: `apps/web/src/features/sprints/sprint-roll-up.tsx`
- Create: `apps/web/tests/features/sprints/sprint-roll-up.test.tsx`
- Modify: `apps/web/src/app/(app)/sprints/page.tsx`

**Interfaces:**
- Consumes: `SprintRollUpRow` from `@orbit/core`, `sprintLabel` from `@orbit/shared/utils`, `ProgressBar` from `@/features/charts/donut.tsx`, `Badge`, `EmptyState`
- Produces:

```ts
export interface SprintRollUpEntry {
  readonly team: { readonly id: string; readonly key: string; readonly name: string };
  readonly sprint: SprintRollUpRow | null;
}

export function SprintRollUp(props: {
  readonly entries: readonly SprintRollUpEntry[];
  readonly canManage: boolean;
}): ReactElement;

export function sprintDay(startsAt: Date, endsAt: Date, now: Date): { day: number; total: number };
export function atRisk(entry: SprintRollUpEntry, now: Date): boolean;
```

`sprintDay` returns the one based day within the sprint, clamped to the total. `atRisk` is true when more than half the sprint has elapsed and completed points are under a third of committed points.

- [ ] **Step 1: Write the failing test**

Create `apps/web/tests/features/sprints/sprint-roll-up.test.tsx`:

```tsx
import { afterEach, describe, expect, it, mock } from 'bun:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ToastProvider } from '@/components/ui/toast.tsx';

mock.module('next/navigation', () => ({
  useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
}));

const { atRisk, SprintRollUp, sprintDay } = await import('@/features/sprints/sprint-roll-up.tsx');

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <ToastProvider>{node}</ToastProvider>
    </QueryClientProvider>
  );
}

afterEach(cleanup);

const NOW = new Date('2026-08-10T00:00:00.000Z');

function entry(overrides: Record<string, number> = {}) {
  return {
    team: { id: 'team_nov', key: 'NOV', name: 'Noveum' },
    sprint: {
      teamId: 'team_nov',
      cycleId: 'cycle_1',
      number: 1,
      name: '',
      startsAt: new Date('2026-08-09T00:00:00.000Z'),
      endsAt: new Date('2026-08-24T00:00:00.000Z'),
      committedIssues: 31,
      completedIssues: 4,
      committedPoints: 94,
      completedPoints: 12,
      ...overrides,
    },
  };
}

describe('sprintDay', () => {
  it('counts the first day as day one', () => {
    const range = sprintDay(new Date('2026-08-09'), new Date('2026-08-23'), new Date('2026-08-09'));
    expect(range).toEqual({ day: 1, total: 14 });
  });

  it('clamps a sprint read after it ended', () => {
    const range = sprintDay(new Date('2026-08-09'), new Date('2026-08-23'), new Date('2026-09-01'));
    expect(range).toEqual({ day: 14, total: 14 });
  });
});

describe('atRisk', () => {
  it('flags a sprint past halfway with little completed', () => {
    expect(atRisk(entry(), new Date('2026-08-20'))).toBe(true);
  });

  it('does not flag a sprint that has barely started', () => {
    expect(atRisk(entry(), NOW)).toBe(false);
  });

  it('does not flag a sprint with nothing committed', () => {
    expect(atRisk(entry({ committedPoints: 0, completedPoints: 0 }), new Date('2026-08-20'))).toBe(
      false,
    );
  });
});

describe('SprintRollUp', () => {
  it('renders one row per team and falls back to the sprint number', () => {
    render(wrap(<SprintRollUp entries={[entry()]} canManage={true} />));

    expect(screen.getByText('NOV')).toBeDefined();
    expect(screen.getByText('Sprint 1')).toBeDefined();
    expect(screen.getByTestId('roll-up-points-team_nov').textContent).toContain('12 / 94');
  });

  it('offers to start a sprint for a team without one', () => {
    render(
      wrap(
        <SprintRollUp
          entries={[{ team: { id: 'team_ui', key: 'UI', name: 'UI Team' }, sprint: null }]}
          canManage={true}
        />,
      ),
    );

    expect(screen.getByTestId('roll-up-empty-team_ui')).toBeDefined();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd apps/web && bun test tests/features/sprints/sprint-roll-up.test.tsx`
Expected: FAIL, cannot find module `sprint-roll-up.tsx`

- [ ] **Step 3: Write the component**

Create `apps/web/src/features/sprints/sprint-roll-up.tsx`:

```tsx
import type { SprintRollUpRow } from '@orbit/core';
import { sprintLabel } from '@orbit/shared/utils';
import { AlertTriangle, RefreshCcw } from 'lucide-react';
import Link from 'next/link';
import type { ReactElement } from 'react';
import { Badge } from '@/components/ui/badge.tsx';
import { EmptyState } from '@/components/ui/empty-state.tsx';
import { ProgressBar } from '@/features/charts/donut.tsx';
import { cn } from '@/lib/cn.ts';
import { rowHover } from '@/lib/interaction.ts';
import { NewSprintButton } from './sprint-actions.tsx';

const DAY = 86_400_000;

export interface SprintRollUpEntry {
  readonly team: { readonly id: string; readonly key: string; readonly name: string };
  readonly sprint: SprintRollUpRow | null;
}

export function sprintDay(
  startsAt: Date,
  endsAt: Date,
  now: Date,
): { day: number; total: number } {
  const total = Math.max(1, Math.round((endsAt.getTime() - startsAt.getTime()) / DAY));
  const elapsed = Math.floor((now.getTime() - startsAt.getTime()) / DAY) + 1;
  return { day: Math.min(Math.max(elapsed, 1), total), total };
}

export function atRisk(entry: SprintRollUpEntry, now: Date): boolean {
  const sprint = entry.sprint;
  if (sprint === null || sprint.committedPoints === 0) return false;
  const { day, total } = sprintDay(sprint.startsAt, sprint.endsAt, now);
  if (day * 2 <= total) return false;
  return sprint.completedPoints * 3 < sprint.committedPoints;
}

function formatDay(value: Date): string {
  return value.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function SprintRow({
  entry,
  now,
  canManage,
}: {
  readonly entry: SprintRollUpEntry;
  readonly now: Date;
  readonly canManage: boolean;
}) {
  const { team, sprint } = entry;

  if (sprint === null) {
    return (
      <li
        data-testid={`roll-up-empty-${team.id}`}
        className="flex flex-wrap items-center gap-3 rounded-lg border border-border px-3 py-2.5"
      >
        <Badge tone="outline">{team.key}</Badge>
        <span className="text-dense text-text">{team.name}</span>
        <span className="text-2xs text-faint">No sprint running</span>
        {canManage ? (
          <span className="ml-auto">
            <NewSprintButton teamId={team.id} />
          </span>
        ) : null}
      </li>
    );
  }

  const { day, total } = sprintDay(sprint.startsAt, sprint.endsAt, now);
  const risk = atRisk(entry, now);

  return (
    <li>
      <Link
        href={`/team/${team.key.toLowerCase()}/sprint/${sprint.number}`}
        data-testid={`roll-up-row-${team.id}`}
        className={cn(
          'grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 rounded-lg border border-border px-3 py-2.5 outline-none',
          'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset',
          rowHover,
        )}
      >
        <Badge tone="accent">{team.key}</Badge>
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-dense text-text">{sprintLabel(sprint)}</span>
          <span className="shrink-0 text-2xs text-faint tabular">
            {formatDay(sprint.startsAt)} to {formatDay(sprint.endsAt)}
          </span>
          <span className="shrink-0 text-2xs text-faint tabular">
            Day {day} of {total}
          </span>
          {risk ? (
            <AlertTriangle
              className="size-3.5 shrink-0 text-danger"
              aria-label="Behind pace"
              data-testid={`roll-up-risk-${team.id}`}
            />
          ) : null}
        </span>
        <span
          data-testid={`roll-up-points-${team.id}`}
          className="shrink-0 text-2xs text-muted tabular"
        >
          {sprint.completedPoints} / {sprint.committedPoints} pts
        </span>
        <span className="col-span-3">
          <ProgressBar
            completed={sprint.completedPoints}
            scope={sprint.committedPoints}
            label={`${team.name} sprint progress`}
          />
        </span>
      </Link>
    </li>
  );
}

export function SprintRollUp({
  entries,
  canManage,
  now = new Date(),
}: {
  readonly entries: readonly SprintRollUpEntry[];
  readonly canManage: boolean;
  readonly now?: Date;
}): ReactElement {
  if (entries.length === 0) {
    return (
      <EmptyState
        icon={<RefreshCcw strokeWidth={1.75} aria-hidden="true" />}
        title="No teams yet"
        description="Sprints belong to a team. Create one in workspace settings first."
      />
    );
  }

  const ordered = [...entries].sort((left, right) => {
    const risk = Number(atRisk(right, now)) - Number(atRisk(left, now));
    if (risk !== 0) return risk;
    const leftEnd = left.sprint?.endsAt.getTime() ?? Number.POSITIVE_INFINITY;
    const rightEnd = right.sprint?.endsAt.getTime() ?? Number.POSITIVE_INFINITY;
    return leftEnd - rightEnd;
  });

  return (
    <ul className="flex flex-col gap-1.5" data-testid="sprint-roll-up">
      {ordered.map((entry) => (
        <SprintRow key={entry.team.id} entry={entry} now={now} canManage={canManage} />
      ))}
    </ul>
  );
}
```

- [ ] **Step 4: Run the tests**

Run: `cd apps/web && bun test tests/features/sprints/sprint-roll-up.test.tsx`
Expected: PASS, six tests

- [ ] **Step 5: Rewrite the page to use it**

Replace the body of `apps/web/src/app/(app)/sprints/page.tsx`:

```tsx
import { listSprintRollUp } from '@orbit/core';
import { can } from '@orbit/shared/policy';
import type { Metadata } from 'next';
import { SprintRollUp, type SprintRollUpEntry } from '@/features/sprints/sprint-roll-up.tsx';
import { pageContext } from '@/lib/api/handler.ts';
import { listTeamsForPrincipal } from '@/lib/workspace.ts';

export const metadata: Metadata = { title: 'Sprints' };

export default async function SprintsPage() {
  const { principal } = await pageContext();
  const teams = await listTeamsForPrincipal(principal);
  const rows = await listSprintRollUp(
    principal,
    teams.map((team) => team.id),
  );
  const byTeam = new Map(rows.map((row) => [row.teamId, row]));

  const entries: SprintRollUpEntry[] = teams.map((team) => ({
    team,
    sprint: byTeam.get(team.id) ?? null,
  }));

  return (
    <div className="flex flex-col gap-4 px-6 py-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-semibold text-lg text-text">Sprints</h1>
        <p className="text-muted text-xs">
          One row per team. Open a team to plan its sprint.
        </p>
      </header>
      <SprintRollUp entries={entries} canManage={can(principal, 'cycle:manage')} />
    </div>
  );
}
```

- [ ] **Step 6: Verify and commit**

Run: `bun run verify`
Expected: PASS

```bash
git add apps/web/src/features/sprints/sprint-roll-up.tsx apps/web/tests/features/sprints/sprint-roll-up.test.tsx "apps/web/src/app/(app)/sprints/page.tsx"
git commit -m "feat(sprints): give every team one row instead of one panel"
```

---

### Task 4: The sprint page shell

`/team/[key]/sprint/active` stops rendering a page of its own and redirects to the running sprint's number, so there is exactly one sprint page to maintain and its URL is shareable.

**Files:**
- Create: `apps/web/src/features/sprints/sprint-tabs.tsx`
- Create: `apps/web/tests/features/sprints/sprint-tabs.test.tsx`
- Modify: `apps/web/src/app/(app)/team/[key]/sprint/active/page.tsx`
- Modify: `apps/web/src/app/(app)/team/[key]/sprint/[number]/page.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks
- Produces:

```ts
export const SPRINT_TABS = ['board', 'list', 'planning', 'insights', 'retro'] as const;
export type SprintTab = (typeof SPRINT_TABS)[number];
export function parseSprintTab(value: string | undefined): SprintTab;
export function SprintTabs(props: {
  readonly base: string;
  readonly active: SprintTab;
  readonly available: readonly SprintTab[];
}): ReactElement;
```

Only the tabs a workstream has delivered are passed in `available`. This task passes `['board', 'insights']`, since those are the two the current code can already render.

- [ ] **Step 1: Write the failing test**

Create `apps/web/tests/features/sprints/sprint-tabs.test.tsx`:

```tsx
import { afterEach, describe, expect, it } from 'bun:test';
import { cleanup, render, screen } from '@testing-library/react';
import { parseSprintTab, SprintTabs } from '@/features/sprints/sprint-tabs.tsx';

afterEach(cleanup);

describe('parseSprintTab', () => {
  it('defaults to the board', () => {
    expect(parseSprintTab(undefined)).toBe('board');
  });

  it('rejects an unknown tab', () => {
    expect(parseSprintTab('nonsense')).toBe('board');
  });

  it('keeps a known tab', () => {
    expect(parseSprintTab('insights')).toBe('insights');
  });
});

describe('SprintTabs', () => {
  it('renders only the available tabs and marks the active one', () => {
    render(<SprintTabs base="/team/nov/sprint/1" active="insights" available={['board', 'insights']} />);

    expect(screen.getByTestId('sprint-tab-board')).toBeDefined();
    expect(screen.queryByTestId('sprint-tab-planning')).toBeNull();
    expect(screen.getByTestId('sprint-tab-insights').getAttribute('aria-current')).toBe('page');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd apps/web && bun test tests/features/sprints/sprint-tabs.test.tsx`
Expected: FAIL, cannot find module `sprint-tabs.tsx`

- [ ] **Step 3: Write the component**

Create `apps/web/src/features/sprints/sprint-tabs.tsx`:

```tsx
import Link from 'next/link';
import type { ReactElement } from 'react';
import { cn } from '@/lib/cn.ts';
import { rowHover } from '@/lib/interaction.ts';

export const SPRINT_TABS = ['board', 'list', 'planning', 'insights', 'retro'] as const;
export type SprintTab = (typeof SPRINT_TABS)[number];

const LABELS: Record<SprintTab, string> = {
  board: 'Board',
  list: 'List',
  planning: 'Planning',
  insights: 'Insights',
  retro: 'Retro',
};

export function parseSprintTab(value: string | undefined): SprintTab {
  const found = SPRINT_TABS.find((tab) => tab === value);
  return found ?? 'board';
}

export function SprintTabs({
  base,
  active,
  available,
}: {
  readonly base: string;
  readonly active: SprintTab;
  readonly available: readonly SprintTab[];
}): ReactElement {
  return (
    <nav className="flex items-center gap-0.5 border-border border-b" aria-label="Sprint views">
      {available.map((tab) => (
        <Link
          key={tab}
          href={tab === 'board' ? base : `${base}?tab=${tab}`}
          data-testid={`sprint-tab-${tab}`}
          aria-current={tab === active ? 'page' : undefined}
          className={cn(
            '-mb-px border-b-2 px-3 py-1.5 text-dense outline-none',
            'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset',
            tab === active
              ? 'border-accent text-text'
              : cn('border-transparent text-muted', rowHover),
          )}
        >
          {LABELS[tab]}
        </Link>
      ))}
    </nav>
  );
}
```

- [ ] **Step 4: Run the tests**

Run: `cd apps/web && bun test tests/features/sprints/sprint-tabs.test.tsx`
Expected: PASS, four tests

- [ ] **Step 5: Redirect the active route**

Replace `apps/web/src/app/(app)/team/[key]/sprint/active/page.tsx` entirely:

```tsx
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { runningSprintNumber } from '@/features/sprints/data.ts';
import { pageContext } from '@/lib/api/handler.ts';
import { listTeamsForPrincipal } from '@/lib/workspace.ts';

interface PageProps {
  readonly params: Promise<{ key: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { key } = await params;
  return { title: `${key.toUpperCase()} active sprint` };
}

export default async function ActiveSprintPage({ params }: PageProps) {
  const { key } = await params;
  const { principal } = await pageContext();
  const teams = await listTeamsForPrincipal(principal);
  const team = teams.find((entry) => entry.key.toLowerCase() === key.toLowerCase());
  if (team === undefined) notFound();

  const number = await runningSprintNumber(principal, team);
  if (number === null) redirect('/sprints');
  redirect(`/team/${key.toLowerCase()}/sprint/${number}`);
}
```

- [ ] **Step 6: Add the helper it needs**

In `apps/web/src/features/sprints/data.ts`, beside the existing `runningSprintId`:

```ts
export async function runningSprintNumber(
  principal: Principal,
  team: { id: string },
  now: Date = new Date(),
): Promise<number | null> {
  const cycle = await activeCycle(principal, team.id, now);
  return cycle?.number ?? null;
}
```

- [ ] **Step 7: Mount the tabs on the numbered page**

In `apps/web/src/app/(app)/team/[key]/sprint/[number]/page.tsx`, widen `PageProps` to accept a search param and render the tab bar above the existing panel:

```tsx
interface PageProps {
  readonly params: Promise<{ key: string; number: string }>;
  readonly searchParams: Promise<{ tab?: string }>;
}
```

Inside the component, after the sprint is resolved:

```tsx
const { tab } = await searchParams;
const active = parseSprintTab(tab);
const base = `/team/${key.toLowerCase()}/sprint/${number}`;
```

and above `<CyclePanel ...>`:

```tsx
<SprintTabs base={base} active={active} available={['board', 'insights']} />
```

- [ ] **Step 8: Verify and commit**

Run: `bun run verify`
Expected: PASS

```bash
git add apps/web/src/features/sprints apps/web/tests/features/sprints "apps/web/src/app/(app)/team"
git commit -m "feat(sprints): give a sprint one address and a tab bar"
```

---

### Task 5: Rename a sprint from its header

Renaming works today but is buried behind a ghost Edit button that also owns the dates. The name becomes an inline field. This task also stops `createCycle` writing the literal default into the column, so a custom name is distinguishable from a generated one.

**Files:**
- Create: `apps/web/src/features/sprints/sprint-header.tsx`
- Create: `apps/web/tests/features/sprints/sprint-header.test.tsx`
- Modify: `packages/core/src/work/cycle-service.ts:140`
- Modify: `packages/core/src/work/cycle-service.ts:904`
- Modify: `packages/core/tests/work/cycle-service.test.ts`

**Interfaces:**
- Consumes: `useUpdateSprint` from `@/lib/query/use-sprints.ts`, `sprintDay` from `./sprint-roll-up.tsx`
- Produces:

```ts
export function SprintHeader(props: {
  readonly sprint: {
    readonly id: string;
    readonly name: string;
    readonly number: number;
    readonly startsAt: string;
    readonly endsAt: string;
    readonly completedAt: string | null;
  };
  readonly teamKey: string;
  readonly canManage: boolean;
}): ReactElement;
```

- [ ] **Step 1: Write the failing core test**

Add to `packages/core/tests/work/cycle-service.test.ts` inside the `createCycle` describe block:

```ts
it('leaves the name empty so the number carries the label', async () => {
  const { cycle } = await createCycle(workspace.admin, {
    teamId: workspace.teamId,
    startsAt: daysFromNow(30),
    endsAt: daysFromNow(44),
  });

  expect(cycle.name).toBe('');
  expect(sprintLabel(cycle)).toBe(`Sprint ${cycle.number}`);
});
```

Add `import { sprintLabel } from '@orbit/shared/utils';` to that file's imports.

- [ ] **Step 2: Run it and watch it fail**

Run: `cd packages/core && bun test tests/work/cycle-service.test.ts -t 'leaves the name empty'`
Expected: FAIL, received `Sprint 2`

- [ ] **Step 3: Stop writing the default into the column**

In `packages/core/src/work/cycle-service.ts`, in `createCycle`, change:

```ts
name: parsed.name ?? `Sprint ${number}`,
```

to:

```ts
name: parsed.name ?? '',
```

and in `completeCycle`, where the next sprint is created, change:

```ts
name: `Sprint ${number}`,
```

to:

```ts
name: '',
```

- [ ] **Step 4: Run the whole cycle suite**

Run: `cd packages/core && bun test tests/work/cycle-service.test.ts`
Expected: PASS. Any assertion that expected a stored `Sprint N` is updated to expect `''` and to assert on `sprintLabel(cycle)` instead.

- [ ] **Step 5: Write the failing header test**

Create `apps/web/tests/features/sprints/sprint-header.test.tsx`:

```tsx
import { afterEach, describe, expect, it, mock } from 'bun:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { ToastProvider } from '@/components/ui/toast.tsx';

const bodies: string[] = [];

globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
  if (typeof init?.body === 'string') bodies.push(init.body);
  return Promise.resolve(
    new Response(
      JSON.stringify({
        cycle: {
          id: 'cycle_1',
          teamId: 'team_nov',
          number: 1,
          name: 'Hardening',
          startsAt: '2026-08-09T00:00:00.000Z',
          endsAt: '2026-08-23T00:00:00.000Z',
          completedAt: null,
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ),
  );
}) as typeof fetch;

mock.module('next/navigation', () => ({
  useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
}));

const { SprintHeader } = await import('@/features/sprints/sprint-header.tsx');

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <ToastProvider>{node}</ToastProvider>
    </QueryClientProvider>
  );
}

const SPRINT = {
  id: 'cycle_1',
  name: '',
  number: 1,
  startsAt: '2026-08-09T00:00:00.000Z',
  endsAt: '2026-08-23T00:00:00.000Z',
  completedAt: null,
};

afterEach(cleanup);

describe('SprintHeader', () => {
  it('shows the numbered fallback when the sprint has no name', () => {
    render(wrap(<SprintHeader sprint={SPRINT} teamKey="NOV" canManage={true} />));

    expect(screen.getByTestId('sprint-name').textContent).toBe('Sprint 1');
  });

  it('saves a new name on blur', async () => {
    render(wrap(<SprintHeader sprint={SPRINT} teamKey="NOV" canManage={true} />));

    await userEvent.click(screen.getByTestId('sprint-name'));
    await userEvent.type(screen.getByTestId('sprint-name-input'), 'Hardening');
    await userEvent.tab();

    expect(bodies.some((body) => body.includes('Hardening'))).toBe(true);
  });

  it('does not offer renaming without permission', () => {
    render(wrap(<SprintHeader sprint={SPRINT} teamKey="NOV" canManage={false} />));

    expect(screen.queryByTestId('sprint-name-input')).toBeNull();
  });
});
```

- [ ] **Step 6: Run it and watch it fail**

Run: `cd apps/web && bun test tests/features/sprints/sprint-header.test.tsx`
Expected: FAIL, cannot find module `sprint-header.tsx`

- [ ] **Step 7: Write the header**

Create `apps/web/src/features/sprints/sprint-header.tsx`:

```tsx
'use client';

import { sprintLabel } from '@orbit/shared/utils';
import { type KeyboardEvent, type ReactElement, useState } from 'react';
import { Badge } from '@/components/ui/badge.tsx';
import { Input } from '@/components/ui/input.tsx';
import { cn } from '@/lib/cn.ts';
import { rowHover } from '@/lib/interaction.ts';
import { useUpdateSprint } from '@/lib/query/use-sprints.ts';
import { CompleteSprintButton } from './sprint-actions.tsx';
import { sprintDay } from './sprint-roll-up.tsx';

export interface HeaderSprint {
  readonly id: string;
  readonly name: string;
  readonly number: number;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly completedAt: string | null;
}

function formatDay(value: string): string {
  return new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export function SprintHeader({
  sprint,
  teamKey,
  canManage,
}: {
  readonly sprint: HeaderSprint;
  readonly teamKey: string;
  readonly canManage: boolean;
}): ReactElement {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(sprint.name);
  const update = useUpdateSprint();
  const label = sprintLabel(sprint);
  const { day, total } = sprintDay(
    new Date(sprint.startsAt),
    new Date(sprint.endsAt),
    new Date(),
  );

  const commit = () => {
    setEditing(false);
    const next = draft.trim();
    if (next === sprint.name.trim()) return;
    update.mutate({ id: sprint.id, name: next });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commit();
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      setDraft(sprint.name);
      setEditing(false);
    }
  };

  return (
    <header className="flex flex-wrap items-center gap-2">
      {editing && canManage ? (
        <Input
          autoFocus
          maxLength={120}
          value={draft}
          placeholder={label}
          aria-label="Sprint name"
          data-testid="sprint-name-input"
          className="h-7 w-56"
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={onKeyDown}
        />
      ) : (
        <button
          type="button"
          disabled={!canManage}
          data-testid="sprint-name"
          onClick={() => setEditing(true)}
          className={cn(
            'rounded-md px-1 font-semibold text-lg text-text outline-none',
            'focus-visible:ring-2 focus-visible:ring-accent',
            canManage ? rowHover : undefined,
          )}
        >
          {label}
        </button>
      )}
      <Badge tone="accent">{teamKey}</Badge>
      <span className="text-faint text-xs tabular">
        {formatDay(sprint.startsAt)} to {formatDay(sprint.endsAt)}
      </span>
      {sprint.completedAt === null ? (
        <span className="text-faint text-xs tabular" data-testid="sprint-day">
          Day {day} of {total}
        </span>
      ) : null}
      {canManage && sprint.completedAt === null ? (
        <span className="ml-auto flex flex-wrap items-center gap-1.5">
          <CompleteSprintButton sprint={{ ...sprint, name: label }} />
        </span>
      ) : null}
    </header>
  );
}
```

- [ ] **Step 8: Run the tests**

Run: `cd apps/web && bun test tests/features/sprints/sprint-header.test.tsx`
Expected: PASS, three tests

- [ ] **Step 9: Verify and commit**

Run: `bun run verify`
Expected: PASS

```bash
git add -A
git commit -m "feat(sprints): rename a sprint where you read its name"
```

---

### Task 6: Dates, duration, and shifting what follows

**Files:**
- Create: `apps/web/src/features/sprints/sprint-dates-dialog.tsx`
- Create: `apps/web/tests/features/sprints/sprint-dates-dialog.test.tsx`
- Modify: `packages/core/src/work/cycle-service.ts`
- Modify: `packages/shared/src/validators/cycle.ts`
- Modify: `packages/core/tests/work/cycle-service.test.ts`
- Modify: `apps/web/src/app/api/cycles/[id]/route.ts`

**Interfaces:**
- Consumes: `cycleUpdateSchema` from `@orbit/shared/validators`
- Produces:

```ts
export async function shiftFollowingCycles(
  principal: Principal,
  cycleId: string,
  options: { readonly after: Date; readonly days: number },
): Promise<{ shifted: CycleRow[]; actions: SyncAction[] }>;
```

`shiftFollowingCycles` moves every sprint on the team that starts at or after `after`, is not completed and is not archived, by `days` days. It stops at the first completed sprint it meets, ordered by `startsAt`, and it runs under `lockTeamCycles` so it cannot interleave with a create or a start.

`after` is a parameter rather than being read from the anchor because the caller has already written the anchor's new dates by the time this runs. Deriving the boundary from `anchor.endsAt` would read the new date and skip exactly the sprint that needs moving: extend a sprint ending 23 Aug to 26 Aug, and a following sprint starting 23 Aug no longer satisfies `startsAt >= 26 Aug`. The caller passes the anchor's **previous** `endsAt`.

`cycleUpdateSchema` gains `shiftFollowing: z.boolean().optional()`.

- [ ] **Step 1: Write the failing core test**

Add to `packages/core/tests/work/cycle-service.test.ts`:

```ts
describe('shiftFollowingCycles', () => {
  it('moves later sprints and stops at a completed one', async () => {
    const first = await createCycle(workspace.admin, {
      teamId: workspace.teamId,
      startsAt: daysFromNow(1),
      endsAt: daysFromNow(15),
    });
    const second = await createCycle(workspace.admin, {
      teamId: workspace.teamId,
      startsAt: daysFromNow(15),
      endsAt: daysFromNow(29),
    });

    const { shifted } = await shiftFollowingCycles(workspace.admin, first.cycle.id, {
      after: first.cycle.endsAt,
      days: 3,
    });

    expect(shifted.map((row) => row.id)).toEqual([second.cycle.id]);
    const moved = await getCycle(workspace.admin, second.cycle.id);
    expect(moved.startsAt.getTime()).toBe(second.cycle.startsAt.getTime() + 3 * 86_400_000);
    expect(moved.endsAt.getTime()).toBe(second.cycle.endsAt.getTime() + 3 * 86_400_000);
  });

  it('still moves a following sprint after the anchor was already extended', async () => {
    const first = await createCycle(workspace.admin, {
      teamId: workspace.teamId,
      startsAt: daysFromNow(1),
      endsAt: daysFromNow(15),
    });
    const second = await createCycle(workspace.admin, {
      teamId: workspace.teamId,
      startsAt: daysFromNow(15),
      endsAt: daysFromNow(29),
    });
    const previousEnd = first.cycle.endsAt;
    await updateCycle(workspace.admin, first.cycle.id, { endsAt: daysFromNow(18) });

    const { shifted } = await shiftFollowingCycles(workspace.admin, first.cycle.id, {
      after: previousEnd,
      days: 3,
    });

    expect(shifted.map((row) => row.id)).toEqual([second.cycle.id]);
  });

  it('leaves earlier sprints alone', async () => {
    const earlier = await createCycle(workspace.admin, {
      teamId: workspace.teamId,
      startsAt: daysFromNow(1),
      endsAt: daysFromNow(15),
    });
    const later = await createCycle(workspace.admin, {
      teamId: workspace.teamId,
      startsAt: daysFromNow(15),
      endsAt: daysFromNow(29),
    });

    const { shifted } = await shiftFollowingCycles(workspace.admin, later.cycle.id, {
      after: later.cycle.endsAt,
      days: 2,
    });

    expect(shifted.map((row) => row.id)).not.toContain(earlier.cycle.id);
  });
});
```

Add `shiftFollowingCycles` to the import list at the top of that file.

- [ ] **Step 2: Run it and watch it fail**

Run: `cd packages/core && bun test tests/work/cycle-service.test.ts -t shiftFollowingCycles`
Expected: FAIL, `shiftFollowingCycles is not a function`

- [ ] **Step 3: Implement it**

Add to `packages/core/src/work/cycle-service.ts`:

```ts
export async function shiftFollowingCycles(
  principal: Principal,
  cycleId: string,
  options: { readonly after: Date; readonly days: number },
): Promise<{ shifted: CycleRow[]; actions: SyncAction[] }> {
  assertCan(principal, 'cycle:manage');
  const { after, days } = options;
  if (days === 0) return { shifted: [], actions: [] };

  return await db.transaction(async (tx) => {
    const anchor = await requireCycleForUpdate(tx, principal, cycleId);
    await lockTeamCycles(tx, anchor.teamId);

    const following = await tx
      .select()
      .from(schema.cycle)
      .where(
        and(
          eq(schema.cycle.teamId, anchor.teamId),
          isNull(schema.cycle.archivedAt),
          gte(schema.cycle.startsAt, after),
          ne(schema.cycle.id, anchor.id),
        ),
      )
      .orderBy(asc(schema.cycle.startsAt));

    const movable: CycleRow[] = [];
    for (const row of following) {
      if (row.completedAt !== null) break;
      movable.push(row);
    }
    if (movable.length === 0) return { shifted: [], actions: [] };

    const syncId = await nextSyncId(tx);
    const actor = await principalActor(tx, principal);
    const shifted: CycleRow[] = [];

    for (const row of movable) {
      const [moved] = await tx
        .update(schema.cycle)
        .set({
          startsAt: addUtcDays(row.startsAt, days),
          endsAt: addUtcDays(row.endsAt, days),
          syncId,
        })
        .where(eq(schema.cycle.id, row.id))
        .returning();
      shifted.push(requireRow(moved, 'That cycle does not exist.'));
    }

    return {
      shifted,
      actions: shifted.map((row) =>
        buildSyncAction({
          syncId,
          organizationId: principal.organizationId,
          scopes: cycleScopes(row),
          action: 'update',
          model: 'cycle',
          modelId: row.id,
          data: row,
          actor,
        }),
      ),
    };
  });
}
```

`addUtcDays` accepts a negative count, so a sprint that shortens shifts the
following ones backwards with the same call.

- [ ] **Step 4: Run the tests**

Run: `cd packages/core && bun test tests/work/cycle-service.test.ts`
Expected: PASS

- [ ] **Step 5: Accept the flag on the route**

In `packages/shared/src/validators/cycle.ts`, add `shiftFollowing: z.boolean()` to the object `cycleUpdateSchema` calls `.partial()` on.

In `apps/web/src/app/api/cycles/[id]/route.ts`, read the cycle before updating so the previous end date is available, then shift:

```ts
const parsed = cycleUpdateSchema.parse(body);
const before = await getCycle(principal, id);
const { cycle, actions } = await updateCycle(principal, id, parsed);

const shiftDays =
  parsed.shiftFollowing === true && parsed.endsAt !== undefined
    ? Math.round((cycle.endsAt.getTime() - before.endsAt.getTime()) / 86_400_000)
    : 0;
const followUp =
  shiftDays === 0
    ? { shifted: [], actions: [] }
    : await shiftFollowingCycles(principal, id, { after: before.endsAt, days: shiftDays });

await publish([...actions, ...followUp.actions]);
```

Match the existing route's own publish helper rather than introducing a new one.

- [ ] **Step 6: Write the dialog test and the dialog**

Create `apps/web/tests/features/sprints/sprint-dates-dialog.test.tsx` covering three behaviours: choosing the two week preset sets the end date fourteen days after the start; changing the end date on its own leaves the start untouched; and submitting with the shift box ticked sends `shiftFollowing: true` in the request body. Then write `sprint-dates-dialog.tsx` with a start date input, an end date input, preset buttons for one, two, three and four weeks, a checkbox reading "Move later sprints by the same amount", and inline rendering of a `409` conflict message from `assertCycleWindow` beside the date fields rather than as a toast.

- [ ] **Step 7: Run the tests**

Run: `cd apps/web && bun test tests/features/sprints/sprint-dates-dialog.test.tsx`
Expected: PASS

- [ ] **Step 8: Verify and commit**

Run: `bun run verify`
Expected: PASS

```bash
git add -A
git commit -m "feat(sprints): move a sprint's dates and carry the ones after it"
```

---

### Task 7: Open the pull request

- [ ] **Step 1: Merge current main and re-run everything**

```bash
git fetch origin main
git merge origin/main
bun run verify
```

- [ ] **Step 2: Push and open the pull request**

```bash
git push -u origin claude/sprint-planning-redesign-ef9d1e
```

Open it against `main`, describing the eight duplicated panels it removes and the query count it collapses. Wait for both Greptile and CodeRabbit to finish. Greptile carries the most weight, so work its findings first. If CodeRabbit reports `Review rate limited`, re-run it rather than merging on that result. Never merge while a review is running or with a thread left open: either fix and resolve, or reply explaining why the finding does not apply and resolve.

---

## Not in this plan

| Workstream | Plan file, written when we reach it |
| --- | --- |
| A2. Team sprint cadence | `2026-08-10-sprint-workstream-a2-cadence.md` |
| B. Scope correctness and the `cycle-service` split | `...-workstream-b-scope.md` |
| C. Issue surface on `ViewPage: 'cycle'` | `...-workstream-c-surface.md` |
| D. Capacity and planning | `...-workstream-d-capacity.md` |
| E. Completion with a destination | `...-workstream-e-completion.md` |
| F. Retrospectives | `...-workstream-f-retro.md` |

Each produces working, testable software on its own, which is why they are separate plans rather than one document.

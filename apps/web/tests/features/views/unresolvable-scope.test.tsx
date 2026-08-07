import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { db, eq, schema, sql } from '@orbit/db';
import { defaultViewState, inCondition } from '@orbit/shared/filters';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { ToastProvider } from '@/components/ui/toast.tsx';
import type { WorkspaceData } from '@/features/issues/workspace-provider.tsx';
import * as workspaceProvider from '@/features/issues/workspace-provider.tsx';
import { HotkeyProvider } from '@/lib/keyboard/index.ts';
import { queryKeys } from '@/lib/query/keys.ts';
import type { View } from '@/lib/query/schemas.ts';
import { bootstrapSchema, viewListSchema } from '@/lib/query/schemas.ts';
import { mockSession } from '../../../tests-support.ts';

const ORIGIN = 'http://localhost:3000';

const seeded = {
  organizationId: `org_${randomUUID()}`,
  userId: `user_${randomUUID()}`,
  openTeamId: `team_${randomUUID()}`,
  goneTeamId: `team_${randomUUID()}`,
  openStateId: `state_${randomUUID()}`,
  goneStateId: `state_${randomUUID()}`,
  openIssueId: `issue_${randomUUID()}`,
  goneIssueId: `issue_${randomUUID()}`,
  orphanViewId: `view_${randomUUID()}`,
  teamViewId: `view_${randomUUID()}`,
  brokenViewId: `view_${randomUUID()}`,
  unreadableViewId: `view_${randomUUID()}`,
};

const OPEN_ISSUE_TITLE = 'Reindex the search cluster';
const GONE_ISSUE_TITLE = 'Sweep the retired backlog';

const session = {
  user: { id: seeded.userId, name: 'Scope Reader', email: `${seeded.userId}@orbit.test` },
  session: { activeOrganizationId: seeded.organizationId },
};

mockSession(() => session);

mock.module('next/navigation', () => ({
  useRouter: () => ({ push: mock(), replace: mock(), refresh: mock() }),
  usePathname: () => '/views/saved',
  useSearchParams: () => new URLSearchParams(),
  redirect: () => undefined,
}));

let workspace: WorkspaceData;
mock.module('@/features/issues/workspace-provider.tsx', () => ({
  ...workspaceProvider,
  useWorkspace: () => workspace,
}));

const { SavedViewPage } = await import('@/features/views/saved-view-page.tsx');
const { bootstrapPayload } = await import('@/lib/api/bootstrap.ts');
const { toViewPayload } = await import('@/lib/api/views.ts');
const { listViews } = await import('@orbit/core');
const { resolveMembership } = await import('@/lib/auth/principal.ts');
const issuesRoute = await import('@/app/api/issues/route.ts');
const summaryRoute = await import('@/app/api/issues/summary/route.ts');
const facetsRoute = await import('@/app/api/issues/facets/route.ts');

const HANDLERS: Record<string, (request: Request) => Promise<Response>> = {
  '/api/issues': issuesRoute.GET,
  '/api/issues/summary': summaryRoute.GET,
  '/api/issues/facets': facetsRoute.GET,
};

const ORPHAN_FILTER = {
  kind: 'group' as const,
  combinator: 'and' as const,
  children: [inCondition('priority', ['1'])],
};

async function seedWorkspace(): Promise<void> {
  await db.insert(schema.organization).values({
    id: seeded.organizationId,
    name: 'Scope',
    slug: seeded.organizationId,
  });
  await db.insert(schema.user).values({
    id: seeded.userId,
    name: 'Scope Reader',
    email: `${seeded.userId}@orbit.test`,
    handle: seeded.userId,
  });
  await db.insert(schema.member).values({
    id: `member_${randomUUID()}`,
    organizationId: seeded.organizationId,
    userId: seeded.userId,
    role: 'member',
  });
  await db.insert(schema.team).values([
    {
      id: seeded.openTeamId,
      organizationId: seeded.organizationId,
      name: 'Platform',
      key: seeded.openTeamId.slice(5, 10).toUpperCase(),
    },
    {
      id: seeded.goneTeamId,
      organizationId: seeded.organizationId,
      name: 'Retired',
      key: seeded.goneTeamId.slice(5, 10).toUpperCase(),
      archivedAt: new Date('2026-01-01T00:00:00.000Z'),
    },
  ]);
  await db.insert(schema.teamMember).values({
    id: `tm_${randomUUID()}`,
    teamId: seeded.openTeamId,
    userId: seeded.userId,
  });
  await db.insert(schema.workflowState).values([
    {
      id: seeded.openStateId,
      organizationId: seeded.organizationId,
      teamId: seeded.openTeamId,
      name: 'Todo',
      category: 'unstarted',
      color: '#5A63C8',
    },
    {
      id: seeded.goneStateId,
      organizationId: seeded.organizationId,
      teamId: seeded.goneTeamId,
      name: 'Todo',
      category: 'unstarted',
      color: '#5A63C8',
    },
  ]);
  await db.insert(schema.issue).values([
    {
      id: seeded.openIssueId,
      organizationId: seeded.organizationId,
      teamId: seeded.openTeamId,
      number: 1,
      identifier: `PLT-${seeded.openIssueId.slice(6, 12)}`,
      title: OPEN_ISSUE_TITLE,
      stateId: seeded.openStateId,
      creatorId: seeded.userId,
      priority: 1,
    },
    {
      id: seeded.goneIssueId,
      organizationId: seeded.organizationId,
      teamId: seeded.goneTeamId,
      number: 1,
      identifier: `RET-${seeded.goneIssueId.slice(6, 12)}`,
      title: GONE_ISSUE_TITLE,
      stateId: seeded.goneStateId,
      creatorId: seeded.userId,
      priority: 1,
    },
  ]);
}

function storedState(overrides: Record<string, unknown>) {
  return { ...defaultViewState('list'), filter: ORPHAN_FILTER, ...overrides };
}

async function seedViews(): Promise<void> {
  await db.insert(schema.view).values([
    {
      id: seeded.orphanViewId,
      organizationId: seeded.organizationId,
      ownerId: seeded.userId,
      name: 'Retired team work',
      filter: storedState({ teamId: seeded.goneTeamId }),
      visibility: 'workspace',
      shared: 'true',
    },
    {
      id: seeded.teamViewId,
      organizationId: seeded.organizationId,
      ownerId: seeded.userId,
      name: 'Platform work',
      filter: storedState({ teamId: seeded.openTeamId }),
      visibility: 'workspace',
      shared: 'true',
    },
    {
      id: seeded.brokenViewId,
      organizationId: seeded.organizationId,
      ownerId: seeded.userId,
      name: 'Legacy double encoded',
      filter: {},
      visibility: 'workspace',
      shared: 'true',
    },
    {
      id: seeded.unreadableViewId,
      organizationId: seeded.organizationId,
      ownerId: seeded.userId,
      name: 'Legacy nonsense',
      filter: {},
      visibility: 'workspace',
      shared: 'true',
    },
  ]);
  await db.execute(sql`
    update ${schema.view}
    set filter = to_jsonb(to_jsonb(${JSON.stringify(storedState({ groupBy: 'assignee' }))}::text)::text)
    where ${schema.view.id} = ${seeded.brokenViewId}
  `);
  await db.execute(sql`
    update ${schema.view}
    set filter = to_jsonb('whatever the old client wrote'::text)
    where ${schema.view.id} = ${seeded.unreadableViewId}
  `);
}

async function loadViews(): Promise<readonly View[]> {
  const membership = await resolveMembership(seeded.userId, seeded.organizationId);
  if (membership === null) throw new Error('the seeded member was not found');
  const records = await listViews(membership.principal);
  return viewListSchema.parse({ views: records.map(toViewPayload) }).views;
}

async function buildWorkspace(): Promise<WorkspaceData> {
  const membership = await resolveMembership(seeded.userId, seeded.organizationId);
  if (membership === null) throw new Error('the seeded member was not found');
  const built = await bootstrapPayload(membership.principal, {});
  const payload = bootstrapSchema.parse(JSON.parse(JSON.stringify(built)));
  const states = workspaceProvider.orderStates(payload.states);
  return {
    ready: true,
    userId: payload.userId,
    role: workspaceProvider.toOrgRole(payload.role),
    teams: payload.teams,
    states,
    labels: payload.labels,
    members: payload.members,
    projects: payload.projects,
    cycles: payload.cycles,
    seedIssues: [],
    stateById: new Map(states.map((state) => [state.id, state])),
    labelById: new Map(),
    memberById: new Map(payload.members.map((member) => [member.id, member])),
    openQuickCreate: () => undefined,
  };
}

const realFetch = globalThis.fetch;
let requested: string[] = [];
let views: readonly View[] = [];

function serveFromRoutes(): void {
  globalThis.fetch = ((input: RequestInfo | URL) => {
    const raw = typeof input === 'string' ? input : String(input);
    requested.push(raw);
    const url = new URL(raw, ORIGIN);
    const handler = HANDLERS[url.pathname];
    if (handler === undefined) return Promise.reject(new Error(`no route serves ${raw}`));
    return handler(new Request(url.toString()));
  }) as unknown as typeof fetch;
}

function issueListUrl(): string {
  const found = requested.find((url) => url.startsWith('/api/issues?'));
  if (found === undefined) throw new Error(`no issue list request: ${requested.join(' ')}`);
  return found;
}

function issueListParams(): URLSearchParams {
  return new URLSearchParams(issueListUrl().slice('/api/issues?'.length));
}

async function waitForIssueRequest(): Promise<void> {
  await waitFor(() => {
    issueListUrl();
  });
}

function renderView(viewId: string): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  });
  client.setQueryData(queryKeys.views(), views);
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <HotkeyProvider>
          <SavedViewPage viewId={viewId} />
        </HotkeyProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

const realWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
const realHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');

beforeAll(async () => {
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get: () => 900,
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get: () => 600,
  });
  await seedWorkspace();
  await seedViews();
  workspace = await buildWorkspace();
  views = await loadViews();
});

afterAll(async () => {
  if (realWidth !== undefined) {
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', realWidth);
  }
  if (realHeight !== undefined) {
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', realHeight);
  }
  await db.delete(schema.organization).where(eq(schema.organization.id, seeded.organizationId));
  await db.delete(schema.user).where(eq(schema.user.id, seeded.userId));
});

beforeEach(() => {
  requested = [];
  serveFromRoutes();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('the team a saved view names is one the reader cannot see', () => {
  it('leaves it out of the query, and the server answers that query with issues', async () => {
    renderView(seeded.orphanViewId);

    await waitForIssueRequest();
    expect(issueListParams().get('teamId')).toBeNull();
    expect(await screen.findByText(OPEN_ISSUE_TITLE)).toBeInTheDocument();
  });

  it('still refuses to hand over the issues of the team it could not resolve', async () => {
    renderView(seeded.orphanViewId);

    expect(await screen.findByText(OPEN_ISSUE_TITLE)).toBeInTheDocument();
    expect(screen.queryByText(GONE_ISSUE_TITLE)).toBeNull();
  });

  it('says the saved team is gone rather than claiming the whole workspace', async () => {
    renderView(seeded.orphanViewId);

    const badge = await screen.findByTestId('view-scope');
    expect(badge).toHaveTextContent('saved team unavailable');
  });
});

describe('the team a saved view names is one the reader is on', () => {
  it('narrows the query to it, and the server answers that query with its issues', async () => {
    renderView(seeded.teamViewId);

    await waitForIssueRequest();
    expect(issueListParams().get('teamId')).toBe(seeded.openTeamId);
    expect(await screen.findByText(OPEN_ISSUE_TITLE)).toBeInTheDocument();
    expect(await screen.findByTestId('view-scope')).toHaveTextContent('Platform');
  });
});

describe('a view whose stored settings were written as encoded JSON', () => {
  it('reads them back rather than silently falling back to the defaults', () => {
    const broken = views.find((view) => view.id === seeded.brokenViewId);
    expect(broken?.readable).toBe(true);
    expect(broken?.filter.groupBy).toBe('assignee');
  });
});

describe('a view whose stored settings cannot be read at all', () => {
  it('says so on the page instead of pretending the defaults were saved', async () => {
    renderView(seeded.unreadableViewId);

    expect(await screen.findByTestId('view-unreadable')).toBeInTheDocument();
  });
});

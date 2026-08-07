import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { addMember, createWorkspace, type Workspace } from '@orbit/core/test-support';
import type { SyncAction } from '@orbit/shared/events';
import type { Principal } from '@orbit/shared/policy';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement, ReactNode } from 'react';
import { ToastProvider } from '@/components/ui/toast.tsx';
import { HotkeyProvider } from '@/lib/keyboard/index.ts';

const core = await import('@orbit/core');

let actor: Principal = { userId: 'nobody', organizationId: 'nobody', role: 'admin', teamIds: [] };

function activeSession() {
  return Promise.resolve({
    user: { id: actor.userId, name: 'Signed in', email: 'signed-in@orbit.test' },
    session: { activeOrganizationId: actor.organizationId },
  });
}

function signInAsTheActor(): void {
  mock.module('@orbit/core', () => ({
    ...core,
    publishDeltas: (_actions: readonly SyncAction[]) => Promise.resolve(undefined),
  }));
  mock.module('next/headers', () => ({ headers: () => Promise.resolve(new Headers()) }));
  mock.module('next/navigation', () => ({
    useRouter: () => ({ push: mock(), replace: mock(), refresh: mock(), prefetch: mock() }),
    usePathname: () => '/views',
    useSearchParams: () => new URLSearchParams(),
    redirect: (to: string) => {
      throw new Error(`redirected to ${to}`);
    },
  }));
  mock.module('@/lib/auth/session.ts', () => ({
    getSession: activeSession,
    requireSession: activeSession,
  }));
}

signInAsTheActor();

const issuesRoute = await import('@/app/api/issues/route.ts');
const summaryRoute = await import('@/app/api/issues/summary/route.ts');
const facetsRoute = await import('@/app/api/issues/facets/route.ts');
const bootstrapRoute = await import('@/app/api/bootstrap/route.ts');
const viewsRoute = await import('@/app/api/views/route.ts');
const viewRoute = await import('@/app/api/views/[id]/route.ts');
const savedViewRoute = await import('@/app/(app)/views/[id]/page.tsx');
const workspaceProvider = await import('@/features/issues/workspace-provider.tsx');
const { bootstrapSchema } = await import('@/lib/query/schemas.ts');

let workspace = workspaceProvider.workspaceFrom(undefined, () => undefined);

mock.module('@/features/issues/workspace-provider.tsx', () => ({
  ...workspaceProvider,
  useWorkspace: () => workspace,
}));

const { CreateViewDialog } = await import('@/features/views/create-view-dialog.tsx');

async function loadWorkspaceFromTheServer(): Promise<void> {
  const response = await bootstrapRoute.GET(new Request('http://localhost:3000/api/bootstrap'));
  const payload = bootstrapSchema.parse(await response.json());
  workspace = workspaceProvider.workspaceFrom(payload, () => undefined);
}

const requested: string[] = [];
let realFetch: typeof globalThis.fetch | null = null;

function routeFor(path: string, request: Request): Promise<Response> {
  if (path.startsWith('/api/issues/summary')) return summaryRoute.GET(request);
  if (path.startsWith('/api/issues/facets')) return facetsRoute.GET(request);
  if (path.startsWith('/api/issues')) return issuesRoute.GET(request);
  if (path.startsWith('/api/bootstrap')) return bootstrapRoute.GET(request);
  if (path.startsWith('/api/views/')) {
    const id = path.slice('/api/views/'.length);
    return viewRoute.PATCH(request, { params: Promise.resolve({ id }) });
  }
  if (path.startsWith('/api/views')) {
    return request.method === 'POST' ? viewsRoute.POST(request) : viewsRoute.GET();
  }
  throw new Error(`the page asked for ${path}, which no route in this test serves`);
}

function serveFromTheRealRoutes(): void {
  if (realFetch === null) realFetch = globalThis.fetch;
  globalThis.fetch = ((path: string, init?: RequestInit) => {
    requested.push(path);
    return routeFor(path, new Request(`http://localhost:3000${path}`, init));
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

function providers(children: ReactNode): ReactElement {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return (
    <QueryClientProvider client={client}>
      <ToastProvider>
        <HotkeyProvider>{children}</HotkeyProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}

const SETTLE = { timeout: 15_000, interval: 50 };

async function openView(id: string): Promise<void> {
  const page = (await savedViewRoute.default({
    params: Promise.resolve({ id: encodeURIComponent(id) }),
  })) as ReactElement;
  await loadWorkspaceFromTheServer();
  requested.length = 0;
  render(providers(page));
  await waitFor(() => {
    expect(screen.queryByTestId('saved-view-page') !== null).toBe(true);
  }, SETTLE);
  await waitFor(() => {
    expect(requested.some((url) => url.startsWith('/api/issues?'))).toBe(true);
  }, SETTLE);
  await waitFor(() => {
    const painted =
      screen.queryByTestId('saved-view-list') !== null ||
      screen.queryByTestId('saved-view-board') !== null ||
      screen.queryByText('No issues match this view') !== null;
    expect(painted).toBe(true);
  }, SETTLE);
}

function titlesOnScreen(candidates: readonly string[]): string[] {
  return candidates.filter((title) => screen.queryByText(title) !== null);
}

function scopeBadge(): string {
  return screen.getByTestId('view-scope').textContent ?? '';
}

const ADA_ASSIGNED = 'Ada owns this';
const ADA_CREATED = 'Ada opened this';
const BO_ONLY = 'Bo owns and opened this';
const NOBODY_OWNS = 'Nobody owns this';
const OVERDUE = 'Due last week';
const NOT_DUE_YET = 'Due next month';
const ADA_FOLLOWS = 'Ada follows this';
const DESIGN_ISSUE = 'Design system tokens';

const NOVA_ISSUES: string[] = [
  ADA_ASSIGNED,
  ADA_CREATED,
  BO_ONLY,
  NOBODY_OWNS,
  OVERDUE,
  NOT_DUE_YET,
  ADA_FOLLOWS,
];

const EVERY_ISSUE: string[] = [...NOVA_ISSUES, DESIGN_ISSUE];

let nova: Workspace;
let designTeamId: string;
let designViewId: string;
let projectViewId: string;
let rebrandProjectId: string;
let outsider: Principal;

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 86_400_000);
}

const realWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
const realHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');

beforeAll(async () => {
  serveFromTheRealRoutes();
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get: () => 1200,
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get: () => 2400,
  });

  nova = await createWorkspace('Nova');
  const admin = nova.admin;

  const design = await core.createTeam(admin, { name: 'Design', key: 'DSG' });
  designTeamId = design.team.id;

  const builder = await addMember(nova, 'member', {
    name: 'Bo Builder',
    teamIds: [nova.teamId, designTeamId],
  });
  const bo = builder.principal;
  outsider = (await addMember(nova, 'member', { name: 'Cam Contributor' })).principal;

  const seed = async (author: Principal, title: string, extra: Record<string, unknown> = {}) => {
    const { issue } = await core.createIssue(author, {
      teamId: nova.teamId,
      title,
      ...extra,
    });
    return issue.id;
  };

  await seed(bo, ADA_ASSIGNED, { assigneeId: admin.userId });
  await seed(admin, ADA_CREATED, { assigneeId: bo.userId });
  await seed(bo, BO_ONLY, { assigneeId: bo.userId });
  await seed(bo, NOBODY_OWNS);
  await seed(bo, OVERDUE, { assigneeId: bo.userId, dueDate: daysFromNow(-7) });
  await seed(bo, NOT_DUE_YET, { assigneeId: bo.userId, dueDate: daysFromNow(30) });
  const followed = await seed(bo, ADA_FOLLOWS, { assigneeId: bo.userId });
  await core.subscribe(admin, followed);

  const { project } = await core.createProject(admin, {
    name: 'Rebrand',
    teamIds: [designTeamId],
  });

  await core.createIssue(bo, {
    teamId: designTeamId,
    title: DESIGN_ISSUE,
    assigneeId: bo.userId,
    projectId: project.id,
  });

  const { view } = await core.createView(admin, {
    name: 'Design issues',
    filter: {
      filter: { kind: 'group', combinator: 'and', children: [] },
      teamId: designTeamId,
      visibility: 'workspace',
    },
    layout: 'list',
    groupBy: 'state',
    shared: true,
  });
  designViewId = view.id;

  const rebrand = await core.createView(admin, {
    name: 'Rebrand work',
    filter: {
      filter: { kind: 'group', combinator: 'and', children: [] },
      projectId: project.id,
      visibility: 'workspace',
    },
    layout: 'list',
    groupBy: 'state',
    shared: true,
  });
  projectViewId = rebrand.view.id;
  rebrandProjectId = project.id;
});

afterAll(() => {
  if (realFetch !== null) globalThis.fetch = realFetch;
  if (realWidth !== undefined) {
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', realWidth);
  }
  if (realHeight !== undefined) {
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', realHeight);
  }
});

beforeEach(() => {
  serveFromTheRealRoutes();
  requested.length = 0;
  actor = nova.admin;
});

describe('the built in views every workspace ships with', () => {
  it('shows every issue the reader can see under All issues', async () => {
    await openView('virtual:all');

    expect(titlesOnScreen(EVERY_ISSUE)).toEqual(EVERY_ISSUE);
  });

  it('shows only what is assigned to the reader under Assigned to me', async () => {
    await openView('virtual:assigned');

    expect(titlesOnScreen(EVERY_ISSUE)).toEqual([ADA_ASSIGNED]);
  });

  it('shows only what the reader opened under Created by me', async () => {
    await openView('virtual:created');

    expect(titlesOnScreen(EVERY_ISSUE)).toEqual([ADA_CREATED]);
  });

  it('shows what the reader follows under Subscribed', async () => {
    await openView('virtual:subscribed');

    expect(titlesOnScreen(EVERY_ISSUE)).toEqual([ADA_ASSIGNED, ADA_CREATED, ADA_FOLLOWS]);
  });

  it('shows only issues nobody owns under Unassigned', async () => {
    await openView('virtual:unassigned');

    expect(titlesOnScreen(EVERY_ISSUE)).toEqual([NOBODY_OWNS]);
  });

  it('shows only issues past their due date under Overdue', async () => {
    await openView('virtual:overdue');

    expect(titlesOnScreen(EVERY_ISSUE)).toEqual([OVERDUE]);
  });
});

describe('a saved view scoped to a team', () => {
  it('narrows to that team for a reader whose workspace has it', async () => {
    await openView(designViewId);

    expect(issueListParams().get('teamId')).toBe(designTeamId);
    expect(requested.filter((url) => url.startsWith('/api/issues?'))).toHaveLength(1);
    expect(titlesOnScreen(EVERY_ISSUE)).toEqual([DESIGN_ISSUE]);
    expect(scopeBadge()).toBe('Design');
  });

  it('falls back to the workspace when the view names a team the reader cannot see', async () => {
    actor = outsider;

    await openView(designViewId);

    expect(issueListParams().get('teamId')).toBeNull();
    expect(titlesOnScreen(EVERY_ISSUE)).toEqual(NOVA_ISSUES);
    expect(scopeBadge()).toBe('Workspace');
  });

  it('never hands the reader an issue from the team they are not on', async () => {
    actor = outsider;

    await openView(designViewId);

    expect(titlesOnScreen([DESIGN_ISSUE])).toEqual([]);
  });

  it('keeps the team the owner stored when they save a change from that page', async () => {
    actor = outsider;
    const { view } = await core.createView(outsider, {
      name: 'My old team',
      filter: {
        filter: { kind: 'group', combinator: 'and', children: [] },
        teamId: designTeamId,
        visibility: 'private',
      },
      layout: 'list',
      groupBy: 'state',
      shared: false,
    });

    await openView(view.id);
    const user = userEvent.setup();
    await user.click(screen.getByTestId('layout-board'));
    await user.click(await screen.findByTestId('update-view'));

    const reread = await waitFor(async () => {
      const row = await core.getView(outsider, view.id);
      if (row.layout !== 'board') throw new Error('the save has not landed yet');
      return row;
    }, SETTLE);
    expect(reread.state.teamId).toBe(designTeamId);
  });
});

describe('a saved view scoped to a project', () => {
  it('narrows to that project for a reader whose workspace has it', async () => {
    await openView(projectViewId);

    expect(issueListParams().get('projectId')).toBe(rebrandProjectId);
    expect(titlesOnScreen(EVERY_ISSUE)).toEqual([DESIGN_ISSUE]);
    expect(scopeBadge()).toBe('Rebrand');
  });

  it('falls back to the workspace when the reader cannot reach the project', async () => {
    actor = outsider;

    await openView(projectViewId);

    expect(issueListParams().get('projectId')).toBeNull();
    expect(titlesOnScreen(EVERY_ISSUE)).toEqual(NOVA_ISSUES);
    expect(scopeBadge()).toBe('Workspace');
  });
});

describe('a view built in the New view dialog', () => {
  it('opens on the issues the scope it was given actually holds', async () => {
    const user = userEvent.setup();
    render(providers(<CreateViewDialog open onOpenChange={() => undefined} />));

    await user.type(await screen.findByTestId('create-view-name'), 'Engineering triage');
    await user.click(screen.getByTestId('create-view-scope'));
    await user.click(await screen.findByRole('option', { name: 'Nova' }));
    await user.click(screen.getByTestId('create-view-submit'));

    const saved = await waitFor(async () => {
      const rows = await core.listViews(nova.admin);
      const row = rows.find((entry) => entry.name === 'Engineering triage');
      if (row === undefined) throw new Error('the dialog has not saved the view yet');
      return row;
    }, SETTLE);
    expect(saved.state.teamId).toBe(nova.teamId);

    requested.length = 0;
    await openView(saved.id);

    expect(issueListParams().get('teamId')).toBe(nova.teamId);
    expect(titlesOnScreen(EVERY_ISSUE)).toEqual(NOVA_ISSUES);
  });
});

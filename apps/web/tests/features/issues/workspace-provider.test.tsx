import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  mock,
  setSystemTime,
} from 'bun:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '@/components/ui/toast.tsx';
import { HotkeyProvider } from '@/lib/keyboard/index.ts';
import { queryKeys } from '@/lib/query/keys.ts';
import type { Bootstrap } from '@/lib/query/schemas.ts';
import { sprintOptions } from '@/lib/sprint-options.ts';

mock.module('next/navigation', () => ({
  useRouter: () => ({ push: mock(), replace: mock(), refresh: mock(), prefetch: mock() }),
  usePathname: () => '/team/eng/issues',
}));

const realQuickCreate = { ...(await import('@/features/issues/quick-create.tsx')) };
mock.module('@/features/issues/quick-create.tsx', () => ({
  QuickCreateDialog: ({ open }: { readonly open: boolean }) =>
    open ? <span data-testid="quick-create-probe">Create issue</span> : null,
}));

afterAll(() => {
  mock.module('@/features/issues/quick-create.tsx', () => realQuickCreate);
});

const { IssueWorkspaceProvider, toOrgRole, useWorkspace, workspaceFrom } = await import(
  '@/features/issues/workspace-provider.tsx'
);
const { canDeleteIssues, useIssueDeletion } = await import('@/features/issues/issue-deletion.tsx');

const originalFetch = globalThis.fetch;
const fetchBootstrap = mock(() => Promise.resolve(Response.json(bootstrap('member'))));

function bootstrap(role: string): Bootstrap {
  return {
    userId: 'user_1',
    organizationId: 'org_1',
    role,
    teams: [],
    activeTeamId: null,
    states: [],
    labels: [],
    members: [],
    projects: [],
    cycles: [],
    issues: [],
  };
}

function stubBootstrap(): void {
  fetchBootstrap.mockClear();
  globalThis.fetch = fetchBootstrap as unknown as typeof fetch;
}

function Probe() {
  const deletion = useIssueDeletion();
  return <span data-testid="probe">{deletion === null ? 'no provider' : 'provided'}</span>;
}

function mountShell(seedBootstrap = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (seedBootstrap) client.setQueryData(queryKeys.bootstrap(null), bootstrap('member'));
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <HotkeyProvider>
          <IssueWorkspaceProvider>
            <Probe />
          </IssueWorkspaceProvider>
        </HotkeyProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  stubBootstrap();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  setSystemTime();
});

function SprintProbe() {
  const workspace = useWorkspace();
  return (
    <span data-testid="sprint-probe">
      {sprintOptions(workspace.cycles)
        .map((cycle) => cycle.label)
        .join(', ')}
    </span>
  );
}

describe('the issue workspace shell', () => {
  it('updates sprint choices on focus after a week changes without changing cached dates', async () => {
    const start = Date.parse('2026-09-10T00:00:00Z');
    setSystemTime(start);
    const data: Bootstrap = {
      ...bootstrap('member'),
      cycles: [
        {
          id: 'second',
          number: 2,
          name: '',
          teamId: null,
          startsAt: '2026-09-10T00:00:00Z',
          endsAt: '2026-09-17T00:00:00Z',
          completedAt: null,
        },
        {
          id: 'third',
          number: 3,
          name: '',
          teamId: null,
          startsAt: '2026-09-17T00:00:00Z',
          endsAt: '2026-09-24T00:00:00Z',
          completedAt: null,
        },
      ],
    };
    globalThis.fetch = mock(() => Promise.resolve(Response.json(data))) as unknown as typeof fetch;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(queryKeys.bootstrap(null), data);
    render(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <HotkeyProvider>
            <IssueWorkspaceProvider>
              <SprintProbe />
            </IssueWorkspaceProvider>
          </HotkeyProvider>
        </ToastProvider>
      </QueryClientProvider>,
    );
    expect(screen.getByTestId('sprint-probe')).toHaveTextContent(
      'Current sprint (Sprint 2), Sprint 3',
    );
    await act(() => {
      setSystemTime(start + 7 * 86_400_000);
      window.dispatchEvent(new Event('focus'));
    });
    expect(screen.getByTestId('sprint-probe')).toHaveTextContent('Current sprint (Sprint 3)');
    expect(screen.getByTestId('sprint-probe')).not.toHaveTextContent('Sprint 2');
    client.clear();
  });

  it('puts issue deletion in reach of every issue surface below it', async () => {
    mountShell();

    expect((await screen.findByTestId('probe')).textContent).toBe('provided');
  });

  it('opens quick create with C without fetching cached workspace metadata again', async () => {
    mountShell(true);

    await userEvent.setup().keyboard('c');

    expect(screen.getByTestId('quick-create-probe')).toBeInTheDocument();
    expect(fetchBootstrap).not.toHaveBeenCalled();
  });
});

describe('workspaceFrom', () => {
  const noop = () => undefined;

  it('carries the role the server reported into the workspace the UI reads', () => {
    expect(workspaceFrom(bootstrap('member'), noop).role).toBe('member');
    expect(workspaceFrom(bootstrap('admin'), noop).role).toBe('admin');
    expect(workspaceFrom(bootstrap('contributor'), noop).role).toBe('contributor');
  });

  it('falls back to the least powerful role for a payload it does not recognise', () => {
    expect(workspaceFrom(bootstrap('superuser'), noop).role).toBe('guest');
    expect(workspaceFrom(undefined, noop).role).toBe('guest');
    expect(workspaceFrom(undefined, noop).ready).toBe(false);
  });
});

describe('toOrgRole', () => {
  it('keeps a known role and falls back to the least powerful one', () => {
    expect(toOrgRole('admin')).toBe('admin');
    expect(toOrgRole('member')).toBe('member');
    expect(toOrgRole('owner')).toBe('guest');
    expect(toOrgRole(undefined)).toBe('guest');
  });
});

describe('canDeleteIssues', () => {
  it('reads the shared policy rather than a second copy of the rules', () => {
    expect(canDeleteIssues('admin')).toBe(true);
    expect(canDeleteIssues('member')).toBe(true);
    expect(canDeleteIssues('contributor')).toBe(false);
    expect(canDeleteIssues('guest')).toBe(false);
  });
});

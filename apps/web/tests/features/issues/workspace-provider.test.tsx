import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { ToastProvider } from '@/components/ui/toast.tsx';
import { HotkeyProvider } from '@/lib/keyboard/index.ts';
import type { Bootstrap } from '@/lib/query/schemas.ts';

mock.module('next/navigation', () => ({
  useRouter: () => ({ push: mock(), replace: mock(), refresh: mock(), prefetch: mock() }),
  usePathname: () => '/team/eng/issues',
}));

const realQuickCreate = { ...(await import('@/features/issues/quick-create.tsx')) };
mock.module('@/features/issues/quick-create.tsx', () => ({ QuickCreateDialog: () => null }));

afterAll(() => {
  mock.module('@/features/issues/quick-create.tsx', () => realQuickCreate);
});

const { IssueWorkspaceProvider, toOrgRole, workspaceFrom } = await import(
  '@/features/issues/workspace-provider.tsx'
);
const { canDeleteIssues, useIssueDeletion } = await import('@/features/issues/issue-deletion.tsx');

const originalFetch = globalThis.fetch;

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
  globalThis.fetch = mock(() =>
    Promise.resolve(Response.json(bootstrap('member'))),
  ) as unknown as typeof fetch;
}

function Probe() {
  const deletion = useIssueDeletion();
  return <span data-testid="probe">{deletion === null ? 'no provider' : 'provided'}</span>;
}

function mountShell() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
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
});

describe('the issue workspace shell', () => {
  it('puts issue deletion in reach of every issue surface below it', async () => {
    mountShell();

    expect((await screen.findByTestId('probe')).textContent).toBe('provided');
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

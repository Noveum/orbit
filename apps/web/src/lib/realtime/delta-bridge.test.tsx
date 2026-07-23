import { describe, expect, it, mock } from 'bun:test';
import type { SyncAction } from '@orbit/shared/events';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render } from '@testing-library/react';
import { clientId } from '@/lib/query/client-id.ts';
import { queryKeys } from '@/lib/query/keys.ts';
import type { Issue } from '@/lib/query/schemas.ts';

let capturedHandler: ((actions: SyncAction[]) => void) | null = null;

mock.module('@orbit/realtime-client/react', () => ({
  useScopeSubscription: () => undefined,
  useDeltaHandler: (handler: (actions: SyncAction[]) => void) => {
    capturedHandler = handler;
  },
}));

const { DeltaBridge } = await import('./delta-bridge.tsx');

const TEAM = 'team_eng';

function issue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: 'issue_1',
    organizationId: 'org_1',
    teamId: TEAM,
    number: 3,
    identifier: 'ENG-3',
    title: 'Ship the board',
    description: '',
    stateId: 'state_todo',
    priority: 2,
    creatorId: 'user_1',
    assigneeId: null,
    projectId: null,
    milestoneId: null,
    cycleId: null,
    parentId: null,
    estimate: null,
    dueDate: null,
    sortOrder: 1024,
    startedAt: null,
    completedAt: null,
    canceledAt: null,
    stateEnteredAt: '2026-01-01T00:00:00.000Z',
    syncId: 10,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    archivedAt: null,
    labelIds: [],
    ...overrides,
  };
}

function renameAction(originClientId: string, title: string): SyncAction {
  return {
    syncId: 11,
    organizationId: 'org_1',
    scopes: [`team:${TEAM}`],
    action: 'update',
    model: 'issue',
    modelId: 'issue_1',
    data: { id: 'issue_1', title, syncId: 11 },
    actor: { type: 'user', id: 'user_1' },
    at: '2026-01-01T00:00:01.000Z',
    originClientId,
  };
}

function mount(): QueryClient {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(queryKeys.issues(TEAM), [issue()]);
  render(
    <QueryClientProvider client={client}>
      <DeltaBridge organizationId="org_1" teamIds={[TEAM]} />
    </QueryClientProvider>,
  );
  return client;
}

function titleIn(client: QueryClient): string | undefined {
  return client.getQueryData<readonly Issue[]>(queryKeys.issues(TEAM))?.[0]?.title;
}

describe('DeltaBridge origin suppression', () => {
  it('applies a delta that originated in another tab of the same user', () => {
    const client = mount();
    expect(capturedHandler).not.toBeNull();
    act(() => capturedHandler?.([renameAction('other-tab-client-id', 'Renamed elsewhere')]));
    expect(titleIn(client)).toBe('Renamed elsewhere');
  });

  it('skips a delta that this tab originated', () => {
    const client = mount();
    act(() => capturedHandler?.([renameAction(clientId(), 'Echo of my own write')]));
    expect(titleIn(client)).toBe('Ship the board');
  });

  it('applies a delta that carries no origin so older publishers still land', () => {
    const client = mount();
    const { originClientId: _ignored, ...withoutOrigin } = renameAction('unused', 'From the MCP');
    act(() => capturedHandler?.([withoutOrigin]));
    expect(titleIn(client)).toBe('From the MCP');
  });
});

import { describe, expect, it, mock } from 'bun:test';
import type { SyncAction } from '@orbit/shared/events';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render } from '@testing-library/react';
import { clientId } from '@/lib/query/client-id.ts';
import { BOOTSTRAP_ROOT, DOC_ROOT, DOCS_ROOT, queryKeys, VIEWS_ROOT } from '@/lib/query/keys.ts';
import type { Issue } from '@/lib/query/schemas.ts';

let capturedHandler: ((actions: SyncAction[]) => void) | null = null;
let capturedResume: ((since: number) => void) | null = null;
const observed: number[] = [];

mock.module('@orbit/realtime-client/react', () => ({
  useScopeSubscription: () => undefined,
  useDeltaHandler: (handler: (actions: SyncAction[]) => void) => {
    capturedHandler = handler;
  },
  useResumeHandler: (handler: (since: number) => void) => {
    capturedResume = handler;
  },
  useObserveSyncId: () => (syncId: number) => observed.push(syncId),
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

function action(overrides: Partial<SyncAction> = {}): SyncAction {
  return {
    syncId: 11,
    organizationId: 'org_1',
    scopes: [`team:${TEAM}`],
    action: 'update',
    model: 'issue',
    modelId: 'issue_1',
    data: { id: 'issue_1', title: 'Renamed', syncId: 11 },
    actor: { type: 'user', id: 'user_1' },
    at: '2026-01-01T00:00:01.000Z',
    ...overrides,
  };
}

function renameAction(originClientId: string, title: string): SyncAction {
  return { ...action({ data: { id: 'issue_1', title, syncId: 11 } }), originClientId };
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

function trackInvalidations(client: QueryClient): unknown[][] {
  const seen: unknown[][] = [];
  const original = client.invalidateQueries.bind(client);
  client.invalidateQueries = (filters?: Parameters<typeof original>[0]) => {
    const key = filters?.queryKey;
    if (key !== undefined) seen.push([...key]);
    return Promise.resolve();
  };
  return seen;
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

describe('DeltaBridge ordering', () => {
  it('ignores a delta whose sync id is not newer than the cached row', () => {
    const client = mount();
    act(() =>
      capturedHandler?.([
        action({ syncId: 12, data: { id: 'issue_1', title: 'Newest', syncId: 12 } }),
        action({ syncId: 9, data: { id: 'issue_1', title: 'Stale replay', syncId: 9 } }),
      ]),
    );
    expect(titleIn(client)).toBe('Newest');
  });

  it('keeps a delta for another team out of this team list', () => {
    const client = mount();
    act(() =>
      capturedHandler?.([
        action({
          modelId: 'issue_other',
          data: { ...issue({ id: 'issue_other', teamId: 'team_design' }), syncId: 30 },
        }),
      ]),
    );
    expect(client.getQueryData<readonly Issue[]>(queryKeys.issues(TEAM))).toHaveLength(1);
  });
});

describe('DeltaBridge root invalidation', () => {
  it('invalidates the bootstrap root once for a burst of org config models', () => {
    const client = mount();
    const seen = trackInvalidations(client);
    act(() =>
      capturedHandler?.([
        action({ model: 'workflow_state', modelId: 'state_1', data: { id: 'state_1' } }),
        action({ model: 'label', modelId: 'label_1', data: { id: 'label_1' } }),
        action({ model: 'team_member', modelId: 'tm_1', data: { id: 'tm_1' } }),
      ]),
    );
    expect(seen).toEqual([[BOOTSTRAP_ROOT]]);
  });

  it('invalidates the views root for a view delta', () => {
    const client = mount();
    const seen = trackInvalidations(client);
    act(() => capturedHandler?.([action({ model: 'view', modelId: 'view_1', data: {} })]));
    expect(seen).toEqual([[VIEWS_ROOT]]);
  });

  it('invalidates docs once and each touched doc for a doc burst', () => {
    const client = mount();
    const seen = trackInvalidations(client);
    act(() =>
      capturedHandler?.([
        action({ model: 'doc', modelId: 'doc_1', data: {} }),
        action({ model: 'doc_collection', modelId: 'col_1', data: {} }),
      ]),
    );
    expect(seen).toEqual([[DOCS_ROOT], [DOC_ROOT, 'doc_1']]);
  });

  it('leaves every root alone for a delta the bridge patches in place', () => {
    const client = mount();
    const seen = trackInvalidations(client);
    act(() => capturedHandler?.([action()]));
    expect(seen).toEqual([]);
  });
});

describe('DeltaBridge reconnect backfill', () => {
  it('replays the catch up endpoint instead of refetching the visible list', async () => {
    const client = mount();
    const seen = trackInvalidations(client);
    observed.length = 0;
    const requested: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((input: RequestInfo | URL) => {
      requested.push(String(input));
      return Promise.resolve(
        Response.json({
          syncId: 42,
          truncated: false,
          actions: [
            action({ syncId: 42, data: { id: 'issue_1', title: 'Caught up', syncId: 42 } }),
          ],
        }),
      );
    }) as typeof fetch;

    try {
      await act(async () => {
        capturedResume?.(17);
        await Promise.resolve();
      });
      await act(async () => {
        await Promise.resolve();
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(requested).toEqual(['/api/sync?since=17']);
    expect(titleIn(client)).toBe('Caught up');
    expect(observed).toContain(42);
    expect(seen).toEqual([]);
  });
});

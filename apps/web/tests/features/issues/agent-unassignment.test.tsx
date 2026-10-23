import { afterEach, describe, expect, it, mock } from 'bun:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { ToastProvider } from '@/components/ui/toast.tsx';
import { groupIssues } from '@/features/filters/grouping.ts';
import type { WorkspaceData } from '@/features/issues/workspace-provider.tsx';
import * as workspaceProvider from '@/features/issues/workspace-provider.tsx';
import { HotkeyProvider } from '@/lib/keyboard/index.ts';
import { queryKeys } from '@/lib/query/keys.ts';
import type { Issue, IssueDetail, Member } from '@/lib/query/schemas.ts';
import { flattenIssuePages, type IssuePages } from '@/lib/query/sync.ts';
import { useMoveIssue } from '@/lib/query/use-issues.ts';
import { restoreModulesAfterThisFile } from '../../../tests-support.ts';

await restoreModulesAfterThisFile(['@/features/issues/workspace-provider.tsx']);

const member: Member = {
  id: 'member_1',
  name: 'Responsible person',
  email: 'owner@orbit.test',
  image: null,
  handle: null,
  role: 'member',
};

const workspace: WorkspaceData = {
  ready: true,
  userId: member.id,
  role: 'admin',
  teams: [],
  states: [],
  labels: [],
  members: [member],
  projects: [],
  cycles: [],
  seedIssues: [],
  stateById: new Map(),
  labelById: new Map(),
  memberById: new Map([[member.id, member]]),
  openQuickCreate: () => undefined,
};

mock.module('@/features/issues/workspace-provider.tsx', () => ({
  ...workspaceProvider,
  useWorkspace: () => workspace,
}));

const { IssueProperties } = await import('@/features/issues/issue-properties.tsx');
const { AssigneeControl } = await import('@/features/issues/card-controls.tsx');
const { BulkEditBar } = await import('@/features/issues/bulk-edit-bar.tsx');
const { planDrop } = await import('@/features/issues/board.tsx');

const nativeFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = nativeFetch;
});

function assignedIssue(type: 'agent' | 'user', id = 'issue_1'): Issue {
  const owner = {
    type: 'user' as const,
    id: member.id,
    name: member.name,
    avatar: null,
    deleted: false,
  };
  return {
    id,
    organizationId: 'org_1',
    teamId: 'team_1',
    number: 1,
    identifier: `ENG-${id}`,
    title: 'Assigned work',
    description: '',
    stateId: 'state_1',
    priority: 0,
    creatorId: member.id,
    assigneeId: type === 'user' ? member.id : null,
    assigneeUserId: type === 'user' ? member.id : null,
    assigneeAgentId: type === 'agent' ? 'agent_1' : null,
    assignee:
      type === 'user' ? owner : { ...owner, type: 'agent', id: 'agent_1', name: 'Build bot' },
    ownerUserId: owner.id,
    owner,
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
    syncId: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    archivedAt: null,
    labelIds: [],
  };
}

function clearedIssue(issue: Issue): Issue {
  return {
    ...issue,
    assigneeId: null,
    assigneeUserId: null,
    assigneeAgentId: null,
    assignee: null,
  };
}

function assertCleared(issue: Issue | undefined, original: Issue): void {
  expect(issue).toMatchObject({
    assigneeId: null,
    assigneeUserId: null,
    assigneeAgentId: null,
    assignee: null,
    ownerUserId: original.ownerUserId,
    owner: original.owner,
  });
}

function harness(rows: readonly Issue[]) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  });
  const listKey = queryKeys.issues('team_1');
  client.setQueryData<IssuePages>(listKey, {
    pages: [{ issues: [...rows], nextCursor: null }],
    pageParams: [null],
  });
  for (const issue of rows) {
    client.setQueryData<IssueDetail>(queryKeys.issue(issue.identifier), {
      issue,
      descriptionHtml: '',
      activity: [],
      activityCursor: null,
      subIssues: [],
      parent: null,
      subscribed: false,
      attachments: [],
    });
  }
  const requests: { url: string; body: unknown; release: () => void }[] = [];
  globalThis.fetch = mock((url: string | URL | Request, init?: RequestInit) => {
    if (init?.method === 'PATCH' || init?.method === 'POST') {
      const issue = rows.find((row) => String(url).includes(`/api/issues/${row.id}`));
      if (issue === undefined) throw new Error('Unexpected issue mutation');
      return new Promise<Response>((resolve) => {
        requests.push({
          url: String(url),
          body: JSON.parse(String(init.body)) as unknown,
          release: () =>
            resolve(
              Response.json({ issue: { ...clearedIssue(issue), syncId: 2 }, rebalanced: [] }),
            ),
        });
      });
    }
    return Promise.resolve(Response.json({ issues: rows.map(clearedIssue), nextCursor: null }));
  }) as unknown as typeof fetch;
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <ToastProvider>
          <HotkeyProvider>{children}</HotkeyProvider>
        </ToastProvider>
      </QueryClientProvider>
    );
  }
  return {
    client,
    requests,
    Wrapper,
    cached: (id: string) => {
      const pages = client.getQueryData<IssuePages>(listKey);
      return pages === undefined
        ? undefined
        : flattenIssuePages(pages).find((row) => row.id === id);
    },
    finish: async () => {
      await act(() => {
        for (const request of requests) request.release();
      });
      await waitFor(() => expect(client.isMutating()).toBe(0));
      client.clear();
    },
  };
}

describe('assignment clearing through issue controls', () => {
  it.each([
    ['properties', 'agent'],
    ['properties', 'user'],
    ['card', 'agent'],
    ['card', 'user'],
    ['bulk', 'agent'],
  ] as const)(
    'clears assignments through %s for a %s without replacing the owner',
    async (surface, type) => {
      const assigned = assignedIssue(type);
      const human = assignedIssue('user', 'issue_2');
      const rows = surface === 'bulk' ? [assigned, human] : [assigned];
      const { client, Wrapper, requests, cached, finish } = harness(rows);
      const user = userEvent.setup();
      const controls = {
        properties: <IssueProperties issue={assigned} />,
        card: <AssigneeControl issue={assigned} assignee={undefined} />,
        bulk: <BulkEditBar states={[]} issues={rows} onClear={() => undefined} />,
      };
      const triggers = {
        properties: () => screen.getByTestId('property-assignee'),
        card: () => screen.getByTestId(`card-assignee-${assigned.identifier}`),
        bulk: () => screen.getByRole('button', { name: 'Assignee' }),
      };
      const rendered = render(<Wrapper>{controls[surface]}</Wrapper>);
      try {
        await user.click(triggers[surface]());
        await user.click(screen.getByRole('menuitemradio', { name: 'No assignee' }));
        await waitFor(() => expect(requests).toHaveLength(rows.length));
        expect(requests.map(({ body }) => body)).toEqual(rows.map(() => ({ assigneeId: null })));
        for (const row of rows) {
          assertCleared(cached(row.id), row);
          assertCleared(
            client.getQueryData<IssueDetail>(queryKeys.issue(row.identifier))?.issue,
            row,
          );
        }
      } finally {
        await finish();
        rendered.unmount();
      }
    },
  );

  it('moves an agent issue to the unassigned board column with a canonical optimistic clear', async () => {
    const agent = assignedIssue('agent');
    const groups = groupIssues(
      [agent],
      'assignee',
      { states: [], members: [], projects: [], cycles: [], labels: [] },
      { showEmptyGroups: true, ordering: 'manual' },
    );
    const plan = planDrop(groups, [agent], agent.id, 'none', 'assignee');
    expect(plan).not.toBeNull();
    if (plan === null) throw new Error('Unassigned drop should be available');
    const { Wrapper, requests, cached, finish } = harness([agent]);
    const rendered = renderHook(useMoveIssue, { wrapper: Wrapper });
    try {
      act(() => rendered.result.current.mutate(plan));
      await waitFor(() => expect(requests).toHaveLength(1));
      expect(requests[0]?.url).toBe(`/api/issues/${agent.id}/move`);
      expect(requests[0]?.body).toEqual({ assigneeId: null, beforeId: null, afterId: null });
      assertCleared(cached(agent.id), agent);
    } finally {
      await finish();
      rendered.unmount();
    }
  });
});

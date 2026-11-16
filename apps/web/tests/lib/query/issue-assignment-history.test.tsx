import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { issueUpdateSchema } from '@orbit/shared/validators';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ToastProvider } from '@/components/ui/toast.tsx';
import {
  clearTabHistory,
  getTabRedoStack,
  getTabUndoStack,
  pushTestRedoEntry,
  recordTabPropertyChange,
  useIssuePropertyUndo,
} from '@/features/issues/use-issue-property-undo.ts';
import { HotkeyProvider } from '@/lib/keyboard/provider.tsx';
import { queryKeys } from '@/lib/query/keys.ts';
import type { Issue } from '@/lib/query/schemas.ts';
import type { IssuePages } from '@/lib/query/sync.ts';
import { captureIssueHistory } from '@/lib/query/use-issues.ts';

const originalFetch = globalThis.fetch;
const humanIssue: Issue = {
  id: 'assignment_history_issue',
  organizationId: 'assignment_history_org',
  teamId: 'assignment_history_team',
  number: 1,
  identifier: 'HISTORY-1',
  title: 'Assignment history',
  description: '',
  stateId: 'history_state',
  priority: 0,
  creatorId: 'history_human',
  assigneeId: 'history_human',
  assigneeUserId: 'history_human',
  assigneeAgentId: null,
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
  syncId: 1,
  createdAt: '2026-10-06T00:00:00.000Z',
  updatedAt: '2026-10-06T00:00:00.000Z',
  archivedAt: null,
  stateEnteredAt: '2026-10-06T00:00:00.000Z',
  labelIds: [],
  reviewerIds: [],
};

beforeEach(clearTabHistory);
afterEach(() => {
  globalThis.fetch = originalFetch;
  clearTabHistory();
});

describe('Human assignment history canonical conditions', () => {
  it.each([null, 'another_human'])('guards undo and redo for an assignment to %s', (assigneeId) => {
    const entry = captureIssueHistory(humanIssue, { assigneeId }, 1);
    expect(entry?.expectedForUndo).toMatchObject({ assigneeId, assigneeAgentId: null });
    expect(entry?.expectedForRedo).toMatchObject({
      assigneeId: humanIssue.assigneeId,
      assigneeAgentId: null,
    });
  });

  it.each(['undo', 'redo'] as const)(
    'sends a canonical %s guard and preserves an intervening Agent assignment on conflict',
    async (operation) => {
      const unassigned: Issue = {
        ...humanIssue,
        assigneeId: null,
        assigneeUserId: null,
      };
      const entry =
        operation === 'undo'
          ? captureIssueHistory(humanIssue, { assigneeId: null }, 1)
          : captureIssueHistory(unassigned, { assigneeId: humanIssue.assigneeId }, 1);
      if (entry === undefined) throw new Error('Missing assignment history.');
      if (operation === 'undo') recordTabPropertyChange(entry);
      else pushTestRedoEntry(entry);
      const current: Issue = {
        ...unassigned,
        assigneeAgentId: 'intervening_agent',
        assignee: {
          type: 'agent',
          id: 'intervening_agent',
          name: 'Current agent',
          avatar: null,
          deleted: false,
        },
        syncId: 3,
      };
      const client = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      });
      const listKey = queryKeys.issues(current.teamId);
      client.setQueryData<IssuePages>(listKey, {
        pages: [{ issues: [current], nextCursor: null }],
        pageParams: [null],
      });
      let sent: ReturnType<typeof issueUpdateSchema.parse> | undefined;
      globalThis.fetch = ((_input: string | URL | Request, init?: RequestInit) => {
        if (init?.method !== 'PATCH') throw new Error('Unexpected assignment history request.');
        sent = issueUpdateSchema.parse(JSON.parse(String(init.body)));
        return Promise.resolve(
          Response.json(
            {
              error: {
                code: 'conflict',
                message: 'Cannot undo: agent assignee was changed by another update.',
              },
            },
            { status: 409 },
          ),
        );
      }) as typeof fetch;
      const wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>
          <ToastProvider>
            <HotkeyProvider>{children}</HotkeyProvider>
          </ToastProvider>
        </QueryClientProvider>
      );
      const history = renderHook(useIssuePropertyUndo, { wrapper });
      await act(async () => {
        await history.result.current[operation]();
      });
      expect(sent?.expected).toMatchObject({ assigneeId: null, assigneeAgentId: null });
      expect(client.getQueryData<IssuePages>(listKey)?.pages[0]?.issues[0]).toMatchObject({
        assigneeId: null,
        assigneeAgentId: current.assigneeAgentId,
        assignee: current.assignee,
      });
      expect(getTabUndoStack()).toHaveLength(0);
      expect(getTabRedoStack()).toHaveLength(0);
      history.unmount();
      client.clear();
    },
  );
});

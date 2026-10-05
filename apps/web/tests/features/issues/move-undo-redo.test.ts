import '../../../tests-preload.ts';

import { beforeEach, describe, expect, it } from 'bun:test';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import React from 'react';

import { ToastProvider } from '@/components/ui/toast.tsx';
import type { IssueGroup } from '@/features/filters/grouping.ts';
import { dragSourceSnapshotFor, planDrop } from '@/features/issues/board.tsx';
import {
  clearTabHistory,
  getTabRedoStack,
  getTabUndoStack,
  type MoveUndoEntry,
  recordTabMove,
  useIssuePropertyUndo,
} from '@/features/issues/use-issue-property-undo.ts';
import { HotkeyProvider } from '@/lib/keyboard/provider.tsx';
import type { Issue } from '@/lib/query/schemas.ts';
import type { MoveInput } from '@/lib/query/use-issues.ts';

const mockIssue: Issue = {
  id: 'issue_move_1',
  organizationId: 'org_move',
  teamId: 'team_move',
  number: 10,
  identifier: 'MOVE-10',
  title: 'Move test issue',
  description: 'Move test issue description',
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
  sortOrder: 500,
  startedAt: null,
  completedAt: null,
  canceledAt: null,
  syncId: 1,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  archivedAt: null,
  stateEnteredAt: '2026-10-01T00:00:00.000Z',
  labelIds: [],
  reviewerIds: [],
};

const issueBefore = {
  ...mockIssue,
  id: 'issue_before',
  identifier: 'MOVE-9',
  sortOrder: 400,
};

const issueAfter = {
  ...mockIssue,
  id: 'issue_after',
  identifier: 'MOVE-11',
  sortOrder: 600,
};

const sourceGroup = {
  id: 'state_todo',
  title: 'Todo',
  color: null,
  category: null,
  issues: [issueBefore, mockIssue, issueAfter],
  subGroups: [],
  total: 3,
} as IssueGroup;

const destinationIssue = {
  ...mockIssue,
  id: 'issue_destination',
  identifier: 'MOVE-20',
  stateId: 'state_done',
  sortOrder: 800,
};

const destinationGroup = {
  id: 'state_done',
  title: 'Done',
  color: null,
  category: null,
  issues: [destinationIssue],
  subGroups: [],
  total: 1,
} as IssueGroup;

const groups = [sourceGroup, destinationGroup];

function moveInput(overrides: Partial<MoveInput> = {}): MoveInput {
  return {
    issue: mockIssue,
    stateId: 'state_done',
    beforeId: null,
    afterId: destinationIssue.id,
    beforeOrder: null,
    afterOrder: destinationIssue.sortOrder,
    ...overrides,
  };
}

function moveEntry(overrides: Partial<MoveUndoEntry> = {}): MoveUndoEntry {
  const forward = moveInput({
    stateId: 'state_done',
    beforeId: null,
    afterId: destinationIssue.id,
    beforeOrder: null,
    afterOrder: destinationIssue.sortOrder,
  });

  const inverse = moveInput({
    stateId: 'state_todo',
    beforeId: issueBefore.id,
    afterId: issueAfter.id,
    beforeOrder: issueBefore.sortOrder,
    afterOrder: issueAfter.sortOrder,
  });

  return {
    sequence: 1,
    issue: mockIssue,
    propertyLabel: 'Move',
    forward,
    inverse,
    expectedForUndo: {
      stateId: 'state_done',
      sortOrder: 800,
    },
    expectedForRedo: {
      stateId: 'state_todo',
      sortOrder: 500,
    },
    ...overrides,
  };
}

describe('Issue move undo and redo', () => {
  beforeEach(() => {
    clearTabHistory();
  });

  it('plans a move into another state with the destination neighbours', () => {
    const planned = planDrop(
      groups,
      [mockIssue],
      mockIssue.id,
      destinationIssue.id,
      'state',
      undefined,
      true,
    );

    expect(planned).toBeDefined();

    if (planned === null) return;

    expect(planned.issue.id).toBe(mockIssue.id);
    expect(planned.stateId).toBe('state_done');
    expect(planned.beforeId).toBe(null);
    expect(planned.afterId).toBe(destinationIssue.id);
    expect(planned.beforeOrder).toBe(null);
    expect(planned.afterOrder).toBe(destinationIssue.sortOrder);
  });

  it('captures the original source state and neighbours before a move', () => {
    const snapshot = dragSourceSnapshotFor(groups, mockIssue.id, 'state', undefined);

    expect(snapshot.kind).toBe('found');

    if (snapshot.kind !== 'found') return;

    expect(snapshot.issue.id).toBe(mockIssue.id);
    expect(snapshot.source.groupId).toBe(sourceGroup.id);
    expect(snapshot.source.position).toBe(2);
  });

  it('creates a move history entry only after the successful move', () => {
    const entry = moveEntry();

    recordTabMove(entry);

    const stack = getTabUndoStack();

    expect(stack.length).toBe(0);
    expect(getTabRedoStack().length).toBe(0);

    expect(entry.propertyLabel).toBe('Move');
    expect(entry.forward.stateId).toBe('state_done');
    expect(entry.inverse.stateId).toBe('state_todo');
  });

  it('stores the move entry in shared history with its sequence', () => {
    const entry = moveEntry({ sequence: 42 });

    recordTabMove(entry);

    expect(entry.sequence).toBe(42);
    expect(entry.forward.stateId).toBe('state_done');
    expect(entry.inverse.stateId).toBe('state_todo');
    expect(entry.expectedForUndo.stateId).toBe('state_done');
    expect(entry.expectedForRedo.stateId).toBe('state_todo');
  });

  it('undoes a successful move and places the entry into redo history', async () => {
    const originalFetch = globalThis.fetch;

    globalThis.fetch = ((_url: string | URL | Request, init?: RequestInit) => {
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;

      expect(body?.stateId).toBe('state_todo');
      expect(body?.expected?.stateId).toBe('state_done');

      return Promise.resolve(
        new Response(
          JSON.stringify({
            issue: {
              ...mockIssue,
              stateId: 'state_todo',
              sortOrder: 500,
              syncId: 2,
            },
            rebalanced: [],
          }),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
            },
          },
        ),
      );
    }) as typeof globalThis.fetch;

    const queryClient = new QueryClient({
      defaultOptions: {
        mutations: {
          retry: false,
        },
      },
    });

    const wrapper = ({ children }: { readonly children: React.ReactNode }) =>
      React.createElement(
        QueryClientProvider,
        { client: queryClient },
        React.createElement(
          HotkeyProvider,
          null,
          React.createElement(ToastProvider, null, children),
        ),
      );

    try {
      recordTabMove(moveEntry());

      const { result, unmount } = renderHook(() => useIssuePropertyUndo(), {
        wrapper,
      });

      await act(async () => {
        await result.current.undo();
      });

      await waitFor(() => {
        expect(getTabUndoStack().length).toBe(0);
        expect(getTabRedoStack().length).toBe(0);
      });

      unmount();

      await act(async () => {
        await queryClient.cancelQueries();
      });
    } finally {
      globalThis.fetch = originalFetch;
      queryClient.clear();
    }
  });

  it('refreshes redo expected position from the settled issue after undo', async () => {
    const originalFetch = globalThis.fetch;
    const requestBodies: Array<{
      stateId?: string;
      expected?: {
        stateId?: string;
        sortOrder?: number;
      };
    }> = [];

    globalThis.fetch = ((_url: string | URL | Request, init?: RequestInit) => {
      const body =
        typeof init?.body === 'string'
          ? (JSON.parse(init.body) as {
              stateId?: string;
              expected?: {
                stateId?: string;
                sortOrder?: number;
              };
            })
          : undefined;

      if (body !== undefined) {
        requestBodies.push(body);
      }

      return Promise.resolve(
        new Response(
          JSON.stringify({
            issue: {
              ...mockIssue,
              stateId: 'state_todo',
              sortOrder: 450,
              syncId: 2,
            },
            rebalanced: [],
          }),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
            },
          },
        ),
      );
    }) as typeof globalThis.fetch;

    const queryClient = new QueryClient({
      defaultOptions: {
        mutations: {
          retry: false,
        },
      },
    });

    const wrapper = ({ children }: { readonly children: React.ReactNode }) =>
      React.createElement(
        QueryClientProvider,
        { client: queryClient },
        React.createElement(
          HotkeyProvider,
          null,
          React.createElement(ToastProvider, null, children),
        ),
      );

    try {
      recordTabMove(moveEntry());

      const { result, unmount } = renderHook(() => useIssuePropertyUndo(), {
        wrapper,
      });

      await act(async () => {
        await result.current.undo();
        await result.current.redo();
      });

      expect(requestBodies).toHaveLength(2);

      expect(requestBodies[0]).toMatchObject({
        stateId: 'state_todo',
        expected: {
          stateId: 'state_done',
          sortOrder: 800,
        },
      });

      expect(requestBodies[1]).toMatchObject({
        stateId: 'state_done',
        expected: {
          stateId: 'state_todo',
          sortOrder: 450,
        },
      });

      unmount();

      await act(async () => {
        await queryClient.cancelQueries();
      });
    } finally {
      globalThis.fetch = originalFetch;
      queryClient.clear();
    }
  });

  it('refreshes undo expected position from the settled issue after redo', async () => {
    const originalFetch = globalThis.fetch;
    const requestBodies: Array<{
      stateId?: string;
      expected?: {
        stateId?: string;
        sortOrder?: number;
      };
    }> = [];

    globalThis.fetch = ((_url: string | URL | Request, init?: RequestInit) => {
      const body =
        typeof init?.body === 'string'
          ? (JSON.parse(init.body) as {
              stateId?: string;
              expected?: {
                stateId?: string;
                sortOrder?: number;
              };
            })
          : undefined;

      if (body !== undefined) {
        requestBodies.push(body);
      }

      if (requestBodies.length === 1) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              issue: {
                ...mockIssue,
                stateId: 'state_todo',
                sortOrder: 450,
                syncId: 2,
              },
              rebalanced: [],
            }),
            {
              status: 200,
              headers: {
                'Content-Type': 'application/json',
              },
            },
          ),
        );
      }

      return Promise.resolve(
        new Response(
          JSON.stringify({
            issue: {
              ...mockIssue,
              stateId: 'state_done',
              sortOrder: 900,
              syncId: 3,
            },
            rebalanced: [],
          }),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
            },
          },
        ),
      );
    }) as typeof globalThis.fetch;

    const queryClient = new QueryClient({
      defaultOptions: {
        mutations: {
          retry: false,
        },
      },
    });

    const wrapper = ({ children }: { readonly children: React.ReactNode }) =>
      React.createElement(
        QueryClientProvider,
        { client: queryClient },
        React.createElement(
          HotkeyProvider,
          null,
          React.createElement(ToastProvider, null, children),
        ),
      );

    try {
      recordTabMove(moveEntry());

      const { result, unmount } = renderHook(() => useIssuePropertyUndo(), {
        wrapper,
      });

      await act(async () => {
        await result.current.undo();
        await result.current.redo();
      });

      expect(requestBodies).toHaveLength(2);

      expect(requestBodies[0]).toMatchObject({
        stateId: 'state_todo',
        expected: {
          stateId: 'state_done',
          sortOrder: 800,
        },
      });

      expect(requestBodies[1]).toMatchObject({
        stateId: 'state_done',
        expected: {
          stateId: 'state_todo',
          sortOrder: 450,
        },
      });

      unmount();

      await act(async () => {
        await queryClient.cancelQueries();
      });
    } finally {
      globalThis.fetch = originalFetch;
      queryClient.clear();
    }
  });

  it('preserves chronological order when move entries resolve out of order', () => {
    const first = moveEntry({
      sequence: 1,
      forward: moveInput({
        stateId: 'state_in_progress',
      }),
    });

    const second = moveEntry({
      sequence: 2,
      forward: moveInput({
        stateId: 'state_done',
      }),
    });

    const third = moveEntry({
      sequence: 3,
      forward: moveInput({
        stateId: 'state_canceled',
      }),
    });

    recordTabMove(second);
    recordTabMove(third);
    recordTabMove(first);

    expect(first.sequence).toBe(1);
    expect(second.sequence).toBe(2);
    expect(third.sequence).toBe(3);
  });

  it('builds a move undo entry whose inverse restores the original source placement', () => {
    const entry = moveEntry();

    expect(entry.inverse.stateId).toBe('state_todo');
    expect(entry.inverse.beforeId).toBe(issueBefore.id);
    expect(entry.inverse.afterId).toBe(issueAfter.id);
    expect(entry.inverse.beforeOrder).toBe(issueBefore.sortOrder);
    expect(entry.inverse.afterOrder).toBe(issueAfter.sortOrder);
  });

  it('uses expected state for undo and expected source state for redo', () => {
    const entry = moveEntry();

    expect(entry.expectedForUndo).toEqual({
      stateId: 'state_done',
      sortOrder: 800,
    });

    expect(entry.expectedForRedo).toEqual({
      stateId: 'state_todo',
      sortOrder: 500,
    });
  });
});

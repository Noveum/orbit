import '../../../tests-preload.ts';

import { beforeEach, describe, expect, it, mock } from 'bun:test';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import React from 'react';

import type { IssueGroup } from '@/features/filters/grouping.ts';
import type { MoveUndoEntry } from '@/features/issues/use-issue-property-undo.ts';
import type { Issue } from '@/lib/query/schemas.ts';
import type { MoveInput } from '@/lib/query/use-issues.ts';

const toast = mock();

mock.module('@/components/ui/toast.tsx', () => ({
  useToast: () => ({ toast, dismiss: mock() }),
}));

const { dragSourceSnapshotFor, planDrop } = await import('@/features/issues/board.tsx');

const {
  clearTabHistory,
  getTabRedoStackForTests,
  getTabUndoStackForTests,
  recordTabMove,
  useIssuePropertyUndo,
} = await import('@/features/issues/use-issue-property-undo.ts');

const { HotkeyProvider } = await import('@/lib/keyboard/provider.tsx');

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
      assigneeId: null,
      projectId: null,
      cycleId: null,
      priority: 2,
    },
    expectedForRedo: {
      stateId: 'state_todo',
      sortOrder: 500,
      assigneeId: null,
      projectId: null,
      cycleId: null,
      priority: 2,
    },
    ...overrides,
  };
}

function createWrapper(queryClient: QueryClient) {
  return ({ children }: { readonly children: React.ReactNode }) =>
    React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(HotkeyProvider, null, children),
    );
}

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      mutations: {
        retry: false,
      },
    },
  });
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

describe('Issue move undo and redo', () => {
  beforeEach(() => {
    clearTabHistory();
    toast.mockClear();
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

  it('records a move entry in the actual shared undo history', () => {
    const entry = moveEntry();

    recordTabMove(entry);

    const undoStack = getTabUndoStackForTests();
    const redoStack = getTabRedoStackForTests();

    expect(undoStack).toHaveLength(1);
    expect(redoStack).toHaveLength(0);
    expect(undoStack[0]).toEqual(entry);
  });

  it('preserves move ordering in the actual shared history', () => {
    const first = moveEntry({ sequence: 1 });
    const second = moveEntry({ sequence: 2 });
    const third = moveEntry({ sequence: 3 });

    recordTabMove(second);
    recordTabMove(third);
    recordTabMove(first);

    const undoStack = getTabUndoStackForTests();

    expect(undoStack.map((entry) => entry.sequence)).toEqual([1, 2, 3]);
  });

  it('undoes a successful move and transfers the entry to actual redo history', async () => {
    const originalFetch = globalThis.fetch;

    globalThis.fetch = ((_url: string | URL | Request, init?: RequestInit) => {
      const body =
        typeof init?.body === 'string'
          ? (JSON.parse(init.body) as {
              stateId?: string;
              expected?: {
                stateId?: string;
                sortOrder?: number;
                assigneeId?: string | null;
                projectId?: string | null;
                cycleId?: string | null;
                priority?: number;
              };
            })
          : undefined;

      expect(body?.stateId).toBe('state_todo');
      expect(body?.expected?.stateId).toBe('state_done');
      expect(body?.expected?.sortOrder).toBe(800);
      expect(body?.expected?.assigneeId).toBe(null);
      expect(body?.expected?.projectId).toBe(null);
      expect(body?.expected?.cycleId).toBe(null);
      expect(body?.expected?.priority).toBe(2);

      return Promise.resolve(
        response({
          issue: {
            ...mockIssue,
            stateId: 'state_todo',
            sortOrder: 500,
            syncId: 2,
          },
          rebalanced: [],
        }),
      );
    }) as typeof globalThis.fetch;

    const queryClient = createQueryClient();

    try {
      const entry = moveEntry();

      recordTabMove(entry);

      const { result, unmount } = renderHook(() => useIssuePropertyUndo(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.undo();
      });

      const undoStack = getTabUndoStackForTests();
      const redoStack = getTabRedoStackForTests();

      expect(undoStack).toHaveLength(0);
      expect(redoStack).toHaveLength(1);
      expect(redoStack[0]).toMatchObject({
        propertyLabel: 'Move',
        issue: expect.objectContaining({
          stateId: 'state_todo',
          sortOrder: 500,
        }),
        expectedForRedo: {
          stateId: 'state_todo',
          sortOrder: 500,
          assigneeId: null,
          projectId: null,
          cycleId: null,
          priority: 2,
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

  it('refreshes redo expected position from the settled issue after undo', async () => {
    const originalFetch = globalThis.fetch;

    const requestBodies: Array<{
      stateId?: string;
      expected?: {
        stateId?: string;
        sortOrder?: number;
        assigneeId?: string | null;
        projectId?: string | null;
        cycleId?: string | null;
        priority?: number;
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
                assigneeId?: string | null;
                projectId?: string | null;
                cycleId?: string | null;
                priority?: number;
              };
            })
          : undefined;

      if (body !== undefined) {
        requestBodies.push(body);
      }

      return Promise.resolve(
        response({
          issue: {
            ...mockIssue,
            stateId: 'state_todo',
            sortOrder: 450,
            syncId: 2,
          },
          rebalanced: [],
        }),
      );
    }) as typeof globalThis.fetch;

    const queryClient = createQueryClient();

    try {
      recordTabMove(moveEntry());

      const { result, unmount } = renderHook(() => useIssuePropertyUndo(), {
        wrapper: createWrapper(queryClient),
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
          assigneeId: null,
          projectId: null,
          cycleId: null,
          priority: 2,
        },
      });

      expect(requestBodies[1]).toMatchObject({
        stateId: 'state_done',
        expected: {
          stateId: 'state_todo',
          sortOrder: 450,
          assigneeId: null,
          projectId: null,
          cycleId: null,
          priority: 2,
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
        assigneeId?: string | null;
        projectId?: string | null;
        cycleId?: string | null;
        priority?: number;
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
                assigneeId?: string | null;
                projectId?: string | null;
                cycleId?: string | null;
                priority?: number;
              };
            })
          : undefined;

      if (body !== undefined) {
        requestBodies.push(body);
      }

      if (requestBodies.length === 1) {
        return Promise.resolve(
          response({
            issue: {
              ...mockIssue,
              stateId: 'state_todo',
              sortOrder: 450,
              syncId: 2,
            },
            rebalanced: [],
          }),
        );
      }

      return Promise.resolve(
        response({
          issue: {
            ...mockIssue,
            stateId: 'state_done',
            sortOrder: 900,
            syncId: 3,
          },
          rebalanced: [],
        }),
      );
    }) as typeof globalThis.fetch;

    const queryClient = createQueryClient();

    try {
      recordTabMove(moveEntry());

      const { result, unmount } = renderHook(() => useIssuePropertyUndo(), {
        wrapper: createWrapper(queryClient),
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
          assigneeId: null,
          projectId: null,
          cycleId: null,
          priority: 2,
        },
      });

      expect(requestBodies[1]).toMatchObject({
        stateId: 'state_done',
        expected: {
          stateId: 'state_todo',
          sortOrder: 450,
          assigneeId: null,
          projectId: null,
          cycleId: null,
          priority: 2,
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

  it('restores a move to undo history and shows a toast when undo fails', async () => {
    const originalFetch = globalThis.fetch;

    globalThis.fetch = ((_url: string | URL | Request, _init?: RequestInit) =>
      Promise.resolve(
        response(
          {
            error: 'Cannot undo: position was changed by another update.',
          },
          409,
        ),
      )) as typeof globalThis.fetch;

    const queryClient = createQueryClient();

    try {
      recordTabMove(moveEntry());

      const { result, unmount } = renderHook(() => useIssuePropertyUndo(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.undo();
      });

      expect(getTabUndoStackForTests()).toHaveLength(1);
      expect(getTabRedoStackForTests()).toHaveLength(0);
      expect(getTabUndoStackForTests()[0]?.propertyLabel).toBe('Move');

      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Could not undo',
          tone: 'danger',
        }),
      );

      unmount();

      await act(async () => {
        await queryClient.cancelQueries();
      });
    } finally {
      globalThis.fetch = originalFetch;
      queryClient.clear();
    }
  });

  it('restores a move to redo history and shows a toast when redo fails', async () => {
    const originalFetch = globalThis.fetch;
    let requestCount = 0;

    globalThis.fetch = ((_url: string | URL | Request, _init?: RequestInit) => {
      requestCount += 1;

      if (requestCount === 1) {
        return Promise.resolve(
          response({
            issue: {
              ...mockIssue,
              stateId: 'state_todo',
              sortOrder: 500,
              syncId: 2,
            },
            rebalanced: [],
          }),
        );
      }

      return Promise.resolve(
        response(
          {
            error: 'Cannot redo: position was changed by another update.',
          },
          409,
        ),
      );
    }) as typeof globalThis.fetch;

    const queryClient = createQueryClient();

    try {
      recordTabMove(moveEntry());

      const { result, unmount } = renderHook(() => useIssuePropertyUndo(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.undo();
      });

      expect(getTabUndoStackForTests()).toHaveLength(0);
      expect(getTabRedoStackForTests()).toHaveLength(1);

      await act(async () => {
        await result.current.redo();
      });

      expect(getTabUndoStackForTests()).toHaveLength(0);
      expect(getTabRedoStackForTests()).toHaveLength(1);
      expect(getTabRedoStackForTests()[0]?.propertyLabel).toBe('Move');

      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Could not redo',
          tone: 'danger',
        }),
      );

      unmount();

      await act(async () => {
        await queryClient.cancelQueries();
      });
    } finally {
      globalThis.fetch = originalFetch;
      queryClient.clear();
    }
  });

  it('preserves only the active grouping field when rebuilding move expectations', async () => {
    const originalFetch = globalThis.fetch;

    globalThis.fetch = ((_url: string | URL | Request, init?: RequestInit) => {
      const body =
        typeof init?.body === 'string'
          ? (JSON.parse(init.body) as {
              stateId?: string;
              expected?: {
                stateId?: string;
                sortOrder?: number;
                assigneeId?: string | null;
                projectId?: string | null;
                cycleId?: string | null;
                priority?: number;
              };
            })
          : undefined;

      if (body?.stateId === 'state_todo') {
        expect(body.expected).toEqual({
          stateId: 'state_done',
          sortOrder: 800,
          assigneeId: null,
        });
      } else {
        expect(body?.expected).toEqual({
          stateId: 'state_todo',
          sortOrder: 500,
          assigneeId: null,
        });
      }

      return Promise.resolve(
        response({
          issue: {
            ...mockIssue,
            stateId: body?.stateId ?? 'state_todo',
            sortOrder: body?.stateId === 'state_todo' ? 500 : 800,
            assigneeId: null,
            projectId: 'project_changed',
            cycleId: 'cycle_changed',
            priority: 4,
            syncId: 2,
          },
          rebalanced: [],
        }),
      );
    }) as typeof globalThis.fetch;

    const queryClient = createQueryClient();

    try {
      const entry = moveEntry({
        expectedForUndo: {
          stateId: 'state_done',
          sortOrder: 800,
          assigneeId: null,
        },
        expectedForRedo: {
          stateId: 'state_todo',
          sortOrder: 500,
          assigneeId: null,
        },
      });

      recordTabMove(entry);

      const { result, unmount } = renderHook(() => useIssuePropertyUndo(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.undo();
      });

      const redoStackAfterUndo = getTabRedoStackForTests();

      expect(redoStackAfterUndo).toHaveLength(1);
      expect(redoStackAfterUndo[0]?.expectedForRedo).toEqual({
        stateId: 'state_todo',
        sortOrder: 500,
        assigneeId: null,
      });

      await act(async () => {
        await result.current.redo();
      });

      const undoStackAfterRedo = getTabUndoStackForTests();

      expect(undoStackAfterRedo).toHaveLength(1);
      expect(undoStackAfterRedo[0]?.expectedForUndo).toEqual({
        stateId: 'state_done',
        sortOrder: 800,
        assigneeId: null,
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

  it('builds a move undo entry whose inverse restores the original source placement', () => {
    const entry = moveEntry();

    expect(entry.inverse.stateId).toBe('state_todo');
    expect(entry.inverse.beforeId).toBe(issueBefore.id);
    expect(entry.inverse.afterId).toBe(issueAfter.id);
    expect(entry.inverse.beforeOrder).toBe(issueBefore.sortOrder);
    expect(entry.inverse.afterOrder).toBe(issueAfter.sortOrder);
  });

  it('uses grouping-aware expected state for undo and redo', () => {
    const entry = moveEntry();

    expect(entry.expectedForUndo).toEqual({
      stateId: 'state_done',
      sortOrder: 800,
      assigneeId: null,
      projectId: null,
      cycleId: null,
      priority: 2,
    });

    expect(entry.expectedForRedo).toEqual({
      stateId: 'state_todo',
      sortOrder: 500,
      assigneeId: null,
      projectId: null,
      cycleId: null,
      priority: 2,
    });
  });
});

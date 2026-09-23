import '../../../tests-preload.ts';
import { beforeEach, describe, expect, it } from 'bun:test';
import { issueUpdateSchema } from '@orbit/shared/validators';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import React from 'react';
import { ToastProvider } from '@/components/ui/toast.tsx';
import {
  clearTabHistory,
  getTabRedoStack,
  getTabUndoStack,
  pushTestRedoEntry,
  recordTabPropertyChange,
} from '@/features/issues/use-issue-property-undo.ts';
import type { Issue } from '@/lib/query/schemas.ts';
import {
  captureIssueHistory,
  filterSupportedPatch,
  hasSupportedProperty,
  useUpdateIssue,
} from '@/lib/query/use-issues.ts';

const mockIssue: Issue = {
  id: 'issue_flow_1',
  organizationId: 'org_flow',
  teamId: 'team_flow',
  number: 10,
  identifier: 'FLOW-10',
  title: 'Original Title',
  description: 'Original Description',
  stateId: 'state_todo',
  priority: 2,
  creatorId: 'user_1',
  assigneeId: 'user_2',
  projectId: 'proj_1',
  milestoneId: 'mile_1',
  cycleId: 'cycle_1',
  parentId: null,
  estimate: 5,
  dueDate: '2026-11-01',
  sortOrder: 500,
  startedAt: null,
  completedAt: null,
  canceledAt: null,
  syncId: 1,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
  archivedAt: null,
  stateEnteredAt: '2026-11-01T00:00:00.000Z',
  labelIds: ['label_1'],
  reviewerIds: ['user_3'],
};

describe('Issue undo mutation lifecycle and sequencing', () => {
  beforeEach(() => {
    clearTabHistory();
  });

  it('title-only and description-only edits produce no property undo history', () => {
    expect(hasSupportedProperty({ title: 'New Renamed Title' })).toBe(false);
    expect(hasSupportedProperty({ description: 'New Description Text' })).toBe(false);

    const titleEntry = captureIssueHistory(mockIssue, { title: 'New Renamed Title' }, 1);
    expect(titleEntry).toBeUndefined();

    const descEntry = captureIssueHistory(mockIssue, { description: 'Updated' }, 2);
    expect(descEntry).toBeUndefined();
  });

  it('filters mixed patches so forward history retains only supported properties and excludes title', () => {
    const mixedPatch = { title: 'New Title', stateId: 'state_done' };
    const filtered = filterSupportedPatch(mixedPatch);
    expect(filtered['title']).toBeUndefined();
    expect(filtered['stateId']).toBe('state_done');

    const entry = captureIssueHistory(mockIssue, mixedPatch, 1);
    expect(entry).toBeDefined();
    expect(entry?.patch['title']).toBeUndefined();
    expect(entry?.patch['stateId']).toBe('state_done');
  });

  it('successful property mutations create history entry with complete baseline', () => {
    const entry = captureIssueHistory(mockIssue, { stateId: 'state_done' }, 1);
    expect(entry).toBeDefined();
    if (entry === undefined) return;

    recordTabPropertyChange(entry);

    const stack = getTabUndoStack();
    expect(stack.length).toBe(1);
    expect(stack[0]?.propertyLabel).toBe('Status');
    expect(stack[0]?.expectedForUndo.labelIds).toEqual(['label_1']);
    expect(stack[0]?.expectedForUndo.reviewerIds).toEqual(['user_3']);
  });

  it('failed property mutation creates no undo entry and does not wipe existing redo history', () => {
    const existingEntry = captureIssueHistory(mockIssue, { priority: 1 }, 1);
    if (existingEntry !== undefined) {
      pushTestRedoEntry(existingEntry);
    }
    expect(getTabRedoStack().length).toBe(1);

    const failedAttemptEntry = captureIssueHistory(mockIssue, { stateId: 'state_canceled' }, 2);
    expect(failedAttemptEntry).toBeDefined();

    expect(getTabUndoStack().length).toBe(0);
    expect(getTabRedoStack().length).toBe(1);
  });

  it('rapid successful mutations preserve user action order even with out-of-order responses', () => {
    const entryA = captureIssueHistory(mockIssue, { stateId: 'state_in_progress' }, 1);
    const entryB = captureIssueHistory(mockIssue, { priority: 4 }, 2);
    const entryC = captureIssueHistory(mockIssue, { assigneeId: null }, 3);

    expect(entryA).toBeDefined();
    expect(entryB).toBeDefined();
    expect(entryC).toBeDefined();
    if (entryA === undefined || entryB === undefined || entryC === undefined) return;

    recordTabPropertyChange(entryB);
    recordTabPropertyChange(entryC);
    recordTabPropertyChange(entryA);

    const stack = getTabUndoStack();
    expect(stack.length).toBe(3);
    expect(stack[0]?.sequence).toBe(1);
    expect(stack[0]?.propertyLabel).toBe('Status');
    expect(stack[1]?.sequence).toBe(2);
    expect(stack[1]?.propertyLabel).toBe('Priority');
    expect(stack[2]?.sequence).toBe(3);
    expect(stack[2]?.propertyLabel).toBe('Assignee');
  });

  it('exercises real useUpdateIssue lifecycle with Zod parsing: A fails + B succeeds -> A omitted, B retained', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((_url: string | URL | Request, init?: RequestInit) => {
      const raw = typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body;
      const body = issueUpdateSchema.parse(raw);
      if (body.stateId === 'state_fail') {
        return Promise.resolve(
          new Response(JSON.stringify({ message: 'Database failure' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ issue: { ...mockIssue, ...body, syncId: 2 } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    }) as typeof globalThis.fetch;

    try {
      const queryClient = new QueryClient({
        defaultOptions: {
          mutations: { retry: false },
        },
      });
      const wrapper = ({ children }: { readonly children: React.ReactNode }) =>
        React.createElement(
          QueryClientProvider,
          { client: queryClient },
          React.createElement(ToastProvider, null, children),
        );

      const { result } = renderHook(() => useUpdateIssue(), { wrapper });

      await act(async () => {
        await expect(
          result.current.mutateAsync({
            issue: mockIssue,
            patch: { stateId: 'state_fail' },
          }),
        ).rejects.toThrow();
      });

      await act(async () => {
        await result.current.mutateAsync({
          issue: mockIssue,
          patch: { priority: 1 },
        });
      });

      const stack = getTabUndoStack();
      expect(stack.length).toBe(1);
      expect(stack[0]?.propertyLabel).toBe('Priority');
      expect(stack[0]?.patch['priority']).toBe(1);
      expect(stack.some((entry) => entry.propertyLabel === 'Status')).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('exercises real useUpdateIssue with two rapid same-property mutations started without awaiting', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((_url: string | URL | Request, init?: RequestInit) => {
      const raw = typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body;
      const body = issueUpdateSchema.parse(raw);
      return Promise.resolve(
        new Response(JSON.stringify({ issue: { ...mockIssue, ...body, syncId: 2 } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    }) as typeof globalThis.fetch;

    try {
      const queryClient = new QueryClient({
        defaultOptions: {
          mutations: { retry: false },
        },
      });
      const wrapper = ({ children }: { readonly children: React.ReactNode }) =>
        React.createElement(
          QueryClientProvider,
          { client: queryClient },
          React.createElement(ToastProvider, null, children),
        );

      const { result } = renderHook(() => useUpdateIssue(), { wrapper });

      await act(async () => {
        const promiseA = result.current.mutateAsync({
          issue: mockIssue,
          patch: { stateId: 'state_in_progress' },
        });
        const promiseB = result.current.mutateAsync({
          issue: mockIssue,
          patch: { stateId: 'state_done' },
        });
        await Promise.all([promiseA, promiseB]);
      });

      const stack = getTabUndoStack();
      expect(stack.length).toBe(2);
      expect(stack[0]?.patch['stateId']).toBe('state_in_progress');
      expect(stack[0]?.inversePatch['stateId']).toBe('state_todo');
      expect(stack[1]?.patch['stateId']).toBe('state_done');
      expect(stack[1]?.inversePatch['stateId']).toBe('state_in_progress');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('reconciles pending mutation base when an earlier rapid mutation in flight fails', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((_url: string | URL | Request, init?: RequestInit) => {
      const raw = typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body;
      const body = issueUpdateSchema.parse(raw);
      if (body.stateId === 'state_fail') {
        return Promise.resolve(
          new Response(JSON.stringify({ message: 'A failed' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ issue: { ...mockIssue, ...body, syncId: 2 } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    }) as typeof globalThis.fetch;

    try {
      const queryClient = new QueryClient({
        defaultOptions: {
          mutations: { retry: false },
        },
      });
      const wrapper = ({ children }: { readonly children: React.ReactNode }) =>
        React.createElement(
          QueryClientProvider,
          { client: queryClient },
          React.createElement(ToastProvider, null, children),
        );

      const { result } = renderHook(() => useUpdateIssue(), { wrapper });

      await act(async () => {
        const promiseA = result.current
          .mutateAsync({
            issue: mockIssue,
            patch: { stateId: 'state_fail' },
          })
          .catch(() => undefined);
        const promiseB = result.current.mutateAsync({
          issue: mockIssue,
          patch: { stateId: 'state_done' },
        });
        await Promise.all([promiseA, promiseB]);
        await new Promise((resolve) => setTimeout(resolve, 20));
      });

      const stack = getTabUndoStack();
      expect(stack.length).toBe(1);
      expect(stack[0]?.patch['stateId']).toBe('state_done');
      expect(stack[0]?.inversePatch['stateId']).toBe('state_todo');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('keeps a succeeded mutation in the tracker so a later mutation uses its updated base', async () => {
    const originalFetch = globalThis.fetch;

    let resolveA: ((response: Response) => void) | undefined;
    let resolveB: ((response: Response) => void) | undefined;
    let resolveC: ((response: Response) => void) | undefined;

    const responseA = new Promise<Response>((resolve) => {
      resolveA = resolve;
    });

    const responseB = new Promise<Response>((resolve) => {
      resolveB = resolve;
    });

    const responseC = new Promise<Response>((resolve) => {
      resolveC = resolve;
    });

    globalThis.fetch = ((_url: string | URL | Request, init?: RequestInit) => {
      const raw = typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body;
      const body = issueUpdateSchema.parse(raw);

      if (body.priority === 1) {
        return responseA;
      }

      if (body.stateId === 'state_in_progress') {
        return responseB;
      }

      return responseC;
    }) as typeof globalThis.fetch;

    try {
      const queryClient = new QueryClient({
        defaultOptions: {
          mutations: { retry: false },
        },
      });

      const wrapper = ({ children }: { readonly children: React.ReactNode }) =>
        React.createElement(
          QueryClientProvider,
          { client: queryClient },
          React.createElement(ToastProvider, null, children),
        );

      const { result } = renderHook(() => useUpdateIssue(), { wrapper });

      const promiseA = result.current
        .mutateAsync({
          issue: mockIssue,
          patch: { priority: 1 },
        })
        .catch(() => undefined);

      const promiseB = result.current.mutateAsync({
        issue: mockIssue,
        patch: { stateId: 'state_in_progress' },
      });

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      expect(resolveA).toBeDefined();
      expect(resolveB).toBeDefined();

      resolveB?.(
        new Response(
          JSON.stringify({
            issue: {
              ...mockIssue,
              stateId: 'state_in_progress',
              syncId: 2,
            },
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      );

      await act(async () => {
        await promiseB;
      });

      const promiseC = result.current.mutateAsync({
        issue: mockIssue,
        patch: { stateId: 'state_done' },
      });

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      expect(resolveC).toBeDefined();

      resolveC?.(
        new Response(
          JSON.stringify({
            issue: {
              ...mockIssue,
              stateId: 'state_done',
              syncId: 3,
            },
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      );

      await act(async () => {
        await promiseC;
      });

      resolveA?.(
        new Response(JSON.stringify({ message: 'A failed' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      await act(async () => {
        await promiseA;
      });

      const stack = getTabUndoStack();

      expect(stack.length).toBe(2);
      expect(stack[0]?.patch['stateId']).toBe('state_in_progress');
      expect(stack[1]?.patch['stateId']).toBe('state_done');
      expect(stack[1]?.inversePatch['stateId']).toBe('state_in_progress');
      expect(stack[1]?.expectedForUndo['stateId']).toBe('state_done');
      expect(stack.some((entry) => entry.patch['priority'] === 1)).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('skips failed records when building currentBase for a subsequent mutation while another is pending', async () => {
    const originalFetch = globalThis.fetch;

    let resolveA: ((response: Response) => void) | undefined;
    let resolveB: ((response: Response) => void) | undefined;
    let resolveC: ((response: Response) => void) | undefined;

    const responseA = new Promise<Response>((resolve) => {
      resolveA = resolve;
    });

    const responseB = new Promise<Response>((resolve) => {
      resolveB = resolve;
    });

    const responseC = new Promise<Response>((resolve) => {
      resolveC = resolve;
    });

    globalThis.fetch = ((_url: string | URL | Request, init?: RequestInit) => {
      const raw = typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body;
      const body = issueUpdateSchema.parse(raw);

      if (body.priority === 1) {
        return responseA;
      }

      if (body.estimate === 8) {
        return responseB;
      }

      return responseC;
    }) as typeof globalThis.fetch;

    try {
      const queryClient = new QueryClient({
        defaultOptions: {
          mutations: { retry: false },
        },
      });

      const wrapper = ({ children }: { readonly children: React.ReactNode }) =>
        React.createElement(
          QueryClientProvider,
          { client: queryClient },
          React.createElement(ToastProvider, null, children),
        );

      const { result } = renderHook(() => useUpdateIssue(), { wrapper });

      let promiseA: Promise<unknown> | undefined;
      let promiseB: Promise<unknown> | undefined;

      act(() => {
        promiseA = result.current
          .mutateAsync({
            issue: mockIssue,
            patch: { priority: 1 },
          })
          .catch(() => undefined);

        promiseB = result.current.mutateAsync({
          issue: mockIssue,
          patch: { estimate: 8 },
        });
      });

      await act(async () => {
        if (resolveA !== undefined) {
          resolveA(
            new Response(JSON.stringify({ message: 'Mutation A failed' }), {
              status: 500,
              headers: { 'Content-Type': 'application/json' },
            }),
          );
        }
        await promiseA;
      });

      let promiseC: Promise<unknown> | undefined;

      act(() => {
        promiseC = result.current.mutateAsync({
          issue: mockIssue,
          patch: { priority: 3 },
        });
      });

      await act(async () => {
        if (resolveB !== undefined) {
          resolveB(
            new Response(
              JSON.stringify({
                issue: {
                  ...mockIssue,
                  estimate: 8,
                  syncId: 2,
                },
              }),
              {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
              },
            ),
          );
        }

        if (resolveC !== undefined) {
          resolveC(
            new Response(
              JSON.stringify({
                issue: {
                  ...mockIssue,
                  estimate: 8,
                  priority: 3,
                  syncId: 3,
                },
              }),
              {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
              },
            ),
          );
        }

        await Promise.all([promiseB, promiseC]);
      });

      const stack = getTabUndoStack();
      const priorityEntry = stack.find((entry) => entry.propertyLabel === 'Priority');

      expect(priorityEntry).toBeDefined();
      expect(priorityEntry?.patch['priority']).toBe(3);
      expect(priorityEntry?.inversePatch['priority']).toBe(2);
      expect(stack.some((entry) => entry.patch['priority'] === 1)).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

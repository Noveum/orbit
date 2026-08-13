import { afterEach, describe, expect, it, mock } from 'bun:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

const toasts: { title: string; description?: string }[] = [];
const refresh = mock(() => undefined);

mock.module('@/components/ui/toast.tsx', () => ({
  useToast: () => ({
    toast: (value: { title: string; description?: string }) => toasts.push(value),
  }),
}));
mock.module('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const { useCompleteSprint } = await import('../../../src/lib/query/use-sprints.ts');
const originalFetch = globalThis.fetch;

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  toasts.length = 0;
  refresh.mockClear();
});

describe('useCompleteSprint', () => {
  it('names a blank successor with its numbered sprint fallback', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        Response.json({
          cycle: {
            id: 'cycle_1',
            teamId: null,
            number: 1,
            name: 'Launch',
            startsAt: '2026-01-01T00:00:00.000Z',
            endsAt: '2026-01-15T00:00:00.000Z',
            completedAt: '2026-01-15T00:00:00.000Z',
          },
          nextCycle: {
            id: 'cycle_2',
            teamId: null,
            number: 2,
            name: '',
            startsAt: '2026-01-15T00:00:00.000Z',
            endsAt: '2026-01-29T00:00:00.000Z',
            completedAt: null,
          },
          rolledOverIssueIds: ['issue_1'],
        }),
      ),
    ) as unknown as typeof fetch;
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const view = renderHook(() => useCompleteSprint(), { wrapper: wrapper(client) });

    await act(async () => view.result.current.mutateAsync('cycle_1'));
    await waitFor(() => expect(toasts).toHaveLength(1));

    expect(toasts[0]?.description).toBe('1 issue rolled into Sprint 2.');
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

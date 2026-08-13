import { afterEach, describe, expect, it, mock } from 'bun:test';
import { analyticsQuerySchema } from '@orbit/shared/validators';
import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useAnalyticsQuery } from '../../../src/features/analytics/use-analytics-query.ts';
import { createQueryClient } from '../../../src/lib/query/provider.tsx';

const response = {
  lens: 'overview',
  asOf: '2026-08-13T12:00:00.000Z',
  coverage: { kind: 'live', from: null, asOf: '2026-08-13T12:00:00.000Z' },
  cards: [],
  delivery: [],
  state: [],
  projects: [],
  priorities: [],
  outliers: [],
};

const calls: Array<{ readonly path: string; readonly signal: AbortSignal | null }> = [];
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  calls.length = 0;
});

function wrapper(client: ReturnType<typeof createQueryClient>) {
  return function QueryWrapper({ children }: { readonly children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe('useAnalyticsQuery', () => {
  it('fetches the active lens with canonical state and an abort signal', async () => {
    globalThis.fetch = mock((input: string | URL | Request, init?: RequestInit) => {
      calls.push({ path: String(input), signal: init?.signal ?? null });
      return Promise.resolve(Response.json(response));
    }) as unknown as typeof fetch;
    const query = analyticsQuerySchema.parse({ measure: 'points' });

    const view = renderHook(() => useAnalyticsQuery(query), {
      wrapper: wrapper(createQueryClient()),
    });
    await waitFor(() => expect(view.result.current.isSuccess).toBe(true));

    expect(calls.map((call) => call.path)).toEqual(['/api/analytics/overview?measure=points']);
    expect(calls[0]?.signal).toBeInstanceOf(AbortSignal);
    expect(view.result.current.data?.lens).toBe('overview');
  });

  it('reuses the provider stale window instead of immediately fetching twice', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(Response.json(response)),
    ) as unknown as typeof fetch;
    const query = analyticsQuerySchema.parse({});
    const client = createQueryClient();
    const first = renderHook(() => useAnalyticsQuery(query), { wrapper: wrapper(client) });
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
    first.unmount();

    const second = renderHook(() => useAnalyticsQuery(query), { wrapper: wrapper(client) });
    await waitFor(() => expect(second.result.current.isSuccess).toBe(true));

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('rejects a valid response belonging to a different lens', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(Response.json(response)),
    ) as unknown as typeof fetch;
    const query = analyticsQuerySchema.parse({ lens: 'people' });

    const view = renderHook(() => useAnalyticsQuery(query), {
      wrapper: wrapper(createQueryClient()),
    });
    await waitFor(() => expect(view.result.current.isError).toBe(true), { timeout: 3_000 });

    expect(view.result.current.data).toBeUndefined();
  });
});

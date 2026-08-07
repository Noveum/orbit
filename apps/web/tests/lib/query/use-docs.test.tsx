import { afterEach, describe, expect, it, mock } from 'bun:test';
import { docFavoriteSchema } from '@orbit/shared/validators';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ToastProvider } from '@/components/ui/toast.tsx';
import { useToggleDocFavorite } from '@/lib/query/use-docs.ts';

const originalFetch = globalThis.fetch;

interface Arrival {
  readonly docId: string;
  readonly favorite: boolean;
}

interface Server {
  readonly arrivals: Arrival[];
  readonly answer: (index: number) => void;
}

function stubServer(): Server {
  const arrivals: Arrival[] = [];
  const gates: Array<() => void> = [];

  globalThis.fetch = mock((input: string | URL | Request, init?: RequestInit) => {
    const { favorite } = docFavoriteSchema.parse(JSON.parse(String(init?.body ?? '{}')));
    const docId = String(input).split('/').at(-2) ?? '';
    arrivals.push({ docId, favorite });
    return new Promise<Response>((resolve) => {
      gates.push(() =>
        resolve(
          new Response(JSON.stringify({ docId, favorite }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        ),
      );
    });
  }) as unknown as typeof fetch;

  return {
    arrivals,
    answer: (index) => {
      const gate = gates[index];
      if (gate === undefined) throw new Error(`request ${index} has not arrived`);
      gate();
    },
  };
}

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
}

function newClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

async function tick(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('useToggleDocFavorite', () => {
  it('keeps a second click off the wire until the first write has landed', async () => {
    const server = stubServer();
    const view = renderHook(() => useToggleDocFavorite('doc_1'), { wrapper: wrapper(newClient()) });

    act(() => view.result.current.mutate(true));
    await waitFor(() => expect(server.arrivals.length).toBe(1));

    act(() => view.result.current.mutate(false));
    await tick();

    expect(server.arrivals.map((arrival) => arrival.favorite)).toEqual([true]);

    act(() => server.answer(0));
    await waitFor(() => expect(server.arrivals.length).toBe(2));

    expect(server.arrivals.map((arrival) => arrival.favorite)).toEqual([true, false]);

    act(() => server.answer(1));
    await waitFor(() => expect(view.result.current.isPending).toBe(false));
  });

  it('does not make one doc wait behind a star that belongs to another doc', async () => {
    const server = stubServer();
    const client = newClient();
    const runbook = renderHook(() => useToggleDocFavorite('doc_1'), { wrapper: wrapper(client) });
    const postmortem = renderHook(() => useToggleDocFavorite('doc_2'), {
      wrapper: wrapper(client),
    });

    act(() => runbook.result.current.mutate(true));
    await waitFor(() => expect(server.arrivals.length).toBe(1));

    act(() => postmortem.result.current.mutate(true));
    await tick();

    expect(server.arrivals.map((arrival) => arrival.docId)).toEqual(['doc_1', 'doc_2']);

    act(() => server.answer(0));
    act(() => server.answer(1));
    await waitFor(() => expect(postmortem.result.current.isPending).toBe(false));
  });
});

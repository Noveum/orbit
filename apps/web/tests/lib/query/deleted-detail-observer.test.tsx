import { describe, expect, it } from 'bun:test';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { queryKeys } from '@/lib/query/keys.ts';

function Detail({ identifier }: { readonly identifier: string }) {
  const query = useQuery({
    queryKey: queryKeys.issue(identifier),
    queryFn: () => Promise.resolve({ identifier, title: 'Still painted' }),
    staleTime: Number.POSITIVE_INFINITY,
  });
  return <span data-testid="detail">{query.data?.title ?? 'gone'}</span>;
}

function mounted(client: QueryClient, identifier: string) {
  render(
    <QueryClientProvider client={client}>
      <Detail identifier={identifier} />
    </QueryClientProvider>,
  );
}

describe('purging the detail of a deleted issue', () => {
  it('stops a tab that is watching the issue from painting it', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(queryKeys.issue('ENG-1'), { identifier: 'ENG-1', title: 'Still painted' });
    mounted(client, 'ENG-1');
    await waitFor(() => {
      expect(screen.getByTestId('detail').textContent).toBe('Still painted');
    });

    client.resetQueries({ queryKey: queryKeys.issue('ENG-1'), exact: true });

    await waitFor(() => {
      expect(client.getQueryData(queryKeys.issue('ENG-1'))).toBeUndefined();
    });
  });

  it('shows that emptying the cache alone leaves the observer painting the old row', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(queryKeys.issue('ENG-2'), { identifier: 'ENG-2', title: 'Still painted' });
    mounted(client, 'ENG-2');
    await waitFor(() => {
      expect(screen.getByTestId('detail').textContent).toBe('Still painted');
    });

    client.removeQueries({ queryKey: queryKeys.issue('ENG-2'), exact: true });

    expect(client.getQueryData(queryKeys.issue('ENG-2'))).toBeUndefined();
    expect(screen.getByTestId('detail').textContent).toBe('Still painted');
  });
});

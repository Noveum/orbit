import { describe, expect, it } from 'bun:test';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { bootstrapQueryOptions } from '@/lib/query/use-issues.ts';

async function fetchesAfterInvalidate(staleTime: unknown): Promise<number> {
  let calls = 0;
  const client = new QueryClient();
  const observer = new QueryObserver(client, {
    queryKey: ['bootstrap-staleness-probe'],
    queryFn: () => {
      calls += 1;
      return Promise.resolve(calls);
    },
    staleTime: staleTime as number,
  });

  const unsubscribe = observer.subscribe(() => undefined);
  await observer.refetch();
  await client.invalidateQueries({ queryKey: ['bootstrap-staleness-probe'] });
  await new Promise((resolve) => setTimeout(resolve, 50));
  unsubscribe();

  return calls;
}

describe('bootstrap staleness', () => {
  it('still refetches when the delta stream invalidates it', async () => {
    const staleTime = bootstrapQueryOptions(null).staleTime;
    expect(await fetchesAfterInvalidate(staleTime)).toBeGreaterThan(1);
  });

  it('does not refetch on its own between invalidations', async () => {
    const client = new QueryClient();
    let calls = 0;
    const observer = new QueryObserver(client, {
      ...bootstrapQueryOptions(null),
      queryKey: ['bootstrap-quiet-probe'],
      queryFn: () => {
        calls += 1;
        return Promise.resolve(calls);
      },
    });

    const unsubscribe = observer.subscribe(() => undefined);
    await observer.refetch();
    const second = new QueryObserver(client, {
      ...bootstrapQueryOptions(null),
      queryKey: ['bootstrap-quiet-probe'],
      queryFn: () => {
        calls += 1;
        return Promise.resolve(calls);
      },
    });
    const stop = second.subscribe(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 50));
    stop();
    unsubscribe();

    expect(calls).toBe(1);
  });

  it("rejects 'static', which silently swallows invalidation", async () => {
    expect(await fetchesAfterInvalidate('static')).toBe(1);
  });
});

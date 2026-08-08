import { describe, expect, it } from 'bun:test';
import type { Query } from '@tanstack/react-query';
import {
  CACHE_MAX_AGE_MS,
  cacheBuster,
  restorable,
  shouldPersistQuery,
} from '@/lib/query/persist.ts';

const bootstrap = {
  userId: 'user-1',
  organizationId: 'org-1',
  role: 'admin',
  teams: [],
  activeTeamId: null,
  states: [],
  labels: [],
  members: [],
  projects: [],
  cycles: [],
  issues: [],
};

function persisted(queries: readonly Record<string, unknown>[]) {
  return {
    buster: cacheBuster('user-1', 'org-1'),
    timestamp: 1,
    clientState: { mutations: [], queries },
  };
}

function query(queryKey: readonly unknown[], data: unknown) {
  return { queryKey, queryHash: JSON.stringify(queryKey), state: { data } };
}

function keysOf(client: ReturnType<typeof restorable>): string[] {
  return client.clientState.queries.map((entry) => String(entry.queryKey[0]));
}

describe('restorable', () => {
  it('keeps a bootstrap entry that still matches the schema', () => {
    const client = restorable(persisted([query(['bootstrap', 'default'], bootstrap)]));
    expect(keysOf(client)).toEqual(['bootstrap']);
  });

  it('drops an entry whose shape has drifted since it was written', () => {
    const stale = { ...bootstrap, teams: 'not-an-array' };
    const client = restorable(persisted([query(['bootstrap', 'default'], stale)]));
    expect(client.clientState.queries).toEqual([]);
  });

  it('drops a query root that is not on the persisted list', () => {
    const client = restorable(
      persisted([
        query(['bootstrap', 'default'], bootstrap),
        query(['doc', 'doc-1'], { anything: true }),
        query(['comments', 'issue-1'], { anything: true }),
      ]),
    );
    expect(keysOf(client)).toEqual(['bootstrap']);
  });

  it('keeps an infinite issue list and drops one with a broken page', () => {
    const page = { issues: [], nextCursor: null };
    const good = query(['issues', 'team-1', ''], { pages: [page], pageParams: [null] });
    const bad = query(['issues', 'team-2', ''], { pages: [{ issues: 'no' }], pageParams: [null] });
    const client = restorable(persisted([good, bad]));
    expect(client.clientState.queries.map((entry) => entry.queryKey[1])).toEqual(['team-1']);
  });

  it('busts a cache whose envelope is not a persisted client', () => {
    expect(restorable({ nonsense: true }).buster).toBe('');
    expect(restorable(null).clientState.queries).toEqual([]);
  });
});

describe('cacheBuster', () => {
  it('differs for another person in the same workspace', () => {
    expect(cacheBuster('user-1', 'org-1')).not.toBe(cacheBuster('user-2', 'org-1'));
  });

  it('differs for the same person in another workspace', () => {
    expect(cacheBuster('user-1', 'org-1')).not.toBe(cacheBuster('user-1', 'org-2'));
  });
});

describe('shouldPersistQuery', () => {
  function fake(queryKey: readonly unknown[], status: string): Query {
    return { queryKey, state: { status } } as unknown as Query;
  }

  it('persists a settled bootstrap query', () => {
    expect(shouldPersistQuery(fake(['bootstrap', 'default'], 'success'))).toBe(true);
  });

  it('refuses a query that failed', () => {
    expect(shouldPersistQuery(fake(['bootstrap', 'default'], 'error'))).toBe(false);
  });

  it('refuses a root that is not persisted', () => {
    expect(shouldPersistQuery(fake(['doc', 'doc-1'], 'success'))).toBe(false);
  });
});

describe('cache lifetime', () => {
  it('never outlives the garbage collection window it is paired with', async () => {
    const { createQueryClient } = await import('@/lib/query/provider.tsx');
    const gcTime = createQueryClient().getDefaultOptions().queries?.gcTime;
    expect(gcTime).toBeGreaterThanOrEqual(CACHE_MAX_AGE_MS);
  });
});

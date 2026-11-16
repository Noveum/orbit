import { describe, expect, it } from 'bun:test';
import { dehydrate, hydrate, type Query, QueryClient, QueryObserver } from '@tanstack/react-query';
import { waitFor } from '@testing-library/react';
import { resolveIssueActor } from '@/lib/query/issue-actors.ts';
import {
  CACHE_MAX_AGE_MS,
  cacheBuster,
  restorable,
  shouldPersistQuery,
} from '@/lib/query/persist.ts';
import { bootstrapSchema, issueDetailSchema, issueListSchema } from '@/lib/query/schemas.ts';

const legacyIssue = {
  id: 'issue-1',
  teamId: 'team-1',
  number: 1,
  identifier: 'ENG-1',
  title: 'Title',
  stateId: 'state-1',
  priority: 0,
  creatorId: 'user-1',
  assigneeId: 'user-2',
  projectId: null,
  milestoneId: null,
  cycleId: null,
  parentId: null,
  estimate: null,
  dueDate: null,
  sortOrder: 1,
  startedAt: null,
  completedAt: null,
  canceledAt: null,
  syncId: 1,
  createdAt: '',
  updatedAt: '',
  archivedAt: null,
};

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

function persisted(queries: readonly unknown[]) {
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

const cachedDetail = issueDetailSchema.parse({
  issue: { ...legacyIssue, description: '' },
  descriptionHtml: '',
  activity: [],
  subIssues: [],
  subscribed: false,
});

const savedDetail = {
  ...cachedDetail,
  issue: {
    ...cachedDetail.issue,
    description: '[artifact.html](/api/files/artifact.html)',
    syncId: 2,
  },
};

function pendingData() {
  let finish: ((value: unknown) => void) | undefined;
  const promise = new Promise<unknown>((resolve) => {
    finish = resolve;
  });
  if (finish === undefined) throw new Error('response was not initialized');
  return { promise, finish };
}

describe('restorable', () => {
  it.each([
    {
      name: 'issue details',
      key: ['issue', 'ENG-1'],
      cached: cachedDetail,
      saved: savedDetail,
    },
    {
      name: 'issue lists',
      key: ['issues', 'team-1', ''],
      cached: { pages: [{ issues: [cachedDetail.issue], nextCursor: null }], pageParams: [null] },
      saved: { pages: [{ issues: [savedDetail.issue], nextCursor: null }], pageParams: [null] },
    },
    {
      name: 'workspace bootstrap',
      key: ['bootstrap', 'default'],
      cached: bootstrap,
      saved: { ...bootstrap, issues: [savedDetail.issue] },
    },
  ])(
    'revalidates recent restored $name when its observer mounts',
    async ({ key, cached, saved }) => {
      const source = new QueryClient();
      const client = new QueryClient();
      source.setQueryData<unknown>(key, cached);
      hydrate(client, restorable(persisted(dehydrate(source).queries)).clientState);
      const response = pendingData();
      let requests = 0;
      const observer = new QueryObserver(client, {
        queryKey: key,
        staleTime: 30_000,
        queryFn: () => {
          requests += 1;
          return response.promise;
        },
      });
      const unsubscribe = observer.subscribe(() => undefined);
      try {
        expect(requests).toBe(1);
        expect(observer.getCurrentResult().data).toBe(cached);
        response.finish(saved);
        await waitFor(() => expect(observer.getCurrentResult().data).toEqual(saved));
      } finally {
        response.finish(saved);
        unsubscribe();
        client.clear();
        source.clear();
      }
    },
  );

  it('preserves restored timestamps and state counters without mutating the durable snapshot', () => {
    const source = new QueryClient();
    const key = ['issue', 'ENG-1'];
    const updatedAt = Date.now() - 1_000;
    source.setQueryData(key, cachedDetail, { updatedAt });
    const dehydrated = dehydrate(source);
    const raw = persisted(dehydrated.queries);
    const original = dehydrated.queries[0];
    const restored = restorable(raw).clientState.queries[0];
    if (original === undefined) throw new Error('cache snapshot was not captured');
    expect(restored?.state).toEqual({ ...original.state, isInvalidated: true });
    expect(restored?.state.data).toBe(cachedDetail);
    expect(restored?.state.dataUpdatedAt).toBe(updatedAt);
    expect(original.state.isInvalidated).toBe(false);
    source.clear();
  });

  it('keeps a late-restored detail available while its first canonical request is pending', async () => {
    const source = new QueryClient();
    const client = new QueryClient();
    const key = ['issue', 'ENG-1'];
    const updatedAt = Date.now() - 1_000;
    source.setQueryData(key, cachedDetail, { updatedAt });
    const response = pendingData();
    const loading = client.fetchQuery({ queryKey: key, queryFn: () => response.promise });
    try {
      hydrate(client, restorable(persisted(dehydrate(source).queries)).clientState);
      expect(client.getQueryData(key)).toBe(cachedDetail);
      expect(client.getQueryState(key)?.dataUpdatedAt).toBe(updatedAt);
      expect(client.getQueryState(key)?.fetchStatus).toBe('fetching');
      expect(client.getQueryState(key)?.isInvalidated).toBe(true);
      response.finish(savedDetail);
      await loading;
      expect(client.getQueryData(key)).toEqual(savedDetail);
    } finally {
      response.finish(savedDetail);
      await loading;
      client.clear();
      source.clear();
    }
  });

  it('restores old Issue caches with omitted actors and retains complete new actors', () => {
    const assignee = {
      type: 'agent' as const,
      id: 'agent-1',
      name: 'Helper',
      avatar: null,
      deleted: true,
    };
    const pages = [
      { issues: [legacyIssue], nextCursor: null },
      {
        issues: [
          {
            ...legacyIssue,
            creatorId: null,
            creatorUserId: null,
            creatorAgentId: assignee.id,
            creator: assignee,
            assigneeId: null,
            assignee,
            owner: null,
          },
        ],
        nextCursor: null,
      },
    ];
    const client = restorable(
      persisted([query(['issues', 'team-1', ''], { pages, pageParams: [null, null] })]),
    );
    expect(client.clientState.queries).toHaveLength(1);
    const restored = client.clientState.queries[0]?.state.data as { pages: unknown[] };
    const legacy = issueListSchema.parse(restored.pages[0]).issues[0];
    const current = issueListSchema.parse(restored.pages[1]).issues[0];
    expect(legacy?.assignee).toBeUndefined();
    expect(legacy === undefined ? null : resolveIssueActor(legacy, 'assignee')?.deleted).toBe(
      false,
    );
    expect(current?.assignee).toEqual(assignee);
    expect(current?.creatorId).toBeNull();
    expect(current?.creator).toEqual(assignee);
    expect(current?.owner).toBeNull();
  });

  it('keeps a bootstrap entry that still matches the schema', () => {
    const client = restorable(persisted([query(['bootstrap', 'default'], bootstrap)]));
    expect(keysOf(client)).toEqual(['bootstrap']);
  });

  it('restores Agent-created issues in a bootstrap snapshot', () => {
    const creator = {
      type: 'agent' as const,
      id: 'agent-1',
      name: 'Helper',
      avatar: null,
      deleted: false,
    };
    const row = {
      ...legacyIssue,
      creatorId: null,
      creatorUserId: null,
      creatorAgentId: creator.id,
      creator,
    };
    const client = restorable(
      persisted([query(['bootstrap', 'default'], { ...bootstrap, issues: [row] })]),
    );
    expect(keysOf(client)).toEqual(['bootstrap']);
    const restored = bootstrapSchema.parse(client.clientState.queries[0]?.state.data);
    expect(restored.issues[0]?.creatorId).toBeNull();
    expect(restored.issues[0]?.creator).toEqual(creator);
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

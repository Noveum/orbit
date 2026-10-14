import { describe, expect, it } from 'bun:test';
import type { SyncAction } from '@orbit/shared/events';
import { dehydrate, hydrate, QueryClient, QueryObserver } from '@tanstack/react-query';
import { waitFor } from '@testing-library/react';
import {
  issueMutationListRevisionGeneration,
  issueMutationRevisionGeneration,
  observeIssueActorProfiles,
  recordMemberActorUpdate,
  replayIssueActorProfiles,
} from '@/lib/query/issue-actor-cache.ts';
import {
  issueCacheRevisionGeneration,
  issueListRevisionGeneration,
  recordIssueListRevisions,
} from '@/lib/query/issue-cache-generation.ts';
import { queryKeys } from '@/lib/query/keys.ts';
import { restorable } from '@/lib/query/persist.ts';
import {
  type BoardPage,
  type Bootstrap,
  bootstrapSchema,
  type Issue,
  type IssueDetail,
  type IssueRelation,
  issueSchema,
} from '@/lib/query/schemas.ts';
import type { IssuePages } from '@/lib/query/sync.ts';

const human = {
  type: 'user' as const,
  id: 'user_1',
  name: 'Old name',
  avatar: '/old.png',
  deleted: false,
};

function issue(overrides: Partial<Issue> = {}): Issue {
  return issueSchema.parse({
    id: 'issue_1',
    organizationId: 'org_1',
    teamId: 'team_1',
    number: 1,
    identifier: 'ENG-1',
    title: 'Title',
    stateId: 'state_1',
    priority: 0,
    creatorId: human.id,
    assigneeId: human.id,
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
    creator: human,
    assignee: human,
    ownerUserId: human.id,
    owner: human,
    ...overrides,
  });
}

function bootstrap(members: Bootstrap['members'] = []): Bootstrap {
  return bootstrapSchema.parse({
    userId: 'user_1',
    organizationId: 'org_1',
    role: 'admin',
    teams: [],
    activeTeamId: null,
    states: [],
    labels: [],
    members,
    projects: [],
    cycles: [],
    issues: [],
  });
}

function action(data: SyncAction['data'], syncId = 20): SyncAction {
  return {
    model: 'member',
    modelId: 'membership_1',
    action: 'update',
    syncId,
    organizationId: 'org_1',
    scopes: ['org:org_1'],
    actor: { type: 'user', id: 'admin' },
    data,
    at: '',
  };
}

function client(): QueryClient {
  const client = new QueryClient();
  observeIssueActorProfiles(client, 'org_1', ['team_1']);
  return client;
}

describe('member events refresh Issue Human Actors', () => {
  it.each(['fetch', 'cached', 'hydrate-added', 'hydrate-existing'] as const)(
    'refreshes persisted Actors without a member event through %s while Issue reads are offline',
    async (source) => {
      const bob = { ...human, name: 'Bob', avatar: '/bob.png' };
      const carol = { ...human, name: 'Carol', avatar: null };
      const row = issue({ creator: bob, assignee: bob, owner: bob });
      const key = queryKeys.issues('team_1');
      const stale = new QueryClient();
      stale.setQueryData(
        key,
        { pages: [{ issues: [row], nextCursor: null }], pageParams: [null] },
        { updatedAt: 1 },
      );
      const restored = restorable({
        buster: '1:user_1:org_1',
        timestamp: 1,
        clientState: dehydrate(stale),
      });
      const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const fresh = bootstrap([
        {
          id: human.id,
          name: carol.name,
          image: carol.avatar,
          email: 'u@orbit.test',
          handle: null,
          role: 'member',
        },
      ]);
      if (source === 'fetch' || source === 'cached') hydrate(cache, restored.clientState);
      if (source === 'hydrate-existing')
        cache.setQueryData(
          key,
          { pages: [{ issues: [row], nextCursor: null }], pageParams: [null] },
          { updatedAt: 0 },
        );
      if (source !== 'fetch')
        await cache.fetchQuery({ queryKey: queryKeys.bootstrap(null), queryFn: async () => fresh });
      const stop = observeIssueActorProfiles(cache, 'org_1', ['team_1']);
      try {
        if (source === 'fetch')
          await cache.fetchQuery({
            queryKey: queryKeys.bootstrap(null),
            queryFn: async () => fresh,
          });
        if (source === 'hydrate-added' || source === 'hydrate-existing')
          hydrate(cache, restored.clientState);
        await expect(
          cache.fetchQuery({
            queryKey: key,
            queryFn: () => Promise.reject(new Error('offline')),
          }),
        ).rejects.toThrow('offline');
        const cached = cache.getQueryData<IssuePages>(key)?.pages[0]?.issues[0];
        for (const role of ['creator', 'assignee', 'owner'] as const)
          expect(cached?.[role]).toEqual(carol);
        expect(cached?.syncId).toBe(row.syncId);
        expect(cached?.updatedAt).toBe(row.updatedAt);
        expect(cache.getQueryState(key)?.dataUpdatedAt).toBe(1);
        cache.setQueryData(
          queryKeys.bootstrap(null),
          bootstrap([
            {
              id: human.id,
              name: bob.name,
              image: bob.avatar,
              email: 'u@orbit.test',
              handle: null,
              role: 'member',
            },
          ]),
        );
        expect(replayIssueActorProfiles(cache, row).creator).toEqual(carol);
        const dave = { ...carol, name: 'Dave', avatar: '/dave.png' };
        await cache.fetchQuery({
          queryKey: key,
          queryFn: async () => ({
            pages: [
              {
                issues: [{ ...row, creator: dave, assignee: dave, owner: dave }],
                nextCursor: null,
              },
            ],
            pageParams: [null],
          }),
        });
        expect(replayIssueActorProfiles(cache, row).owner).toEqual(dave);
      } finally {
        stop();
        stale.clear();
        cache.clear();
      }
    },
  );

  it('uses the newest workspace Bootstrap before observing and ignores an older restored team Bootstrap', () => {
    const cache = new QueryClient();
    const member = {
      id: human.id,
      name: 'Carol',
      image: '/carol.png',
      email: 'u@orbit.test',
      handle: null,
      role: 'member' as const,
    };
    cache.setQueryData(
      queryKeys.bootstrap('ENG'),
      bootstrap([{ ...member, name: 'Bob', image: '/bob.png' }]),
      { updatedAt: 1 },
    );
    cache.setQueryData(queryKeys.bootstrap(null), bootstrap([member]), { updatedAt: 2 });
    const stop = observeIssueActorProfiles(cache, 'org_1', ['team_1']);
    try {
      expect(replayIssueActorProfiles(cache, issue()).creator).toEqual({
        ...human,
        name: member.name,
        avatar: member.image,
      });
      const stale = new QueryClient();
      stale.setQueryData(
        queryKeys.bootstrap('OLD'),
        bootstrap([{ ...member, name: 'Older', image: null }]),
        { updatedAt: 1 },
      );
      hydrate(cache, dehydrate(stale));
      expect(replayIssueActorProfiles(cache, issue()).creator?.name).toBe('Carol');
      recordMemberActorUpdate(cache, action({ userId: human.id, name: 'Newer' }, 20), 'org_1');
      recordMemberActorUpdate(cache, action({ userId: human.id, name: 'Stale' }, 19), 'org_1');
      expect(replayIssueActorProfiles(cache, issue()).creator?.name).toBe('Newer');
      stale.clear();
    } finally {
      stop();
      cache.clear();
    }
  });

  it.each(['added', 'existing'] as const)(
    'accepts a newer hydrated Bootstrap through %s after a cached profile was initialized',
    async (source) => {
      const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const member = {
        id: human.id,
        name: 'Bob',
        image: '/bob.png',
        email: 'u@orbit.test',
        handle: null,
        role: 'member' as const,
      };
      const key = queryKeys.issues('team_1');
      cache.setQueryData(queryKeys.bootstrap(null), bootstrap([member]), { updatedAt: 1 });
      cache.setQueryData(
        key,
        { pages: [{ issues: [issue()], nextCursor: null }], pageParams: [null] },
        { updatedAt: 1 },
      );
      const stop = observeIssueActorProfiles(cache, 'org_1', ['team_1']);
      const server = new QueryClient();
      try {
        expect(replayIssueActorProfiles(cache, issue()).creator?.name).toBe('Bob');
        server.setQueryData(
          queryKeys.bootstrap(source === 'added' ? 'ENG' : null),
          bootstrap([{ ...member, name: 'Carol', image: null }]),
          { updatedAt: 2 },
        );
        hydrate(cache, dehydrate(server));
        await expect(
          cache.fetchQuery({ queryKey: key, queryFn: () => Promise.reject(new Error('offline')) }),
        ).rejects.toThrow('offline');
        expect(replayIssueActorProfiles(cache, issue()).creator).toEqual({
          ...human,
          name: 'Carol',
          avatar: null,
        });
        expect(cache.getQueryState(key)?.dataUpdatedAt).toBe(1);
        const older = new QueryClient();
        older.setQueryData(queryKeys.bootstrap('OLD'), bootstrap([member]), { updatedAt: 1 });
        hydrate(cache, dehydrate(older));
        expect(replayIssueActorProfiles(cache, issue()).owner?.name).toBe('Carol');
        older.clear();
      } finally {
        stop();
        cache.clear();
        server.clear();
      }
    },
  );

  it('preserves newer canonical reads when observing an older cached Bootstrap', async () => {
    const cache = new QueryClient();
    const member = {
      id: human.id,
      name: 'Bob',
      image: '/bob.png',
      email: 'u@orbit.test',
      handle: null,
      role: 'member' as const,
    };
    cache.setQueryData(queryKeys.bootstrap(null), bootstrap([member]), { updatedAt: 1 });
    const carol = { ...human, name: 'Carol', avatar: '/carol.png' };
    const row = issue({ creator: carol, assignee: carol, owner: carol });
    cache.setQueryData(
      queryKeys.issues('team_1'),
      { pages: [{ issues: [row], nextCursor: null }], pageParams: [null] },
      { updatedAt: 2 },
    );
    const stop = observeIssueActorProfiles(cache, 'org_1', ['team_1']);
    try {
      expect(replayIssueActorProfiles(cache, issue()).creator).toEqual(carol);
      recordMemberActorUpdate(
        cache,
        action({ userId: human.id, name: 'After event' }, 20),
        'org_1',
      );
      await cache.fetchQuery({
        queryKey: queryKeys.bootstrap(null),
        queryFn: async () => bootstrap([{ ...member, name: 'Dave', image: null }]),
      });
      recordMemberActorUpdate(cache, action({ userId: human.id, name: 'Stale' }, 19), 'org_1');
      expect(replayIssueActorProfiles(cache, row).owner).toEqual({
        ...human,
        name: 'Dave',
        avatar: null,
      });
    } finally {
      stop();
      cache.clear();
    }
  });

  it('retains accepted identity information when the observer remounts after a manual Bootstrap update', () => {
    const cache = new QueryClient();
    const member = {
      id: human.id,
      name: 'Bob',
      image: '/bob.png',
      email: 'u@orbit.test',
      handle: null,
      role: 'member' as const,
    };
    const key = queryKeys.issues('team_1');
    cache.setQueryData(
      queryKeys.bootstrap(null),
      { ...bootstrap([member]), issues: [issue()] },
      { updatedAt: 1 },
    );
    cache.setQueryData(
      key,
      { pages: [{ issues: [issue()], nextCursor: null }], pageParams: [null] },
      { updatedAt: 1 },
    );
    const firstStop = observeIssueActorProfiles(cache, 'org_1', ['team_1']);
    recordMemberActorUpdate(
      cache,
      action({ userId: human.id, name: 'Carol', image: null }),
      'org_1',
    );
    cache.setQueryData(
      queryKeys.bootstrap(null),
      { ...bootstrap([member]), issues: [issue()] },
      { updatedAt: Date.now() + 1_000 },
    );
    firstStop();
    const stop = observeIssueActorProfiles(cache, 'org_1', ['team_1']);
    try {
      expect(replayIssueActorProfiles(cache, issue()).owner?.name).toBe('Carol');
      expect(cache.getQueryData<IssuePages>(key)?.pages[0]?.issues[0]?.creator?.name).toBe('Carol');
      expect(cache.getQueryState(key)?.dataUpdatedAt).toBe(1);
    } finally {
      stop();
      cache.clear();
    }
  });

  it('seeds only workspace Human profiles and retains missing members, typed Agents, deleted flags and NULL owners', async () => {
    const cache = client();
    const agent = { ...human, type: 'agent' as const, deleted: true };
    const historical = { ...human, id: 'absent', name: 'Historical' };
    const legacyAgentMember = { ...human, id: 'agent_member', name: 'Canonical' };
    const rows = [
      issue({ creator: { ...human, deleted: true }, assignee: agent, owner: null }),
      issue({ id: 'missing', creatorId: historical.id, creator: historical }),
      issue({ id: 'other', organizationId: 'org_other' }),
      issue({ id: 'legacy', organizationId: '' }),
      issue({ id: 'unknown', organizationId: '', teamId: 'unknown' }),
      issue({ id: 'agent_member', creatorId: legacyAgentMember.id, creator: legacyAgentMember }),
    ];
    const key = queryKeys.issues('team_1');
    cache.setQueryData(key, { pages: [{ issues: rows, nextCursor: null }], pageParams: [null] });
    await cache.fetchQuery({
      queryKey: queryKeys.bootstrap(null),
      queryFn: async () =>
        bootstrap([
          {
            id: human.id,
            name: 'Carol',
            image: null,
            email: 'u@orbit.test',
            handle: null,
            role: 'member',
          },
          {
            id: legacyAgentMember.id,
            name: 'Legacy Agent',
            image: null,
            email: 'a@orbit.test',
            handle: null,
            role: 'member',
            isAgent: true,
          },
        ]),
    });
    const current = cache.getQueryData<IssuePages>(key)?.pages[0]?.issues;
    expect(current?.[0]?.creator).toEqual({ ...human, name: 'Carol', avatar: null, deleted: true });
    expect(current?.[0]?.assignee).toEqual(agent);
    expect(current?.[0]?.owner).toBeNull();
    expect(current?.[1]?.creator).toEqual(historical);
    expect(current?.[2]?.creator).toEqual(human);
    expect(current?.[3]?.creator?.name).toBe('Carol');
    expect(current?.[4]?.creator).toEqual(human);
    expect(current?.[5]?.creator).toEqual(legacyAgentMember);
    cache.clear();
  });

  it('patches every cache occurrence and fences late reads without changing Issue versions', () => {
    const cache = client();
    const row = issue();
    const pages: IssuePages = { pages: [{ issues: [row], nextCursor: null }], pageParams: [null] };
    const detail: IssueDetail = {
      issue: row,
      descriptionHtml: 'Body',
      parent: row,
      subIssues: [row],
      subscribed: false,
      activity: [],
      activityCursor: null,
      attachments: [],
    };
    const relations: IssueRelation[] = [{ id: 'r_1', type: 'related', issue: row }];
    const board: BoardPage = {
      groups: [{ id: human.id, total: 1, issues: [row], nextCursor: null }],
      truncated: false,
    };
    const seed = { ...bootstrap(), issues: [row] };
    cache.setQueryData(queryKeys.issues('team_1'), pages);
    cache.setQueryData(queryKeys.issue(row.identifier), detail);
    cache.setQueryData(queryKeys.issueRelations('other'), relations);
    cache.setQueryData(queryKeys.boardPage(''), board);
    cache.setQueryData(queryKeys.bootstrap(null), seed);
    const mutationRevision = issueMutationRevisionGeneration(cache, row.id);
    const cacheRevision = issueCacheRevisionGeneration(cache);
    const listKey = queryKeys.issues('team_1');
    const listRevision = issueListRevisionGeneration(cache, listKey);
    const mutationListRevision = issueMutationListRevisionGeneration(cache, listKey);
    recordMemberActorUpdate(
      cache,
      action({ userId: human.id, name: 'New name', image: null }),
      'org_1',
    );
    const updated = replayIssueActorProfiles(cache, row);
    for (const role of ['creator', 'assignee', 'owner'] as const)
      expect(updated[role]).toEqual({ ...human, name: 'New name', avatar: null });
    expect(updated.syncId).toBe(row.syncId);
    expect(issueMutationRevisionGeneration(cache, row.id)).toBe(mutationRevision);
    expect(issueCacheRevisionGeneration(cache)).toBeGreaterThan(cacheRevision);
    expect(issueListRevisionGeneration(cache, listKey)).toBeGreaterThan(listRevision);
    expect(issueMutationListRevisionGeneration(cache, listKey)).toBe(mutationListRevision);
    recordIssueListRevisions(cache, [listKey]);
    expect(issueMutationListRevisionGeneration(cache, listKey)).toBe(mutationListRevision + 1);
    const readRows = () => [
      cache.getQueryData<IssuePages>(queryKeys.issues('team_1'))?.pages[0]?.issues[0],
      cache.getQueryData<IssueDetail>(queryKeys.issue(row.identifier))?.issue,
      cache.getQueryData<IssueDetail>(queryKeys.issue(row.identifier))?.parent,
      cache.getQueryData<IssueDetail>(queryKeys.issue(row.identifier))?.subIssues[0],
      cache.getQueryData<IssueRelation[]>(queryKeys.issueRelations('other'))?.[0]?.issue,
      cache.getQueryData<BoardPage>(queryKeys.boardPage(''))?.groups[0]?.issues[0],
      cache.getQueryData<Bootstrap>(queryKeys.bootstrap(null))?.issues[0],
    ];
    expect(readRows()).toEqual(Array.from({ length: 7 }, () => updated));
    cache.setQueryData(queryKeys.issue(row.identifier), detail);
    expect(readRows()).toEqual(Array.from({ length: 7 }, () => updated));
  });

  it('applies only present profile fields and preserves deleted status, Agent type and NULL owner', () => {
    const cache = client();
    const row = issue({ creator: { ...human, deleted: true }, owner: null });
    recordMemberActorUpdate(cache, action({ userId: human.id, name: 'Renamed' }), 'org_1');
    expect(replayIssueActorProfiles(cache, row).creator).toEqual({
      ...human,
      name: 'Renamed',
      deleted: true,
    });
    recordMemberActorUpdate(cache, action({ userId: human.id, image: null }, 21), 'org_1');
    recordMemberActorUpdate(
      cache,
      action({ userId: human.id, name: 'Stale', image: '/stale.png' }, 19),
      'org_1',
    );
    const agent = { ...human, type: 'agent' as const };
    const updated = replayIssueActorProfiles(cache, { ...row, assignee: agent });
    expect(updated.creator).toEqual({ ...human, name: 'Renamed', avatar: null, deleted: true });
    expect(updated.assignee).toBe(agent);
    expect(updated.owner).toBeNull();
  });

  it('waits for refreshed bootstrap data and leaves absent members and deletions intact', () => {
    const cache = client();
    const row = issue();
    recordMemberActorUpdate(
      cache,
      action({ id: 'membership_1', userId: human.id, role: 'admin' }),
      'org_1',
    );
    expect(replayIssueActorProfiles(cache, row)).toBe(row);
    cache.setQueryData(queryKeys.bootstrap(null), bootstrap());
    expect(replayIssueActorProfiles(cache, row)).toBe(row);
    cache.setQueryData(
      queryKeys.bootstrap(null),
      bootstrap([
        {
          id: human.id,
          name: 'Fresh',
          image: '/fresh.png',
          email: 'u@orbit.test',
          handle: null,
          role: 'member',
        },
      ]),
    );
    expect(replayIssueActorProfiles(cache, row).owner?.name).toBe('Fresh');
    recordMemberActorUpdate(
      cache,
      { ...action({ userId: human.id }, 22), action: 'delete' },
      'org_1',
    );
    expect(replayIssueActorProfiles(cache, row).owner?.deleted).toBe(false);
  });

  it('cancels a bootstrap read started before the profile event and consumes its fresh replacement', async () => {
    const cache = client();
    const old = bootstrap([
      {
        id: human.id,
        name: human.name,
        image: human.avatar,
        email: 'u@orbit.test',
        handle: null,
        role: 'member',
      },
    ]);
    const fresh = { ...old, members: old.members.map((member) => ({ ...member, name: 'Fresh' })) };
    const key = queryKeys.bootstrap(null);
    cache.setQueryData(key, old);
    let resolveOld: ((value: Bootstrap) => void) | undefined;
    let resolveFresh: ((value: Bootstrap) => void) | undefined;
    const oldPromise = new Promise<Bootstrap>((resolve) => {
      resolveOld = resolve;
    });
    const freshPromise = new Promise<Bootstrap>((resolve) => {
      resolveFresh = resolve;
    });
    let reads = 0;
    const queryFn = () => (++reads === 1 ? oldPromise : freshPromise);
    const observer = new QueryObserver(cache, {
      queryKey: key,
      queryFn,
      staleTime: Number.POSITIVE_INFINITY,
    });
    const unsubscribe = observer.subscribe(() => undefined);
    const pending = cache.fetchQuery({ queryKey: key, queryFn }).catch(() => undefined);
    try {
      recordMemberActorUpdate(cache, action({ userId: human.id, role: 'member' }), 'org_1');
      await waitFor(() => expect(reads).toBe(2));
      if (resolveOld === undefined || resolveFresh === undefined)
        throw new Error('Missing resolver');
      resolveOld(old);
      await pending;
      expect(replayIssueActorProfiles(cache, issue()).creator?.name).toBe(human.name);
      resolveFresh(fresh);
      await waitFor(() =>
        expect(replayIssueActorProfiles(cache, issue()).creator?.name).toBe('Fresh'),
      );
    } finally {
      unsubscribe();
    }
  });

  it('limits legacy cache fallback to known workspace teams and rejects conflicting organizations', () => {
    const cache = client();
    recordMemberActorUpdate(
      cache,
      action({ userId: human.id, organizationId: 'org_other', name: 'Leaked' }),
      'org_1',
    );
    expect(replayIssueActorProfiles(cache, issue()).creator?.name).toBe('Old name');
    recordMemberActorUpdate(
      cache,
      { ...action({ userId: human.id, name: 'Leaked' }), organizationId: 'org_other' },
      'org_1',
    );
    recordMemberActorUpdate(cache, action({ userId: human.id, name: 'Known' }), 'org_1');
    expect(replayIssueActorProfiles(cache, issue({ organizationId: '' })).creator?.name).toBe(
      'Known',
    );
    expect(
      replayIssueActorProfiles(cache, issue({ organizationId: '', teamId: 'unknown' })).creator
        ?.name,
    ).toBe('Old name');
    expect(
      replayIssueActorProfiles(cache, issue({ organizationId: 'org_other' })).creator?.name,
    ).toBe('Old name');
  });

  it.each(['bootstrap', 'detail'] as const)(
    'accepts authoritative %s reads after missed profile events rather than replaying old names',
    async (source) => {
      const cache = client();
      recordMemberActorUpdate(
        cache,
        action({ userId: human.id, name: 'Bob', image: '/bob.png' }),
        'org_1',
      );
      const carol = { ...human, name: 'Carol', avatar: '/carol.png' };
      const row = issue({ creator: carol, assignee: carol, owner: carol });
      if (source === 'bootstrap') {
        await cache.fetchQuery({
          queryKey: queryKeys.bootstrap(null),
          queryFn: async () =>
            bootstrap([
              {
                id: human.id,
                name: 'Carol',
                image: '/carol.png',
                email: 'u@orbit.test',
                handle: null,
                role: 'member',
              },
            ]),
        });
      } else {
        await cache.fetchQuery({
          queryKey: queryKeys.issue(row.identifier),
          queryFn: async () => ({
            issue: row,
            descriptionHtml: '',
            activity: [],
            activityCursor: null,
            attachments: [],
            parent: null,
            subIssues: [],
            subscribed: false,
          }),
        });
      }
      expect(replayIssueActorProfiles(cache, issue()).creator).toEqual(carol);
      cache.setQueryData(queryKeys.issues('team_1'), {
        pages: [{ issues: [issue()], nextCursor: null }],
        pageParams: [null],
      });
      expect(
        cache.getQueryData<IssuePages>(queryKeys.issues('team_1'))?.pages[0]?.issues[0]?.creator,
      ).toEqual(carol);
    },
  );

  it('refreshes restored legacy caches while retaining explicit null and typed Agent references', () => {
    const cache = client();
    const {
      creator: _creator,
      assignee: _assignee,
      ...legacy
    } = issue({
      organizationId: '',
      assigneeId: null,
      assigneeAgentId: 'agent_1',
      owner: null,
    });
    const restored = restorable({
      buster: '1:user_1:org_1',
      timestamp: 1,
      clientState: {
        mutations: [],
        queries: [
          {
            queryKey: queryKeys.issues('team_1'),
            queryHash: 'issues',
            state: {
              data: { pages: [{ issues: [legacy], nextCursor: null }], pageParams: [null] },
            },
          },
        ],
      },
    });
    cache.setQueryData(queryKeys.issues('team_1'), restored.clientState.queries[0]?.state.data);
    recordMemberActorUpdate(
      cache,
      action({ userId: human.id, name: 'Fresh', image: null }),
      'org_1',
    );
    const row = cache.getQueryData<IssuePages>(queryKeys.issues('team_1'))?.pages[0]?.issues[0];
    expect(row?.creator?.name).toBe('Fresh');
    expect(row?.assignee).toBeUndefined();
    expect(row?.assigneeAgentId).toBe('agent_1');
    expect(row?.owner).toBeNull();
  });
});

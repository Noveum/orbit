import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import * as coreModule from '@orbit/core';
import type { Principal } from '@orbit/shared/policy';
import * as bootstrapModule from '@/lib/api/bootstrap.ts';
import * as issuesModule from '@/lib/api/issues.ts';

const CORE_MODULE = '@orbit/core';
const BOOTSTRAP_MODULE = '@/lib/api/bootstrap.ts';
const ISSUES_MODULE = '@/lib/api/issues.ts';

const realCore = { ...coreModule };
const realBootstrap = { ...bootstrapModule };
const realIssues = { ...issuesModule };

const principal: Principal = {
  userId: 'user-1',
  organizationId: 'org-1',
  role: 'admin',
  teamIds: ['team-1'],
};

const team = { id: 'team-1', key: 'NOVA', name: 'Nova' };

const payload = {
  userId: 'user-1',
  organizationId: 'org-1',
  role: 'admin',
  teams: [],
  activeTeamId: 'team-1',
  states: [],
  labels: [],
  members: [],
  projects: [],
  cycles: [],
  issues: [],
};

let started: string[] = [];
let release: Array<() => void> = [];

function held<T>(name: string, value: T) {
  return () => {
    started.push(name);
    return new Promise<T>((resolve) => {
      release.push(() => {
        resolve(value);
      });
    });
  };
}

mock.module(BOOTSTRAP_MODULE, () => ({
  ...realBootstrap,
  bootstrapTeams: held('teams', { teams: [team], activeTeam: team }),
  bootstrapPayloadFor: held('payload', payload),
}));

mock.module(CORE_MODULE, () => ({
  ...realCore,
  listIssues: held('issues', { issues: [], nextCursor: null }),
}));

mock.module(ISSUES_MODULE, () => ({ ...realIssues, attachLabels: () => Promise.resolve([]) }));

afterAll(() => {
  mock.module(BOOTSTRAP_MODULE, () => realBootstrap);
  mock.module(CORE_MODULE, () => realCore);
  mock.module(ISSUES_MODULE, () => realIssues);
});

const { dehydratedWorkspace } = await import('@/lib/query/prefetch.ts');

async function settle(): Promise<void> {
  for (let tick = 0; tick < 5; tick += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function releaseAll(): void {
  for (const resolve of release.splice(0)) resolve();
}

describe('dehydratedWorkspace', () => {
  beforeEach(() => {
    started = [];
    release = [];
  });

  it('resolves the active team before anything that needs it', async () => {
    const pending = dehydratedWorkspace(principal);
    await settle();

    expect(started).toEqual(['teams']);

    releaseAll();
    await settle();
    releaseAll();
    await pending;
  });

  it('loads the rest of the bootstrap and the first issue page concurrently', async () => {
    const pending = dehydratedWorkspace(principal);
    await settle();
    releaseAll();
    await settle();

    expect(started.slice(1).toSorted()).toEqual(['issues', 'payload']);

    releaseAll();
    await pending;
  });

  it('dehydrates both the bootstrap and the issue list', async () => {
    const pending = dehydratedWorkspace(principal);
    await settle();
    releaseAll();
    await settle();
    releaseAll();

    const state = await pending;
    const roots = state.queries.map((query) => String(query.queryKey[0])).toSorted();

    expect(roots).toEqual(['bootstrap', 'issues']);
  });
});

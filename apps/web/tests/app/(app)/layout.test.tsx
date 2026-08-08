import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import * as coreModule from '@orbit/core';
import type { MembershipContext } from '@/lib/auth/principal.ts';
import * as principalModule from '@/lib/auth/principal.ts';
import * as prefetchModule from '@/lib/query/prefetch.ts';
import * as workspaceModule from '@/lib/workspace.ts';
import { mockSession } from '../../../tests-support.ts';

const CORE_MODULE = '@orbit/core';
const PRINCIPAL_MODULE = '@/lib/auth/principal.ts';
const WORKSPACE_MODULE = '@/lib/workspace.ts';
const PREFETCH_MODULE = '@/lib/query/prefetch.ts';

const realCore = { ...coreModule };
const realPrincipal = { ...principalModule };
const realWorkspace = { ...workspaceModule };
const realPrefetch = { ...prefetchModule };

const membership: MembershipContext = {
  memberId: 'member-1',
  organizationName: 'Noveum',
  organizationSlug: 'noveum',
  principal: {
    userId: 'user-1',
    organizationId: 'org-1',
    role: 'admin',
    teamIds: ['team-1'],
  },
};

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

let started: string[] = [];
let release: Array<() => void> = [];

mockSession(() => ({
  user: { id: 'user-1', name: 'Ada', email: 'ada@noveum.ai', image: null },
  session: { activeOrganizationId: 'org-1' },
}));

mock.module(CORE_MODULE, () => ({
  ...realCore,
  getOnboardingStatus: held('onboarding', { completed: true }),
  listOrganizationsForUser: held('organizations', [
    { organization: { id: 'org-1', name: 'Noveum', slug: 'noveum' } },
  ]),
}));

mock.module(PRINCIPAL_MODULE, () => ({
  ...realPrincipal,
  resolveMembership: held('membership', membership),
}));

mock.module(WORKSPACE_MODULE, () => ({
  ...realWorkspace,
  listTeamsForPrincipal: held('teams', []),
}));

mock.module(PREFETCH_MODULE, () => ({
  ...realPrefetch,
  dehydratedWorkspace: held('dehydrated', { mutations: [], queries: [] }),
}));

afterAll(() => {
  mock.module(CORE_MODULE, () => realCore);
  mock.module(PRINCIPAL_MODULE, () => realPrincipal);
  mock.module(WORKSPACE_MODULE, () => realWorkspace);
  mock.module(PREFETCH_MODULE, () => realPrefetch);
});

const { default: WorkspaceLayout } = await import('@/app/(app)/layout.tsx');

async function settle(): Promise<void> {
  for (let tick = 0; tick < 5; tick += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function releaseAll(): void {
  for (const resolve of release.splice(0)) resolve();
}

describe('WorkspaceLayout', () => {
  beforeEach(() => {
    started = [];
    release = [];
  });

  it('loads onboarding, membership and workspaces concurrently', async () => {
    const rendered = WorkspaceLayout({ children: null });
    await settle();

    expect(started.toSorted()).toEqual(['membership', 'onboarding', 'organizations']);

    releaseAll();
    await settle();
    releaseAll();
    await rendered;
  });

  it('loads the teams and the dehydrated workspace concurrently', async () => {
    const rendered = WorkspaceLayout({ children: null });
    await settle();
    releaseAll();
    await settle();

    expect(started.slice(3).toSorted()).toEqual(['dehydrated', 'teams']);

    releaseAll();
    await rendered;
  });
});

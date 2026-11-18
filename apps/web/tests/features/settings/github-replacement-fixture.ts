import { afterEach } from 'bun:test';
import { generateKeyPairSync, randomInt } from 'node:crypto';
import { createOrganization, resolvePrincipal } from '@orbit/core';
import type { Workspace } from '@orbit/core/test-support';
import { and, db, eq, schema } from '@orbit/db';
import {
  bindGithubInstallation,
  forgetGithubInstallationTokens,
  type GithubInstalledRepository,
  linkGithubRepository,
} from '@orbit/services';
import { randomUUIDv7 } from '@orbit/shared/utils';
import { completeGithubInstall } from '../../../src/features/settings/github-connect.ts';
import type { GithubAppConfig } from '../../../src/lib/env.ts';

const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

export const replacementConfig: GithubAppConfig = {
  slug: 'fixture-boundary',
  appId: '123456',
  privateKey,
  clientId: 'local-boundary-client',
  clientSecret: 'local-boundary-secret',
};

const ownedOrganizationIds = new Set<string>();
const ownedUserIds = new Set<string>();

afterEach(async () => {
  for (const id of ownedOrganizationIds)
    await db.delete(schema.organization).where(eq(schema.organization.id, id));
  ownedOrganizationIds.clear();
  for (const id of ownedUserIds) await db.delete(schema.user).where(eq(schema.user.id, id));
  ownedUserIds.clear();
  forgetGithubInstallationTokens();
});

async function replacementUser(name: string): Promise<typeof schema.user.$inferSelect> {
  const id = randomUUIDv7();
  ownedUserIds.add(id);
  const [adminUser] = await db
    .insert(schema.user)
    .values({
      id,
      name,
      email: `replacement-${id}@orbit.test`,
      handle: `replacement-${id}`,
      emailVerified: true,
    })
    .returning();
  if (adminUser === undefined) throw new Error('Fixture user missing');
  return adminUser;
}

export async function replacementAdministrator(
  organizationId: string,
): Promise<typeof schema.user.$inferSelect> {
  const user = await replacementUser('Replacement second administrator');
  await db
    .insert(schema.member)
    .values({ id: randomUUIDv7(), organizationId, userId: user.id, role: 'admin' });
  return user;
}

export async function replacementWorkspace(): Promise<Workspace> {
  const adminUser = await replacementUser('Replacement administrator');
  const id = adminUser.id;
  const bootstrap = await createOrganization(id, {
    name: 'ReplacementBoundaries',
    slug: `replacement-${randomUUIDv7()}`,
  });
  ownedOrganizationIds.add(bootstrap.organization.id);
  const admin = await resolvePrincipal(id, bootstrap.organization.id);
  return {
    organizationId: bootstrap.organization.id,
    teamId: bootstrap.team.id,
    admin,
    adminUser,
    states: bootstrap.states,
  };
}

export function replacementRepository(
  repositoryId = '11',
  name = 'renamed',
): GithubInstalledRepository {
  return {
    repositoryId,
    repositoryName: `fixture-account/${name}`,
    name,
    ownerLogin: 'fixture-account',
    private: true,
    archived: false,
    defaultBranch: 'main',
    htmlUrl: `https://github.com/fixture-account/${name}`,
  };
}

export function repositoryPayload(repository: GithubInstalledRepository): Record<string, unknown> {
  return {
    id: Number(repository.repositoryId),
    name: repository.name,
    full_name: repository.repositoryName,
    private: repository.private,
    archived: repository.archived,
    default_branch: repository.defaultBranch,
    html_url: repository.htmlUrl,
    owner: { login: repository.ownerLogin },
  };
}

export function replacementBarrier() {
  let enter: () => void = () => undefined;
  let resume: () => void = () => undefined;
  const arrived = new Promise<void>((resolve) => {
    enter = resolve;
  });
  const resumed = new Promise<void>((resolve) => {
    resume = resolve;
  });
  return {
    arrived,
    release: () => resume(),
    async hold(): Promise<void> {
      enter();
      await resumed;
    },
  };
}

export async function awaitReplacementBarrier<T>(
  arrived: Promise<void>,
  work: Promise<T>,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      arrived,
      work.then(() => {
        throw new Error('Work completed before the intended real-query or provider barrier');
      }),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error('Replacement fixture barrier was not reached')),
          2000,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export function observeReplacement<T>(work: Promise<T>) {
  return work.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );
}

export async function createReplacementFixture() {
  const workspace = await replacementWorkspace();
  const oldId = String(randomInt(1_000_000, 2 ** 47));
  const newId = String(Number(oldId) + 1);
  const state: {
    oldAvailable: boolean;
    newRepositories: GithubInstalledRepository[];
    intercept?: (url: URL, init: RequestInit | undefined) => Promise<Response | undefined>;
  } = { oldAvailable: true, newRepositories: [replacementRepository()] };
  const counts = { oauth: 0, oldMetadata: 0, newMetadata: 0, installationTokens: 0 };
  const fetch: typeof globalThis.fetch = Object.assign(
    async (...args: Parameters<typeof globalThis.fetch>) => {
      const [input, init] = args;
      const url = new URL(input instanceof Request ? input.url : String(input));
      const intercepted = await state.intercept?.(url, init);
      if (intercepted !== undefined) return intercepted;
      if (url.origin === 'https://github.com' && url.pathname === '/login/oauth/access_token') {
        counts.oauth += 1;
        return Response.json({ access_token: 'local-boundary-user-proof' });
      }
      if (url.origin !== 'https://api.github.com') throw new Error('Unexpected fixture origin');
      if (url.pathname === '/user/installations')
        return Response.json({
          total_count: 2,
          installations: [{ id: Number(oldId) }, { id: Number(newId) }],
        });
      for (const id of [oldId, newId]) {
        if (url.pathname === `/app/installations/${id}/access_tokens`) {
          counts.installationTokens += 1;
          return Response.json({ token: `local-boundary-installation-${id}` }, { status: 201 });
        }
        if (url.pathname === `/app/installations/${id}`) {
          if (id === oldId) counts.oldMetadata += 1;
          else counts.newMetadata += 1;
          if (id === oldId && !state.oldAvailable) return new Response(null, { status: 404 });
          return Response.json({
            id: Number(id),
            app_id: Number(replacementConfig.appId),
            account: { id: 42, login: 'fixture-account', type: 'Organization' },
            repository_selection: 'selected',
            suspended_at: null,
          });
        }
      }
      if (url.pathname === '/installation/repositories') {
        const isNew =
          new Headers(init?.headers).get('authorization') ===
          `Bearer local-boundary-installation-${newId}`;
        const repositories = isNew
          ? state.newRepositories
          : [replacementRepository('11', 'original')];
        const page = Number(url.searchParams.get('page') ?? 1);
        return Response.json({
          total_count: repositories.length,
          repositories: repositories.slice((page - 1) * 100, page * 100).map(repositoryPayload),
        });
      }
      if (url.pathname.endsWith('/pulls')) return Response.json([]);
      throw new Error('Unexpected fixture route');
    },
    { preconnect: () => undefined },
  );
  const connect = (installationId: string, now?: Date) =>
    completeGithubInstall({
      organizationId: workspace.organizationId,
      userId: workspace.adminUser.id,
      installationId,
      code: `local-boundary-code-${randomUUIDv7()}`,
      config: replacementConfig,
      fetch,
      ...(now === undefined ? {} : { now }),
    });
  const original = await connect(oldId);
  const link = await linkGithubRepository(db, {
    organizationId: workspace.organizationId,
    repositoryId: '11',
    projectId: null,
    linkedById: workspace.adminUser.id,
  });
  const [catalogue] = await db
    .select()
    .from(schema.githubRepository)
    .where(eq(schema.githubRepository.installationRowId, original.id));
  const [watch] = await db
    .select()
    .from(schema.githubRepositorySync)
    .where(
      and(
        eq(schema.githubRepositorySync.organizationId, workspace.organizationId),
        eq(schema.githubRepositorySync.repositoryId, '11'),
      ),
    );
  if (catalogue === undefined || watch === undefined) throw new Error('Fixture graph missing');
  const pullId = randomUUIDv7();
  await db.insert(schema.githubPullRequest).values({
    id: pullId,
    organizationId: workspace.organizationId,
    repositorySyncId: watch.id,
    repositoryId: '11',
    repositoryName: catalogue.fullName,
    number: 7,
    url: 'https://github.com/fixture-account/original/pull/7',
    title: 'Current fixture title',
    headSha: 'a'.repeat(40),
    headEpoch: 3,
    state: 'open',
  });
  return {
    workspace,
    oldId,
    newId,
    state,
    counts,
    fetch,
    connect,
    original,
    catalogue,
    watch,
    link,
    pullId,
    async adopt(now?: Date) {
      state.oldAvailable = false;
      return await connect(newId, now);
    },
    async foreignParent() {
      return await db.transaction((tx) =>
        bindGithubInstallation(tx, {
          organizationId: workspace.organizationId,
          connectedById: workspace.adminUser.id,
          account: {
            installationId: String(Number(newId) + 1),
            accountId: '43',
            accountLogin: 'foreign-account',
            accountType: 'Organization',
            repositorySelection: 'selected',
            suspended: false,
          },
        }),
      );
    },
  };
}

export type ReplacementFixture = Awaited<ReturnType<typeof createReplacementFixture>>;

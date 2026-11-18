import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { generateKeyPairSync, randomInt } from 'node:crypto';
import { createWorkspace, type Workspace } from '@orbit/core/test-support';
import { and, db, eq, schema } from '@orbit/db';
import { forgetGithubInstallationTokens, linkGithubRepository } from '@orbit/services';
import { randomUUIDv7 } from '@orbit/shared/utils';
import { completeGithubInstall } from '../../../src/features/settings/github-connect.ts';
import type { GithubAppConfig } from '../../../src/lib/env.ts';

const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
const config: GithubAppConfig = {
  slug: 'fixture-replacement',
  appId: '123456',
  privateKey,
  clientId: 'local-replacement-client',
  clientSecret: 'local-replacement-secret',
};
let workspace: Workspace | undefined;

beforeEach(() => {
  forgetGithubInstallationTokens();
});

afterEach(async () => {
  if (workspace === undefined) return;
  await db.delete(schema.organization).where(eq(schema.organization.id, workspace.organizationId));
  await db.delete(schema.user).where(eq(schema.user.id, workspace.adminUser.id));
  workspace = undefined;
});

function fakeProvider(
  oldId: string,
  newId: string,
  oldAvailable: () => boolean,
): typeof globalThis.fetch {
  return Object.assign(
    (...args: Parameters<typeof globalThis.fetch>) => {
      const [input, init] = args;
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.origin === 'https://github.com' && url.pathname === '/login/oauth/access_token') {
        return Promise.resolve(Response.json({ access_token: 'local-user-installation-proof' }));
      }
      if (url.origin !== 'https://api.github.com')
        throw new Error('Unexpected fake provider origin');
      if (url.pathname === '/user/installations') {
        return Promise.resolve(
          Response.json({
            total_count: 2,
            installations: [{ id: Number(oldId) }, { id: Number(newId) }],
          }),
        );
      }
      for (const id of [oldId, newId]) {
        if (url.pathname === `/app/installations/${id}/access_tokens`) {
          return Promise.resolve(
            Response.json({ token: `local-installation-${id}` }, { status: 201 }),
          );
        }
        if (url.pathname === `/app/installations/${id}`) {
          if (id === oldId && !oldAvailable())
            return Promise.resolve(
              Response.json({ message: 'fixture unavailable' }, { status: 404 }),
            );
          return Promise.resolve(
            Response.json({
              id: Number(id),
              app_id: Number(config.appId),
              account: { id: 42, login: 'fixture-account', type: 'Organization' },
              target_type: 'Organization',
              repository_selection: 'selected',
              suspended_at: null,
            }),
          );
        }
      }
      if (url.pathname === '/installation/repositories') {
        const isNew =
          new Headers(init?.headers).get('authorization') === `Bearer local-installation-${newId}`;
        const name = isNew ? 'renamed' : 'original';
        return Promise.resolve(
          Response.json({
            total_count: 1,
            repositories: [
              {
                id: 11,
                name,
                full_name: `fixture-account/${name}`,
                private: true,
                archived: false,
                default_branch: isNew ? 'main' : 'trunk',
                owner: { login: 'fixture-account' },
                html_url: `https://github.com/fixture-account/${name}`,
              },
            ],
          }),
        );
      }
      if (url.pathname.endsWith('/pulls')) return Promise.resolve(Response.json([]));
      throw new Error('Unexpected fake provider route');
    },
    { preconnect: () => undefined },
  );
}

describe('verified installation replacement persistence', () => {
  it('adopts the verified replacement in place while preserving policy and exhausted history', async () => {
    const current = await createWorkspace('Replacement');
    workspace = current;
    const oldId = String(randomInt(1_000_000, 2 ** 47));
    const newId = String(Number(oldId) + 1);
    let oldAvailable = true;
    const fetch = fakeProvider(oldId, newId, () => oldAvailable);
    const connect = (installationId: string) =>
      completeGithubInstall({
        organizationId: current.organizationId,
        userId: current.adminUser.id,
        installationId,
        code: 'local-verified-manager-code',
        config,
        fetch,
      });
    const original = await connect(oldId);
    const link = await linkGithubRepository(db, {
      organizationId: current.organizationId,
      repositoryId: '11',
      projectId: null,
      linkedById: current.adminUser.id,
    });
    const [catalogue] = await db
      .select()
      .from(schema.githubRepository)
      .where(eq(schema.githubRepository.installationRowId, original.id));
    const [sync] = await db
      .select()
      .from(schema.githubRepositorySync)
      .where(
        and(
          eq(schema.githubRepositorySync.organizationId, current.organizationId),
          eq(schema.githubRepositorySync.repositoryId, '11'),
        ),
      );
    if (catalogue === undefined || sync === undefined) throw new Error('Fixture graph missing');
    const historyAt = new Date('2026-11-01T00:00:00Z');
    await db
      .update(schema.integration)
      .set({ config: { opaquePolicy: 'preserve' }, credentials: { opaqueFixture: 'preserve' } })
      .where(eq(schema.integration.id, original.integrationId));
    await db
      .update(schema.githubRepositorySync)
      .set({ enabled: false, teamId: current.teamId, pullRequestsBackfilledAt: historyAt })
      .where(eq(schema.githubRepositorySync.id, sync.id));
    const pullId = randomUUIDv7();
    await db.insert(schema.githubPullRequest).values({
      id: pullId,
      organizationId: current.organizationId,
      repositorySyncId: sync.id,
      repositoryId: '11',
      repositoryName: catalogue.fullName,
      number: 7,
      url: 'https://github.com/fixture-account/original/pull/7',
      headSha: 'a'.repeat(40),
      headEpoch: 3,
      state: 'open',
    });
    const activityId = randomUUIDv7();
    await db.insert(schema.githubPullRequestActivity).values({
      id: activityId,
      organizationId: current.organizationId,
      pullRequestId: pullId,
      externalId: 'local-history',
      type: 'comment',
      action: 'created',
      body: 'Historical fixture',
      occurredAt: historyAt,
    });
    const headId = randomUUIDv7();
    await db.insert(schema.githubCheckHeadReconciliation).values({
      id: headId,
      organizationId: current.organizationId,
      repositorySyncId: sync.id,
      headSha: 'a'.repeat(40),
      status: 'failed',
      attempts: 8,
      jobVersion: 3,
      contextGeneration: 2,
      triggerKind: 'manual_recovery',
      triggerIdentity: 'local-preserved-generation',
      lastError: 'GitHub installation token returned HTTP 401.',
    });
    const [priorHead] = await db
      .select()
      .from(schema.githubCheckHeadReconciliation)
      .where(eq(schema.githubCheckHeadReconciliation.id, headId));
    const [priorActivity] = await db
      .select()
      .from(schema.githubPullRequestActivity)
      .where(eq(schema.githubPullRequestActivity.id, activityId));
    oldAvailable = false;

    const replacement = await connect(newId);

    expect(replacement.id).toBe(original.id);
    expect(replacement.integrationId).toBe(original.integrationId);
    expect(replacement.installationId).toBe(newId);
    const installations = await db
      .select()
      .from(schema.githubInstallation)
      .where(eq(schema.githubInstallation.organizationId, current.organizationId));
    expect(installations).toHaveLength(1);
    const [integration] = await db
      .select()
      .from(schema.integration)
      .where(eq(schema.integration.id, original.integrationId));
    expect(integration?.externalId).toBe(newId);
    expect(integration?.config).toEqual({ opaquePolicy: 'preserve' });
    expect(integration?.credentials).toEqual({ opaqueFixture: 'preserve' });
    const [retainedCatalogue] = await db
      .select()
      .from(schema.githubRepository)
      .where(eq(schema.githubRepository.id, catalogue.id));
    expect(retainedCatalogue?.installationRowId).toBe(original.id);
    expect(retainedCatalogue?.fullName).toBe('fixture-account/renamed');
    const [retainedLink] = await db
      .select()
      .from(schema.githubRepositoryLink)
      .where(eq(schema.githubRepositoryLink.id, link.id));
    expect(retainedLink).toEqual(link);
    const [retainedSync] = await db
      .select()
      .from(schema.githubRepositorySync)
      .where(eq(schema.githubRepositorySync.id, sync.id));
    expect(retainedSync?.installationId).toBe(newId);
    expect(retainedSync?.integrationId).toBe(original.integrationId);
    expect(retainedSync?.enabled).toBe(false);
    expect(retainedSync?.teamId).toBe(current.teamId);
    expect(retainedSync?.pullRequestsBackfilledAt).toEqual(historyAt);
    const [retainedPull] = await db
      .select()
      .from(schema.githubPullRequest)
      .where(eq(schema.githubPullRequest.id, pullId));
    expect(retainedPull?.repositorySyncId).toBe(sync.id);
    expect(retainedPull?.headSha).toBe('a'.repeat(40));
    expect(retainedPull?.headEpoch).toBe(3);
    expect(retainedPull?.state).toBe('open');
    const [retainedHead] = await db
      .select()
      .from(schema.githubCheckHeadReconciliation)
      .where(eq(schema.githubCheckHeadReconciliation.id, headId));
    const [retainedActivity] = await db
      .select()
      .from(schema.githubPullRequestActivity)
      .where(eq(schema.githubPullRequestActivity.id, activityId));
    expect(retainedHead).toEqual(priorHead);
    expect(retainedActivity).toEqual(priorActivity);
  });
});

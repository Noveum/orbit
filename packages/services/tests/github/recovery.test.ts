import { afterEach, describe, expect, it } from 'bun:test';
import { type Database, schema } from '@orbit/db';
import { randomUUIDv7 } from '@orbit/shared/utils';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { linkGithubRepository } from '../../src/github/associations.ts';
import {
  bindGithubInstallation,
  removeGithubInstallation,
  replaceGithubRepositories,
} from '../../src/github/installations.ts';
import { type GithubRecoveryInput, requestGithubCheckRecovery } from '../../src/github/recovery.ts';
import { GithubRecoveryProviderError } from '../../src/github/recovery-provider.ts';
import { removeGithubRepositorySyncs } from '../../src/github/watched.ts';
import { testDb } from '../../src/test-database.ts';
import { account, repository, seedWorkspace, type TestWorkspace } from './fixtures.ts';

const HEAD = '0123456789abcdef0123456789abcdef01234567';
const NEXT_HEAD = '123456789abcdef0123456789abcdef012345678';
const NOW = new Date('2026-11-17T12:00:00Z');
const created: TestWorkspace[] = [];
let sequence = 0;

async function seedTarget() {
  sequence += 1;
  return await testDb.transaction(async (tx) => {
    const workspace = await seedWorkspace(tx);
    const installationId = String(Date.now() * 100 + sequence);
    const installation = await bindGithubInstallation(tx, {
      organizationId: workspace.organizationId,
      connectedById: workspace.userId,
      account: account({ installationId, accountId: '500' }),
    });
    await replaceGithubRepositories(tx, {
      installation,
      repositories: [repository({ repositoryId: '99', repositoryName: 'fixture-owner/old-name' })],
    });
    await linkGithubRepository(tx, {
      organizationId: workspace.organizationId,
      repositoryId: '99',
      projectId: null,
      linkedById: workspace.userId,
    });
    const [watched] = await tx
      .select()
      .from(schema.githubRepositorySync)
      .where(eq(schema.githubRepositorySync.organizationId, workspace.organizationId));
    if (watched === undefined) throw new Error('Missing watched fixture');
    const reconciliationId = randomUUIDv7();
    const pullRequestId = randomUUIDv7();
    const historyId = randomUUIDv7();
    await tx.insert(schema.githubPullRequest).values({
      id: pullRequestId,
      organizationId: workspace.organizationId,
      repositorySyncId: watched.id,
      repositoryId: '99',
      repositoryName: watched.repositoryName,
      number: 7,
      url: 'https://github.com/fixture-owner/old-name/pull/7',
      headSha: HEAD,
      headEpoch: 2,
      state: 'open',
      providerUpdatedAt: new Date('2026-11-17T10:00:00Z'),
    });
    await tx.insert(schema.githubCheckHeadReconciliation).values({
      id: reconciliationId,
      organizationId: workspace.organizationId,
      repositorySyncId: watched.id,
      headSha: HEAD,
      status: 'failed',
      jobVersion: 3,
      contextGeneration: 2,
      attempts: 8,
      triggerKind: 'check_suite',
      triggerIdentity: 'original-failed-generation',
      lastError: 'GitHub installation token returned HTTP 401.',
      settleDeadline: new Date(NOW.getTime() - 1000),
    });
    await tx.insert(schema.githubCheckReconciliationFetch).values({
      id: historyId,
      organizationId: workspace.organizationId,
      repositorySyncId: watched.id,
      headReconciliationId: reconciliationId,
      headSha: HEAD,
      attemptNumber: 8,
      capturedJobVersion: 3,
      capturedContextGeneration: 2,
      claimToken: randomUUIDv7(),
      disposition: 'failed',
      failure: 'GitHub installation token returned HTTP 401.',
      completedAt: new Date(NOW.getTime() - 1000),
    });
    const [history] = await tx
      .select()
      .from(schema.githubCheckReconciliationFetch)
      .where(eq(schema.githubCheckReconciliationFetch.id, historyId));
    if (history === undefined) throw new Error('Missing fetch fixture');
    created.push(workspace);
    return {
      ...workspace,
      installationId,
      repositorySyncId: watched.id,
      history,
      selector: {
        reconciliationId,
        pullRequestId,
        expectedJobVersion: 3,
        expectedContextGeneration: 2,
        expectedHeadEpoch: 2,
        expectedHeadSha: HEAD,
      },
      provider: {
        installationId,
        appId: '123456',
        accountId: '500',
        repositoryId: '99',
        repositoryName: 'fixture-owner/current-name',
        externalId: '7007',
        number: 7,
        state: 'open' as const,
        merged: false,
        draft: false,
        headSha: HEAD,
        providerUpdatedAt: '2026-11-17T11:00:00.000Z',
      },
    };
  });
}

type Target = Awaited<ReturnType<typeof seedTarget>>;

function input(
  target: Target,
  verifyProvider: NonNullable<GithubRecoveryInput['verifyProvider']>,
): GithubRecoveryInput {
  return {
    organizationId: target.organizationId,
    userId: target.userId,
    selector: target.selector,
    appId: '123456',
    privateKey: 'fake-provider-verification-injected',
    now: NOW,
    verifyProvider,
  };
}

async function head(target: Target) {
  const [row] = await testDb
    .select()
    .from(schema.githubCheckHeadReconciliation)
    .where(eq(schema.githubCheckHeadReconciliation.id, target.selector.reconciliationId));
  return row;
}

afterEach(async () => {
  for (const workspace of created.splice(0)) {
    await removeGithubRepositorySyncs(
      testDb,
      eq(schema.githubRepositorySync.organizationId, workspace.organizationId),
    );
    await testDb
      .delete(schema.organization)
      .where(eq(schema.organization.id, workspace.organizationId));
    await testDb.delete(schema.user).where(eq(schema.user.id, workspace.userId));
  }
});

describe('exact GitHub current-head recovery', () => {
  it('denies a member before any provider request', async () => {
    const target = await seedTarget();
    await testDb
      .update(schema.member)
      .set({ role: 'member' })
      .where(
        and(
          eq(schema.member.organizationId, target.organizationId),
          eq(schema.member.userId, target.userId),
        ),
      );
    let requests = 0;
    await expect(
      requestGithubCheckRecovery(
        testDb,
        input(target, () => {
          requests += 1;
          return Promise.resolve(target.provider);
        }),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    expect(requests).toBe(0);
    expect((await head(target))?.attempts).toBe(8);
  });

  it('denies another workspace selector before any provider request', async () => {
    const target = await seedTarget();
    const other = await seedTarget();
    let requests = 0;
    await expect(
      requestGithubCheckRecovery(testDb, {
        ...input(target, () => {
          requests += 1;
          return Promise.resolve(target.provider);
        }),
        organizationId: other.organizationId,
        userId: other.userId,
      }),
    ).rejects.toMatchObject({ code: 'not_found' });
    expect(requests).toBe(0);
    expect((await head(target))?.attempts).toBe(8);
  });

  it('rejects a deleting workspace before any provider request', async () => {
    const target = await seedTarget();
    await testDb
      .update(schema.organization)
      .set({ deletionRequestedAt: NOW })
      .where(eq(schema.organization.id, target.organizationId));
    let requests = 0;
    await expect(
      requestGithubCheckRecovery(
        testDb,
        input(target, () => {
          requests += 1;
          return Promise.resolve(target.provider);
        }),
      ),
    ).rejects.toMatchObject({ code: 'conflict', details: { reason: 'workspace_unavailable' } });
    expect(requests).toBe(0);
  });

  it('queues an exhausted active head exactly once and preserves every historical fetch fact', async () => {
    const target = await seedTarget();
    const [originalPull] = await testDb
      .select()
      .from(schema.githubPullRequest)
      .where(eq(schema.githubPullRequest.id, target.selector.pullRequestId));
    let requests = 0;
    const request = input(target, (selected) => {
      requests += 1;
      expect(selected.installationId).toBe(target.installationId);
      expect(selected.accountId).toBe('500');
      expect(selected.repositoryId).toBe('99');
      expect(selected.pullRequestNumber).toBe(7);
      return Promise.resolve(target.provider);
    });
    expect(await requestGithubCheckRecovery(testDb, request)).toEqual({ status: 'queued' });
    const queued = await head(target);
    expect(queued).toMatchObject({
      status: 'pending',
      attempts: 0,
      jobVersion: 4,
      contextGeneration: 2,
      triggerKind: 'manual_recovery',
      settleDeadline: null,
      lastError: null,
      claimToken: null,
      leaseExpiresAt: null,
    });
    const history = await testDb
      .select()
      .from(schema.githubCheckReconciliationFetch)
      .where(eq(schema.githubCheckReconciliationFetch.id, target.history.id));
    expect(history).toEqual([target.history]);
    expect(await requestGithubCheckRecovery(testDb, request)).toEqual({ status: 'already_queued' });
    expect(requests).toBe(1);
    expect((await head(target))?.jobVersion).toBe(4);
    const [watched] = await testDb
      .select()
      .from(schema.githubRepositorySync)
      .where(eq(schema.githubRepositorySync.id, target.repositorySyncId));
    expect(watched?.repositoryName).toBe('fixture-owner/current-name');
    const [pull] = await testDb
      .select()
      .from(schema.githubPullRequest)
      .where(eq(schema.githubPullRequest.id, target.selector.pullRequestId));
    expect(pull?.providerUpdatedAt).toEqual(new Date('2026-11-17T10:00:00Z'));
    expect(pull).toEqual(originalPull);
  });

  it.each([
    { change: { jobVersion: 4 }, status: 'superseded' },
    { change: { contextGeneration: 3 }, status: 'superseded' },
    {
      change: {
        status: 'processing',
        claimToken: 'owned-live-claim',
        claimedAt: NOW,
        claimedJobVersion: 3,
        claimedContextGeneration: 2,
        leaseExpiresAt: new Date(NOW.getTime() + 60_000),
      },
      status: 'busy',
    },
  ])(
    'does not fetch or reset a stale or claimed generation: $status',
    async ({ change, status }) => {
      const target = await seedTarget();
      await testDb
        .update(schema.githubCheckHeadReconciliation)
        .set(change)
        .where(eq(schema.githubCheckHeadReconciliation.id, target.selector.reconciliationId));
      const before = await head(target);
      let requests = 0;
      expect(
        await requestGithubCheckRecovery(
          testDb,
          input(target, () => {
            requests += 1;
            return Promise.resolve(target.provider);
          }),
        ),
      ).toEqual({ status });
      expect(requests).toBe(0);
      expect(await head(target)).toEqual(before);
    },
  );

  it('rechecks a committed role revocation after provider I/O before changing the job', async () => {
    const target = await seedTarget();
    await expect(
      requestGithubCheckRecovery(
        testDb,
        input(target, async () => {
          await testDb
            .update(schema.member)
            .set({ role: 'member' })
            .where(
              and(
                eq(schema.member.organizationId, target.organizationId),
                eq(schema.member.userId, target.userId),
              ),
            );
          return target.provider;
        }),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    expect(await head(target)).toMatchObject({ status: 'failed', attempts: 8, jobVersion: 3 });
  });

  it('does not recreate an installation or job removed during provider I/O', async () => {
    const target = await seedTarget();
    expect(
      await requestGithubCheckRecovery(
        testDb,
        input(target, async () => {
          expect(await removeGithubInstallation(testDb, target)).toBe(true);
          return target.provider;
        }),
      ),
    ).toEqual({ status: 'superseded' });
    expect(await head(target)).toBeUndefined();
    const installations = await testDb
      .select()
      .from(schema.githubInstallation)
      .where(eq(schema.githubInstallation.installationId, target.installationId));
    expect(installations).toHaveLength(0);
  });

  it('preserves a newer genuine generation that arrives during provider I/O', async () => {
    const target = await seedTarget();
    expect(
      await requestGithubCheckRecovery(
        testDb,
        input(target, async () => {
          await testDb
            .update(schema.githubCheckHeadReconciliation)
            .set({
              jobVersion: 4,
              status: 'pending',
              triggerKind: 'check_suite',
              triggerIdentity: 'new-genuine-event',
            })
            .where(eq(schema.githubCheckHeadReconciliation.id, target.selector.reconciliationId));
          return target.provider;
        }),
      ),
    ).toEqual({ status: 'superseded' });
    expect(await head(target)).toMatchObject({
      jobVersion: 4,
      triggerIdentity: 'new-genuine-event',
      attempts: 8,
    });
  });

  it.each([
    { snapshot: { state: 'closed' as const, merged: false }, status: 'not_active' },
    { snapshot: { state: 'closed' as const, merged: true }, status: 'not_active' },
    { snapshot: { headSha: NEXT_HEAD }, status: 'head_changed' },
  ])(
    'does not queue a remotely inactive or different head: $status',
    async ({ snapshot, status }) => {
      const target = await seedTarget();
      expect(
        await requestGithubCheckRecovery(
          testDb,
          input(target, async () => ({
            ...target.provider,
            ...snapshot,
          })),
        ),
      ).toEqual({ status });
      expect(await head(target)).toMatchObject({ jobVersion: 3, attempts: 8, status: 'failed' });
    },
  );

  it('retains the idempotent queued result when a retried client has already expired', async () => {
    const target = await seedTarget();
    const first = input(target, async () => target.provider);
    expect(await requestGithubCheckRecovery(testDb, first)).toEqual({ status: 'queued' });
    const controller = new AbortController();
    controller.abort();
    let requests = 0;
    expect(
      await requestGithubCheckRecovery(testDb, {
        ...input(target, () => {
          requests += 1;
          return Promise.resolve(target.provider);
        }),
        signal: controller.signal,
      }),
    ).toEqual({ status: 'already_queued' });
    expect(requests).toBe(0);
  });

  it('does not queue when a client expires before the final write', async () => {
    const target = await seedTarget();
    const controller = new AbortController();
    expect(
      await requestGithubCheckRecovery(testDb, {
        ...input(target, () => {
          controller.abort();
          return Promise.resolve(target.provider);
        }),
        signal: controller.signal,
      }),
    ).toEqual({ status: 'expired' });
    expect(await head(target)).toMatchObject({ jobVersion: 3, attempts: 8, status: 'failed' });
  });

  it.each([
    {
      reason: 'github_provider_http_error' as const,
      operation: 'installation' as const,
      httpStatus: 401,
      status: 'provider_authentication_failed',
    },
    {
      reason: 'github_provider_http_error' as const,
      operation: 'installation' as const,
      httpStatus: 404,
      status: 'installation_unavailable',
    },
    {
      reason: 'github_provider_http_error' as const,
      operation: 'installation token' as const,
      httpStatus: 404,
      status: 'installation_unavailable',
    },
    {
      reason: 'github_provider_http_error' as const,
      operation: 'installation token' as const,
      httpStatus: 422,
      status: 'repository_access_required',
    },
    {
      reason: 'github_provider_http_error' as const,
      operation: 'repository' as const,
      httpStatus: 404,
      status: 'repository_unavailable',
    },
    {
      reason: 'github_provider_http_error' as const,
      operation: 'pull request' as const,
      httpStatus: 404,
      status: 'pull_request_unavailable',
    },
    {
      reason: 'github_provider_http_error' as const,
      operation: 'installation' as const,
      httpStatus: 403,
      status: 'provider_temporarily_unavailable',
    },
    {
      reason: 'github_provider_http_error' as const,
      operation: 'installation' as const,
      httpStatus: 429,
      status: 'provider_temporarily_unavailable',
    },
    {
      reason: 'github_installation_suspended' as const,
      operation: 'installation' as const,
      httpStatus: undefined,
      status: 'installation_suspended',
    },
    {
      reason: 'github_provider_payload_invalid' as const,
      operation: 'installation' as const,
      httpStatus: undefined,
      status: 'provider_temporarily_unavailable',
    },
  ])(
    'classifies a provider failure without changing attempts or history: $status',
    async ({ reason, operation, httpStatus, status }) => {
      const target = await seedTarget();
      const before = await head(target);
      expect(
        await requestGithubCheckRecovery(
          testDb,
          input(target, () => {
            return Promise.reject(new GithubRecoveryProviderError(reason, operation, httpStatus));
          }),
        ),
      ).toEqual({ status });
      expect(await head(target)).toEqual(before);
      expect(
        await testDb
          .select()
          .from(schema.githubCheckReconciliationFetch)
          .where(eq(schema.githubCheckReconciliationFetch.id, target.history.id)),
      ).toEqual([target.history]);
    },
  );

  it('does not accept a stale provider snapshot that predates the stored pull state', async () => {
    const target = await seedTarget();
    expect(
      await requestGithubCheckRecovery(
        testDb,
        input(target, async () => ({
          ...target.provider,
          providerUpdatedAt: '2026-11-17T09:00:00.000Z',
        })),
      ),
    ).toEqual({ status: 'superseded' });
    expect(await head(target)).toMatchObject({ jobVersion: 3, attempts: 8, status: 'failed' });
  });

  it('accepts exactly one generation when two managers verify the same selector concurrently', async () => {
    const target = await seedTarget();
    let verified = 0;
    let release: (() => void) | undefined;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const verify: NonNullable<GithubRecoveryInput['verifyProvider']> = async () => {
      verified += 1;
      if (verified === 2) release?.();
      await barrier;
      return target.provider;
    };
    const results = await Promise.all([
      requestGithubCheckRecovery(testDb, input(target, verify)),
      requestGithubCheckRecovery(testDb, input(target, verify)),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual(['already_queued', 'queued']);
    expect(verified).toBe(2);
    expect(await head(target)).toMatchObject({
      jobVersion: 4,
      attempts: 0,
      triggerKind: 'manual_recovery',
    });
    expect(
      await testDb
        .select()
        .from(schema.githubCheckReconciliationFetch)
        .where(eq(schema.githubCheckReconciliationFetch.id, target.history.id)),
    ).toEqual([target.history]);
  });

  it('rechecks workspace deletion after provider I/O', async () => {
    const target = await seedTarget();
    await expect(
      requestGithubCheckRecovery(
        testDb,
        input(target, async () => {
          await testDb
            .update(schema.organization)
            .set({ deletionRequestedAt: NOW })
            .where(eq(schema.organization.id, target.organizationId));
          return target.provider;
        }),
      ),
    ).rejects.toMatchObject({ code: 'conflict', details: { reason: 'workspace_unavailable' } });
    expect(await head(target)).toMatchObject({ jobVersion: 3, attempts: 8, status: 'failed' });
  });

  it('does not reset a claim obtained while provider verification was in flight', async () => {
    const target = await seedTarget();
    expect(
      await requestGithubCheckRecovery(
        testDb,
        input(target, async () => {
          await testDb
            .update(schema.githubCheckHeadReconciliation)
            .set({
              status: 'processing',
              claimToken: 'new-worker-owned-claim',
              claimedAt: NOW,
              leaseExpiresAt: new Date(NOW.getTime() + 60_000),
              claimedJobVersion: 3,
              claimedContextGeneration: 2,
            })
            .where(eq(schema.githubCheckHeadReconciliation.id, target.selector.reconciliationId));
          return target.provider;
        }),
      ),
    ).toEqual({ status: 'busy' });
    expect(await head(target)).toMatchObject({
      jobVersion: 3,
      attempts: 8,
      claimToken: 'new-worker-owned-claim',
    });
  });

  it('does not accept an ABA pull head after its epoch changes during provider I/O', async () => {
    const target = await seedTarget();
    expect(
      await requestGithubCheckRecovery(
        testDb,
        input(target, async () => {
          await testDb
            .update(schema.githubPullRequest)
            .set({ headEpoch: 3 })
            .where(eq(schema.githubPullRequest.id, target.selector.pullRequestId));
          return target.provider;
        }),
      ),
    ).toEqual({ status: 'superseded' });
    expect(await head(target)).toMatchObject({ jobVersion: 3, attempts: 8, status: 'failed' });
  });

  it('returns finite busy rather than waiting for an unrelated parent lock to be released', async () => {
    const target = await seedTarget();
    let acquired: (() => void) | undefined;
    let release: (() => void) | undefined;
    const locked = new Promise<void>((resolve) => {
      acquired = resolve;
    });
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const holder = testDb.transaction(async (tx) => {
      await tx
        .select({ id: schema.integration.id })
        .from(schema.integration)
        .innerJoin(
          schema.githubInstallation,
          eq(schema.githubInstallation.integrationId, schema.integration.id),
        )
        .where(eq(schema.githubInstallation.installationId, target.installationId))
        .for('update');
      acquired?.();
      await released;
    });
    await locked;
    let releasedByDeadline = false;
    const timer = setTimeout(() => {
      releasedByDeadline = true;
      release?.();
    }, 3000);
    try {
      expect(
        await requestGithubCheckRecovery(
          testDb,
          input(target, async () => target.provider),
        ),
      ).toEqual({ status: 'busy' });
      expect(releasedByDeadline).toBe(false);
      expect(await head(target)).toMatchObject({ status: 'failed', attempts: 8, jobVersion: 3 });
    } finally {
      clearTimeout(timer);
      release?.();
      await holder;
    }
  });

  it.each([
    { code: '55P03', abort: false, status: 'busy' },
    { code: '57014', abort: false, status: 'busy' },
    { code: '57014', abort: true, status: 'expired' },
  ])(
    'maps only a known bounded database failure to a finite result: $code/$status',
    async ({ code, abort, status }) => {
      const target = await seedTarget();
      const controller = new AbortController();
      const cause: unknown = Reflect.construct(postgres.PostgresError, [
        { message: 'bounded query fixture', code },
      ]);
      const failure = new Error('wrapped query fixture', { cause });
      const database = new Proxy(testDb, {
        get(target, property, receiver) {
          if (property === 'transaction')
            return () => {
              if (abort) controller.abort();
              return Promise.reject(failure);
            };
          return Reflect.get(target, property, receiver);
        },
      });
      expect(
        await requestGithubCheckRecovery(database, {
          ...input(target, async () => target.provider),
          signal: controller.signal,
        }),
      ).toEqual({ status });
      expect(await head(target)).toMatchObject({ status: 'failed', attempts: 8, jobVersion: 3 });
    },
  );

  it('does not swallow an unrelated database failure that merely carries a familiar code', async () => {
    const target = await seedTarget();
    const failure = new Error('unrelated query fixture', { cause: { code: '55P03' } });
    const database = new Proxy(testDb, {
      get(target, property, receiver) {
        if (property === 'transaction')
          return () => {
            return Promise.reject(failure);
          };
        return Reflect.get(target, property, receiver);
      },
    });
    await expect(
      requestGithubCheckRecovery(
        database,
        input(target, async () => target.provider),
      ),
    ).rejects.toBe(failure);
    expect(await head(target)).toMatchObject({ status: 'failed', attempts: 8, jobVersion: 3 });
  });

  it('does not hold a database connection while verifying the provider even with pool size one', async () => {
    const target = await seedTarget();
    const url = process.env['DATABASE_URL'];
    if (url === undefined) throw new Error('Missing guarded test URL');
    const pool = postgres(url, { max: 1, prepare: false, connect_timeout: 2 });
    const database: Database = drizzle(pool, { schema });
    try {
      expect(pool.options.max).toBe(1);
      expect(
        await requestGithubCheckRecovery(
          database,
          input(target, async () => {
            let deadline: ReturnType<typeof setTimeout> | undefined;
            try {
              const [row] = await Promise.race([
                pool`select 1 as ready`,
                new Promise<never>((_resolve, reject) => {
                  deadline = setTimeout(
                    () => reject(new Error('Provider I/O retained the sole database connection')),
                    2000,
                  );
                }),
              ]);
              expect(row?.['ready']).toBe(1);
            } finally {
              clearTimeout(deadline);
            }
            return target.provider;
          }),
        ),
      ).toEqual({ status: 'queued' });
    } finally {
      await pool.end({ timeout: 2 });
    }
  });
});

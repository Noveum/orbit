import { describe, expect, it, spyOn } from 'bun:test';
import { createHmac } from 'node:crypto';
import { and, db, eq, pool, schema, sql } from '@orbit/db';
import * as github from '@orbit/services';
import {
  adoptGithubInstallationReplacement,
  applyGithubInstallationEvent,
  captureGithubReplacementSnapshot,
  replaceGithubRepositories,
  verifyGithubInstallationReplacement,
} from '@orbit/services';
import { DomainError } from '@orbit/shared/errors';
import { randomUUIDv7 } from '@orbit/shared/utils';
import { POST as githubWebhook } from '../../../src/app/api/webhooks/github/route.ts';
import { refreshPullRequestHistory } from '../../../src/features/pulls/github-refresh.ts';
import {
  backfillWorkspacePullRequests,
  syncInstallationRepositories,
} from '../../../src/features/settings/github-connect.ts';
import * as publisher from '../../../src/lib/api/publish.ts';
import {
  awaitReplacementBarrier,
  createReplacementFixture,
  observeReplacement,
  type ReplacementFixture,
  replacementBarrier,
  replacementConfig,
  replacementRepository,
  repositoryPayload,
} from './github-replacement-fixture.ts';
import { pauseReplacementRead } from './github-replacement-read-barrier.ts';

async function currentParent(fixture: ReplacementFixture) {
  const [row] = await db
    .select()
    .from(schema.githubInstallation)
    .where(eq(schema.githubInstallation.id, fixture.original.id));
  if (row === undefined) throw new Error('The owned installation disappeared');
  return row;
}

async function currentWatch(fixture: ReplacementFixture) {
  const [row] = await db
    .select()
    .from(schema.githubRepositorySync)
    .where(eq(schema.githubRepositorySync.id, fixture.watch.id));
  return row;
}

async function currentPull(fixture: ReplacementFixture) {
  const [row] = await db
    .select()
    .from(schema.githubPullRequest)
    .where(eq(schema.githubPullRequest.id, fixture.pullId));
  return row;
}

function oldCatalogue(
  fixture: ReplacementFixture,
  url: URL,
  init: RequestInit | undefined,
): boolean {
  return (
    url.pathname === '/installation/repositories' &&
    new Headers(init?.headers).get('authorization') ===
      `Bearer local-boundary-installation-${fixture.oldId}`
  );
}

function stalePullPayload(title = 'Retired installation result') {
  return {
    id: 70,
    number: 7,
    title,
    body: '',
    html_url: 'https://github.com/fixture-account/original/pull/7',
    state: 'open',
    head: { ref: 'old-head', sha: 'b'.repeat(40) },
    base: { ref: 'main' },
    user: { login: 'fixture-author', id: 42 },
    created_at: '2026-11-01T00:00:00Z',
    updated_at: '2026-11-17T00:00:00Z',
  };
}

function historyResponse(url: URL): Response | undefined {
  if (url.pathname.endsWith('/issues/7/comments'))
    return Response.json([
      {
        id: 991,
        body: 'History from the retired installation',
        html_url: 'https://github.com/fixture-account/original/pull/7#issuecomment-991',
        user: { id: 42, login: 'fixture-author' },
        created_at: '2026-11-01T00:00:00Z',
      },
    ]);
  if (url.pathname.endsWith('/check-runs'))
    return Response.json({ total_count: 0, check_runs: [] });
  if (/\/(reviews|comments|statuses)$/.test(url.pathname)) return Response.json([]);
  return undefined;
}

describe('replacement boundary query harness', () => {
  it('pauses exactly one completed real read while retaining the original row identity', async () => {
    const fixture = await createReplacementFixture();
    const barrier = pauseReplacementRead(
      db,
      (query) =>
        query.sql.includes('from "github_installation"') &&
        query.params.includes(fixture.original.id),
    );
    const work = observeReplacement(
      db
        .select()
        .from(schema.githubInstallation)
        .where(eq(schema.githubInstallation.id, fixture.original.id))
        .limit(1)
        .then((rows) => rows),
    );
    try {
      await awaitReplacementBarrier(barrier.arrived, work);
      const adopted = await fixture.adopt();
      expect(adopted.id).toBe(fixture.original.id);
      expect((await currentParent(fixture)).installationId).toBe(fixture.newId);
      barrier.release();
      const result = await work;
      expect(result.ok).toBe(true);
      if (!result.ok) throw result.error;
      expect(result.value[0]?.id).toBe(fixture.original.id);
      expect(result.value[0]?.installationId).toBe(fixture.oldId);
      expect(barrier.hits).toBe(1);
    } finally {
      barrier.restore();
      await work;
    }
  });
});

describe('replacement boundary stale callback and catalogue', () => {
  it('does not recreate an old binding when a previously verified callback resumes after adoption', async () => {
    const fixture = await createReplacementFixture();
    const barrier = replacementBarrier();
    const original = github.bindGithubInstallation;
    let captured = false;
    const spy = spyOn(github, 'bindGithubInstallation').mockImplementation(async (...args) => {
      if (!captured && args[1].account.installationId === fixture.oldId) {
        captured = true;
        await barrier.hold();
      }
      return await original(...args);
    });
    const work = observeReplacement(fixture.connect(fixture.oldId));
    try {
      await awaitReplacementBarrier(barrier.arrived, work);
      await fixture.adopt();
      barrier.release();
      const result = await work;
      expect(result.ok).toBe(false);
      const rows = await db
        .select()
        .from(schema.githubInstallation)
        .where(eq(schema.githubInstallation.organizationId, fixture.workspace.organizationId));
      expect(rows.map((row) => row.installationId)).toEqual([fixture.newId]);
      expect(fixture.counts.oauth).toBe(3);
    } finally {
      barrier.release();
      await work;
      spy.mockRestore();
    }
  });

  for (const mode of ['empty', 'old-facts'] as const) {
    it(`does not apply a captured old ${mode} catalogue after adoption`, async () => {
      const fixture = await createReplacementFixture();
      const barrier = replacementBarrier();
      let blocked = false;
      fixture.state.intercept = async (url, init) => {
        if (!blocked && oldCatalogue(fixture, url, init)) {
          blocked = true;
          await barrier.hold();
          const repositories =
            mode === 'empty'
              ? []
              : [repositoryPayload(replacementRepository('11', 'retired-name'))];
          return Response.json({ total_count: repositories.length, repositories });
        }
        return undefined;
      };
      const work = observeReplacement(
        syncInstallationRepositories({
          installation: fixture.original,
          config: replacementConfig,
          fetch: fixture.fetch,
        }),
      );
      try {
        await awaitReplacementBarrier(barrier.arrived, work);
        await fixture.adopt();
        const beforeParent = await currentParent(fixture);
        const beforeWatch = await currentWatch(fixture);
        const beforePull = await currentPull(fixture);
        barrier.release();
        await work;
        expect(await currentParent(fixture)).toEqual(beforeParent);
        expect(await currentWatch(fixture)).toEqual(beforeWatch);
        expect(await currentPull(fixture)).toEqual(beforePull);
        const [catalogue] = await db
          .select()
          .from(schema.githubRepository)
          .where(eq(schema.githubRepository.id, fixture.catalogue.id));
        expect(catalogue?.fullName).toBe('fixture-account/renamed');
      } finally {
        barrier.release();
        await work;
      }
    });
  }

  it('does not propagate an adopted stale catalogue into a different current binding with the same stable repository ID', async () => {
    const fixture = await createReplacementFixture();
    const foreign = await fixture.foreignParent();
    const [foreignCatalogue] = await db.transaction((tx) =>
      replaceGithubRepositories(tx, {
        installation: foreign,
        repositories: [replacementRepository('11', 'foreign-current')],
      }),
    );
    if (foreignCatalogue === undefined) throw new Error('Foreign fixture catalogue missing');
    await db
      .update(schema.githubRepositoryLink)
      .set({ repositoryRowId: foreignCatalogue.id })
      .where(eq(schema.githubRepositoryLink.id, fixture.link.id));
    await db
      .update(schema.githubRepositorySync)
      .set({
        integrationId: foreign.integrationId,
        installationId: foreign.installationId,
        repositoryName: 'fixture-account/foreign-current',
        defaultBranch: 'foreign-branch',
      })
      .where(eq(schema.githubRepositorySync.id, fixture.watch.id));
    await db
      .update(schema.githubPullRequest)
      .set({ repositoryName: 'fixture-account/foreign-current' })
      .where(eq(schema.githubPullRequest.id, fixture.pullId));
    const beforeWatch = await currentWatch(fixture);
    const beforePull = await currentPull(fixture);
    await fixture.adopt();
    expect(await currentWatch(fixture)).toEqual(beforeWatch);
    expect(await currentPull(fixture)).toEqual(beforePull);
  });
});

describe('replacement boundary lifecycle', () => {
  for (const eventName of ['installation', 'installation_repositories'] as const) {
    it(`ignores a captured old ${eventName} row after its physical parent is adopted`, async () => {
      const fixture = await createReplacementFixture();
      const barrier = pauseReplacementRead(
        db,
        (query) =>
          query.sql.includes('from "github_installation"') && query.params.includes(fixture.oldId),
      );
      const body =
        eventName === 'installation'
          ? {
              action: 'new_permissions_accepted',
              installation: {
                id: Number(fixture.oldId),
                account: { id: 42, login: 'retired-account', type: 'Organization' },
                repository_selection: 'all',
                suspended_at: '2026-11-01T00:00:00Z',
              },
              repositories: [repositoryPayload(replacementRepository('11', 'retired-name'))],
            }
          : {
              action: 'added',
              installation: { id: Number(fixture.oldId) },
              repository_selection: 'all',
              repositories_added: [repositoryPayload(replacementRepository('11', 'retired-name'))],
            };
      const work = observeReplacement(applyGithubInstallationEvent(db, { eventName, body }));
      try {
        await awaitReplacementBarrier(barrier.arrived, work);
        await fixture.adopt();
        const beforeParent = await currentParent(fixture);
        const beforeWatch = await currentWatch(fixture);
        barrier.release();
        await work;
        expect(await currentParent(fixture)).toEqual(beforeParent);
        expect(await currentWatch(fixture)).toEqual(beforeWatch);
      } finally {
        barrier.restore();
        await work;
      }
    });
  }

  it('ignores an old uninstall after adoption and still removes a current new uninstall', async () => {
    const fixture = await createReplacementFixture();
    await fixture.adopt();
    const old = await applyGithubInstallationEvent(db, {
      eventName: 'installation',
      body: { action: 'deleted', installation: { id: Number(fixture.oldId) } },
    });
    expect(old.handled).toBe(false);
    expect((await currentParent(fixture)).installationId).toBe(fixture.newId);
    const current = await applyGithubInstallationEvent(db, {
      eventName: 'installation',
      body: { action: 'deleted', installation: { id: Number(fixture.newId) } },
    });
    expect(current.handled).toBe(true);
    expect(await currentWatch(fixture)).toBeUndefined();
  });
});

describe('replacement boundary ordinary delivery', () => {
  it('does not project a signed old event whose workspace lookup completed before adoption', async () => {
    const fixture = await createReplacementFixture();
    const barrier = pauseReplacementRead(
      db,
      (query) =>
        query.sql.includes('from "github_installation"') && query.params.includes(fixture.oldId),
    );
    const oldSecret = process.env['GITHUB_WEBHOOK_SECRET'];
    const secret = 'local-replacement-webhook-secret';
    process.env['GITHUB_WEBHOOK_SECRET'] = secret;
    const publish = spyOn(publisher, 'publish').mockImplementation(async () => undefined);
    const raw = JSON.stringify({
      action: 'synchronize',
      installation: { id: Number(fixture.oldId) },
      repository: { id: 11, full_name: 'fixture-account/original' },
      pull_request: stalePullPayload(),
      sender: { id: 42, login: 'fixture-author' },
    });
    const deliveryId = `local-replacement-${randomUUIDv7()}`;
    const work = observeReplacement(
      githubWebhook(
        new Request('http://localhost:3000/api/webhooks/github', {
          method: 'POST',
          body: raw,
          headers: {
            'x-github-event': 'pull_request',
            'x-github-delivery': deliveryId,
            'x-hub-signature-256': `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`,
          },
        }),
      ),
    );
    try {
      await awaitReplacementBarrier(barrier.arrived, work);
      await fixture.adopt();
      const before = await currentPull(fixture);
      barrier.release();
      const result = await work;
      expect(result.ok).toBe(true);
      if (!result.ok) throw result.error;
      expect(result.value.status).toBe(200);
      expect(await currentPull(fixture)).toEqual(before);
      const activities = await db
        .select()
        .from(schema.githubPullRequestActivity)
        .where(eq(schema.githubPullRequestActivity.pullRequestId, fixture.pullId));
      expect(activities).toHaveLength(0);
    } finally {
      barrier.restore();
      await work;
      publish.mockRestore();
      if (oldSecret === undefined) delete process.env['GITHUB_WEBHOOK_SECRET'];
      else process.env['GITHUB_WEBHOOK_SECRET'] = oldSecret;
      await db
        .delete(schema.webhookDelivery)
        .where(
          and(
            eq(schema.webhookDelivery.provider, 'github'),
            eq(schema.webhookDelivery.deliveryId, deliveryId),
          ),
        );
    }
  });
});

describe('replacement boundary backfill', () => {
  for (const hasPull of [false, true]) {
    it(`does not accept a captured old backfill ${hasPull ? 'projection' : 'completion stamp'} after adoption`, async () => {
      const fixture = await createReplacementFixture();
      const barrier = replacementBarrier();
      let blocked = false;
      fixture.state.intercept = async (url) => {
        if (!blocked && url.pathname.endsWith('/pulls')) {
          blocked = true;
          await barrier.hold();
          return Response.json(hasPull ? [stalePullPayload()] : []);
        }
        return undefined;
      };
      const work = observeReplacement(
        backfillWorkspacePullRequests({
          organizationId: fixture.workspace.organizationId,
          config: replacementConfig,
          fetch: fixture.fetch,
        }),
      );
      try {
        await awaitReplacementBarrier(barrier.arrived, work);
        await fixture.adopt();
        const beforeWatch = await currentWatch(fixture);
        const beforePull = await currentPull(fixture);
        barrier.release();
        await work;
        expect(await currentWatch(fixture)).toEqual(beforeWatch);
        expect(await currentPull(fixture)).toEqual(beforePull);
      } finally {
        barrier.release();
        await work;
      }
    });
  }

  it('still accepts a current replacement installation backfill', async () => {
    const fixture = await createReplacementFixture();
    await fixture.adopt();
    fixture.state.intercept = async (url) =>
      url.pathname.endsWith('/pulls')
        ? Response.json([stalePullPayload('Current installation result')])
        : undefined;
    const completed = await backfillWorkspacePullRequests({
      organizationId: fixture.workspace.organizationId,
      config: replacementConfig,
      fetch: fixture.fetch,
    });
    expect(completed).toBe(1);
    expect((await currentPull(fixture))?.title).toBe('Current installation result');
    expect((await currentWatch(fixture))?.pullRequestsBackfilledAt).toBeInstanceOf(Date);
  });
});

describe('replacement boundary history', () => {
  it('cannot acquire a history claim from an installation read completed before adoption', async () => {
    const fixture = await createReplacementFixture();
    const barrier = pauseReplacementRead(
      db,
      (query) =>
        query.sql.includes('from "github_pull_request"') &&
        query.sql.includes('join "github_installation"') &&
        query.params.includes(fixture.pullId) &&
        query.params.includes(fixture.workspace.organizationId),
    );
    let providerCalls = 0;
    fixture.state.intercept = (url) => {
      const response = historyResponse(url);
      if (response !== undefined) providerCalls += 1;
      return Promise.resolve(response);
    };
    const work = observeReplacement(
      refreshPullRequestHistory({
        principal: fixture.workspace.admin,
        pullRequestId: fixture.pullId,
        config: replacementConfig,
        fetch: fixture.fetch,
      }),
    );
    try {
      await awaitReplacementBarrier(barrier.arrived, work);
      await fixture.adopt();
      const before = await currentPull(fixture);
      barrier.release();
      await work;
      expect(providerCalls).toBe(0);
      expect(await currentPull(fixture)).toEqual(before);
    } finally {
      barrier.restore();
      await work;
    }
  });

  it('does not accept history from an expired old claim after adoption', async () => {
    const fixture = await createReplacementFixture();
    const barrier = replacementBarrier();
    let blocked = false;
    fixture.state.intercept = async (url) => {
      if (!blocked && url.pathname.endsWith('/issues/7/comments')) {
        blocked = true;
        await barrier.hold();
      }
      return historyResponse(url);
    };
    const work = observeReplacement(
      refreshPullRequestHistory({
        principal: fixture.workspace.admin,
        pullRequestId: fixture.pullId,
        config: replacementConfig,
        fetch: fixture.fetch,
      }),
    );
    try {
      await awaitReplacementBarrier(barrier.arrived, work);
      const claimed = await currentPull(fixture);
      expect(claimed?.historyRefreshClaimedAt).toBeInstanceOf(Date);
      await fixture.adopt(new Date(Date.now() + 180_000));
      expect((await currentPull(fixture))?.historyRefreshClaimedAt).toEqual(
        claimed?.historyRefreshClaimedAt,
      );
      const before = await currentPull(fixture);
      barrier.release();
      await work;
      expect(await currentPull(fixture)).toEqual(before);
      const history = await db
        .select()
        .from(schema.githubPullRequestActivity)
        .where(eq(schema.githubPullRequestActivity.pullRequestId, fixture.pullId));
      expect(history).toHaveLength(0);
    } finally {
      barrier.release();
      await work;
    }
  });

  it('does not clear an unchanged expired history claim after old provider failure and adoption', async () => {
    const fixture = await createReplacementFixture();
    const barrier = replacementBarrier();
    const failure = new Error('Local retired-installation history failure');
    let blocked = false;
    fixture.state.intercept = async (url) => {
      if (!blocked && url.pathname.endsWith('/issues/7/comments')) {
        blocked = true;
        await barrier.hold();
        throw failure;
      }
      return historyResponse(url);
    };
    const work = observeReplacement(
      refreshPullRequestHistory({
        principal: fixture.workspace.admin,
        pullRequestId: fixture.pullId,
        config: replacementConfig,
        fetch: fixture.fetch,
      }),
    );
    try {
      await awaitReplacementBarrier(barrier.arrived, work);
      const claimed = await currentPull(fixture);
      await fixture.adopt(new Date(Date.now() + 180_000));
      const before = await currentPull(fixture);
      expect(before?.historyRefreshClaimedAt).toEqual(claimed?.historyRefreshClaimedAt);
      barrier.release();
      const result = await work;
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('Expected the original local provider failure');
      expect(result.error).toBe(failure);
      expect(await currentPull(fixture)).toEqual(before);
    } finally {
      barrier.release();
      await work;
    }
  });

  for (const mode of ['success', 'failure'] as const) {
    it(`preserves a newer claim on the current parent when old history finishes with ${mode}`, async () => {
      const fixture = await createReplacementFixture();
      const barrier = replacementBarrier();
      const failure = new Error('Local superseded history failure');
      let blocked = false;
      fixture.state.intercept = async (url) => {
        if (!blocked && url.pathname.endsWith('/issues/7/comments')) {
          blocked = true;
          await barrier.hold();
          if (mode === 'failure') throw failure;
        }
        return historyResponse(url);
      };
      const work = observeReplacement(
        refreshPullRequestHistory({
          principal: fixture.workspace.admin,
          pullRequestId: fixture.pullId,
          config: replacementConfig,
          fetch: fixture.fetch,
        }),
      );
      try {
        await awaitReplacementBarrier(barrier.arrived, work);
        const prior = await currentPull(fixture);
        if (prior?.historyRefreshClaimedAt === null || prior?.historyRefreshClaimedAt === undefined)
          throw new Error('Original history claim missing');
        const claimedAt = new Date(prior.historyRefreshClaimedAt.getTime() + 180_001);
        await db
          .update(schema.githubPullRequest)
          .set({ historyRefreshClaimedAt: claimedAt })
          .where(eq(schema.githubPullRequest.id, fixture.pullId));
        const before = await currentPull(fixture);
        barrier.release();
        const result = await work;
        if (mode === 'failure') {
          expect(result.ok).toBe(false);
          if (result.ok) throw new Error('Expected original superseded provider failure');
          expect(result.error).toBe(failure);
        } else {
          expect(result.ok).toBe(true);
          if (!result.ok) throw result.error;
          expect(result.value).toBe(0);
        }
        expect(await currentPull(fixture)).toEqual(before);
        expect(
          await db
            .select()
            .from(schema.githubPullRequestActivity)
            .where(eq(schema.githubPullRequestActivity.pullRequestId, fixture.pullId)),
        ).toHaveLength(0);
      } finally {
        barrier.release();
        await work;
      }
    });
  }

  it('clears its own failed history claim on the current parent and preserves the original error', async () => {
    const fixture = await createReplacementFixture();
    await fixture.adopt();
    const failure = new Error('Local current-installation history failure');
    fixture.state.intercept = (url) => {
      if (url.pathname.endsWith('/issues/7/comments')) throw failure;
      return Promise.resolve(historyResponse(url));
    };
    const result = await observeReplacement(
      refreshPullRequestHistory({
        principal: fixture.workspace.admin,
        pullRequestId: fixture.pullId,
        config: replacementConfig,
        fetch: fixture.fetch,
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected the original current-provider failure');
    expect(result.error).toBe(failure);
    const after = await currentPull(fixture);
    expect(after?.historyRefreshClaimedAt).toBeNull();
    expect(after?.historySyncedAt).toBeNull();
  });

  it('still accepts history read using the current replacement binding', async () => {
    const fixture = await createReplacementFixture();
    await fixture.adopt();
    fixture.state.intercept = async (url) => historyResponse(url);
    const entries = await refreshPullRequestHistory({
      principal: fixture.workspace.admin,
      pullRequestId: fixture.pullId,
      config: replacementConfig,
      fetch: fixture.fetch,
    });
    expect(entries).toBe(1);
    expect((await currentPull(fixture))?.historySyncedAt).toBeInstanceOf(Date);
  });
});

describe('replacement boundary transaction budget', () => {
  it('rolls back a real 128-row catalogue when the whole transaction budget expires after catalogue SQL', async () => {
    const fixture = await createReplacementFixture();
    fixture.state.oldAvailable = false;
    fixture.state.newRepositories = Array.from({ length: 128 }, (_value, index) =>
      replacementRepository(String(index + 11), `repository-${index}`),
    );
    const snapshot = await captureGithubReplacementSnapshot(db, fixture.original);
    const proof = await verifyGithubInstallationReplacement({
      appId: replacementConfig.appId,
      privateKey: replacementConfig.privateKey,
      installationId: fixture.newId,
      previousInstallationId: fixture.oldId,
      expectedAccountId: '42',
      expectedAccountType: 'Organization',
      watchedRepositoryIds: snapshot.watchedRepositoryIds,
      fetch: fixture.fetch,
    });
    const originalClock = Object.getOwnPropertyDescriptor(performance, 'now');
    const originalDebug = pool.options.debug;
    let clock = 0;
    let catalogueStatements = 0;
    Object.defineProperty(performance, 'now', { configurable: true, value: () => clock });
    pool.options.debug = (_connection, query) => {
      if (query.startsWith('insert into "github_repository"')) {
        catalogueStatements += 1;
        clock += 6000;
      }
    };
    let failure: unknown;
    let succeeded = false;
    try {
      const result = await observeReplacement(
        adoptGithubInstallationReplacement(db, {
          snapshot,
          proof,
          connectedById: fixture.workspace.adminUser.id,
        }),
      );
      succeeded = result.ok;
      if (!result.ok) failure = result.error;
    } finally {
      pool.options.debug = originalDebug;
      if (originalClock === undefined) Reflect.deleteProperty(performance, 'now');
      else Object.defineProperty(performance, 'now', originalClock);
    }
    expect(catalogueStatements).toBeGreaterThan(0);
    expect(succeeded).toBe(false);
    expect(failure).toBeInstanceOf(DomainError);
    expect(failure).toMatchObject({
      code: 'conflict',
      details: { reason: 'github_replacement_budget_exhausted' },
    });
    expect((await currentParent(fixture)).installationId).toBe(fixture.oldId);
    expect(await currentWatch(fixture)).toEqual(fixture.watch);
    const catalogue = await db
      .select()
      .from(schema.githubRepository)
      .where(eq(schema.githubRepository.installationRowId, fixture.original.id));
    expect(catalogue).toEqual([fixture.catalogue]);
    await db.execute(sql`select 1`);
    expect((await currentParent(fixture)).installationId).toBe(fixture.oldId);
  });
});

import { describe, expect, it } from 'bun:test';
import { db, eq, schema } from '@orbit/db';
import type { GithubRecoveryInput } from '@orbit/services';
import { requestGithubCheckRecovery } from '@orbit/services';
import { randomUUIDv7 } from '@orbit/shared/utils';
import {
  awaitReplacementBarrier,
  createReplacementFixture,
  observeReplacement,
  type ReplacementFixture,
  replacementBarrier,
  replacementConfig,
} from './github-replacement-fixture.ts';

import { replaceDatabaseMethod } from './github-replacement-read-barrier.ts';

async function recoveryTarget(fixture: ReplacementFixture) {
  const id = randomUUIDv7();
  await db.insert(schema.githubCheckHeadReconciliation).values({
    id,
    organizationId: fixture.workspace.organizationId,
    repositorySyncId: fixture.watch.id,
    headSha: 'a'.repeat(40),
    status: 'failed',
    attempts: 8,
    jobVersion: 3,
    contextGeneration: 2,
    triggerKind: 'check_suite',
    triggerIdentity: 'original-failed-generation',
    lastError: 'GitHub installation token returned HTTP 401.',
  });
  const historyId = randomUUIDv7();
  await db.insert(schema.githubCheckReconciliationFetch).values({
    id: historyId,
    organizationId: fixture.workspace.organizationId,
    repositorySyncId: fixture.watch.id,
    headReconciliationId: id,
    headSha: 'a'.repeat(40),
    attemptNumber: 8,
    capturedJobVersion: 3,
    capturedContextGeneration: 2,
    claimToken: randomUUIDv7(),
    disposition: 'failed',
    failure: 'GitHub installation token returned HTTP 401.',
    completedAt: new Date(),
  });
  const provider = {
    appId: replacementConfig.appId,
    installationId: fixture.oldId,
    accountId: '42',
    repositoryId: fixture.watch.repositoryId,
    repositoryName: fixture.watch.repositoryName,
    externalId: '7007',
    number: 7,
    state: 'open' as const,
    merged: false,
    draft: false,
    headSha: 'a'.repeat(40),
    providerUpdatedAt: new Date().toISOString(),
  };
  const input = (verifyProvider: NonNullable<GithubRecoveryInput['verifyProvider']>) => ({
    organizationId: fixture.workspace.organizationId,
    userId: fixture.workspace.adminUser.id,
    selector: {
      reconciliationId: id,
      pullRequestId: fixture.pullId,
      expectedJobVersion: 3,
      expectedContextGeneration: 2,
      expectedHeadEpoch: 3,
      expectedHeadSha: 'a'.repeat(40),
    },
    appId: replacementConfig.appId,
    privateKey: 'injected-fixture-verifier',
    verifyProvider,
  });
  return { id, provider, input };
}

async function recoveryFacts(fixture: ReplacementFixture) {
  const organizationId = fixture.workspace.organizationId;
  const heads = await db
    .select()
    .from(schema.githubCheckHeadReconciliation)
    .where(eq(schema.githubCheckHeadReconciliation.organizationId, organizationId));
  const history = await db
    .select()
    .from(schema.githubCheckReconciliationFetch)
    .where(eq(schema.githubCheckReconciliationFetch.organizationId, organizationId));
  const notifications = await db
    .select()
    .from(schema.notification)
    .where(eq(schema.notification.organizationId, organizationId));
  const deliveries = await db
    .select()
    .from(schema.notificationDelivery)
    .where(eq(schema.notificationDelivery.organizationId, organizationId));
  return { heads, history, notifications, deliveries };
}

async function bindingFacts(fixture: ReplacementFixture) {
  const parents = await db
    .select()
    .from(schema.githubInstallation)
    .where(eq(schema.githubInstallation.id, fixture.original.id));
  const integrations = await db
    .select()
    .from(schema.integration)
    .where(eq(schema.integration.id, fixture.original.integrationId));
  const watches = await db
    .select()
    .from(schema.githubRepositorySync)
    .where(eq(schema.githubRepositorySync.id, fixture.watch.id));
  return { parents, integrations, watches };
}

function pauseRecoveryParent(integrationId: string) {
  const barrier = replacementBarrier();
  let hits = 0;
  function wrapQuery(value: unknown): unknown {
    if (value === null || typeof value !== 'object') return value;
    return new Proxy(value, {
      get(target, property) {
        const method: unknown = Reflect.get(target, property, target);
        if (typeof method !== 'function') return method;
        return new Proxy(method, {
          apply(original, _receiver, args: unknown[]) {
            if (property !== 'then') return wrapQuery(Reflect.apply(original, target, args));
            const [fulfilled, rejected] = args;
            return Reflect.apply(original, target, [
              async (rows: unknown) => {
                const toSQL: unknown = Reflect.get(target, 'toSQL', target);
                const query: unknown =
                  typeof toSQL === 'function' ? Reflect.apply(toSQL, target, []) : undefined;
                if (
                  hits === 0 &&
                  query !== null &&
                  typeof query === 'object' &&
                  'sql' in query &&
                  typeof query.sql === 'string' &&
                  query.sql.includes('from "integration" inner join "github_installation"') &&
                  query.sql.endsWith('for update') &&
                  'params' in query &&
                  Array.isArray(query.params) &&
                  query.params.includes(integrationId)
                ) {
                  hits += 1;
                  await barrier.hold();
                }
                return typeof fulfilled === 'function'
                  ? Reflect.apply(fulfilled, undefined, [rows])
                  : rows;
              },
              rejected,
            ]);
          },
        });
      },
    });
  }
  const original = db.transaction;
  const restore = replaceDatabaseMethod(
    db,
    'transaction',
    new Proxy(original, {
      apply(method, receiver, args: unknown[]) {
        const [callback, ...options] = args;
        if (typeof callback !== 'function') throw new Error('Expected transaction callback');
        return Reflect.apply(method, receiver, [
          new Proxy(callback, {
            apply(fn, callbackReceiver, transactionArgs: unknown[]) {
              const [transaction, ...rest] = transactionArgs;
              if (transaction === null || typeof transaction !== 'object')
                throw new Error('Expected actual transaction');
              const wrapped = new Proxy(transaction, {
                get(target, property) {
                  const value: unknown = Reflect.get(target, property, target);
                  if (typeof value !== 'function') return value;
                  return new Proxy(value, {
                    apply(operation, _receiver, operationArgs: unknown[]) {
                      const result: unknown = Reflect.apply(operation, target, operationArgs);
                      return property === 'select' ? wrapQuery(result) : result;
                    },
                  });
                },
              });
              return Reflect.apply(fn, callbackReceiver, [wrapped, ...rest]);
            },
          }),
          ...options,
        ]);
      },
    }),
  );
  return {
    arrived: barrier.arrived,
    release: barrier.release,
    get hits() {
      return hits;
    },
    restore() {
      barrier.release();
      restore();
    },
  };
}

describe('replacement recovery union boundary', () => {
  it('supersedes old provider verification after actual verified adoption without changing failed work', async () => {
    const fixture = await createReplacementFixture();
    const target = await recoveryTarget(fixture);
    const before = await recoveryFacts(fixture);
    const barrier = replacementBarrier();
    const work = observeReplacement(
      requestGithubCheckRecovery(
        db,
        target.input(async () => {
          await barrier.hold();
          return target.provider;
        }),
      ),
    );
    try {
      await awaitReplacementBarrier(barrier.arrived, work);
      const adopted = await fixture.adopt();
      expect(adopted.id).toBe(fixture.original.id);
      expect(adopted.installationId).toBe(fixture.newId);
      barrier.release();
      const result = await work;
      if (!result.ok) throw result.error;
      expect(result.value).toEqual({ status: 'superseded' });
      expect(await recoveryFacts(fixture)).toEqual(before);
    } finally {
      barrier.release();
      await work;
    }
  });

  it('allows one atomic recovery winner while adoption fails its current parent NOWAIT fence', async () => {
    const fixture = await createReplacementFixture();
    const target = await recoveryTarget(fixture);
    const before = await recoveryFacts(fixture);
    const originalBinding = await bindingFacts(fixture);
    const barrier = pauseRecoveryParent(fixture.original.integrationId);
    const work = observeReplacement(
      requestGithubCheckRecovery(
        db,
        target.input(async () => target.provider),
      ),
    );
    try {
      await awaitReplacementBarrier(barrier.arrived, work);
      expect(barrier.hits).toBe(1);
      await expect(fixture.adopt()).rejects.toMatchObject({
        code: 'conflict',
        details: { reason: 'github_replacement_conflict' },
      });
      expect(await bindingFacts(fixture)).toEqual(originalBinding);
      expect(await recoveryFacts(fixture)).toEqual(before);
      barrier.release();
      const result = await work;
      if (!result.ok) throw result.error;
      expect(result.value).toEqual({ status: 'queued' });
      expect(
        await requestGithubCheckRecovery(
          db,
          target.input(async () => target.provider),
        ),
      ).toEqual({ status: 'already_queued' });
      const after = await recoveryFacts(fixture);
      expect(after.heads).toHaveLength(1);
      expect(after.heads[0]).toMatchObject({
        id: target.id,
        status: 'pending',
        attempts: 0,
        jobVersion: 4,
        contextGeneration: 2,
        triggerKind: 'manual_recovery',
      });
      expect(after.history).toEqual(before.history);
      expect(after.notifications).toEqual(before.notifications);
      expect(after.deliveries).toEqual(before.deliveries);
    } finally {
      barrier.restore();
      await work;
    }
  });
});

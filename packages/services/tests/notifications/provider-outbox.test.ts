import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { db, schema } from '@orbit/db';
import { randomUUIDv7 } from '@orbit/shared/utils';
import { and, eq, sql } from 'drizzle-orm';
import { notifyMany } from '../../src/notifications/index.ts';
import { deliverNotificationProviders } from '../../src/notifications/provider-outbox.ts';
import { ensureSlackIntegrationWithVersion } from '../../src/slack/dispatch.ts';
import { type TestTransaction, withRollback } from '../../src/test-database.ts';

async function seed(tx: TestTransaction) {
  const organizationId = randomUUIDv7();
  const userId = randomUUIDv7();
  await tx
    .insert(schema.organization)
    .values({ id: organizationId, name: 'Provider tests', slug: `provider-${organizationId}` });
  await tx.insert(schema.user).values({
    id: userId,
    handle: `recipient-${userId}`,
    name: 'Recipient',
    email: `${userId}@example.com`,
    emailVerified: true,
  });
  await tx
    .insert(schema.member)
    .values({ id: randomUUIDv7(), organizationId, userId, role: 'member' });
  await tx.insert(schema.notificationSetting).values({ userId, quietHoursEnabled: false });
  return { organizationId, userId };
}

const previousEnv = {
  APP_URL: process.env['APP_URL'],
  EMAIL_FROM: process.env['EMAIL_FROM'],
  BETTER_AUTH_SECRET: process.env['BETTER_AUTH_SECRET'],
  RESEND_API_KEY: process.env['RESEND_API_KEY'],
};
beforeAll(() => {
  process.env['APP_URL'] = 'https://orbit.example.com';
  process.env['EMAIL_FROM'] = 'Orbit <updates@example.com>';
  process.env['BETTER_AUTH_SECRET'] = 'provider-test-key-not-used-outside-tests';
  process.env['RESEND_API_KEY'] = 'test-resend-key';
});
afterAll(() => {
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

async function seedProviders(tx: TestTransaction, count = 1) {
  const fixture = await seed(tx);
  const projectId = randomUUIDv7();
  const integrationId = randomUUIDv7();
  await tx.insert(schema.project).values({
    id: projectId,
    organizationId: fixture.organizationId,
    name: 'Review project',
    slug: `project-${projectId}`,
  });
  await tx.insert(schema.integration).values({
    id: integrationId,
    organizationId: fixture.organizationId,
    provider: 'slack',
    externalId: 'default',
    connectedById: fixture.userId,
    credentials: { botToken: 'test-bot-token' },
    config: {
      slackTeamId: 'T-test',
      slackAppId: 'A-test',
      credentialGeneration: 0,
      scopes: ['im:write', 'chat:write'],
    },
  });
  await tx.insert(schema.slackUserMapping).values({
    id: randomUUIDv7(),
    organizationId: fixture.organizationId,
    integrationId,
    userId: fixture.userId,
    slackUserId: 'U-test',
    slackChannelId: 'D-test',
  });
  await tx.insert(schema.slackChannelSync).values({
    id: randomUUIDv7(),
    organizationId: fixture.organizationId,
    integrationId,
    channelId: 'C-test',
    channelName: 'updates',
    events: [],
  });
  for (let index = 0; index < count; index += 1) {
    await notifyMany(
      tx,
      [
        {
          organizationId: fixture.organizationId,
          userIds: [fixture.userId],
          type: 'mention',
          reason: 'mentioned',
          entityType: 'project',
          entityId: projectId,
          title: `Update ${index + 1}`,
          body: 'Please review.',
          url: '/inbox',
          actor: { type: 'system', id: 'orbit', name: 'Orbit' },
          source: {
            sourceEventKey: `provider-event:${projectId}:${index}`,
            subjectType: 'project',
            subjectKey: `orbit-project:${projectId}:activity`,
            occurredAt: new Date(),
            payload: { subjectId: projectId },
          },
        },
      ],
      { slackEnabled: true },
    );
  }
  return { ...fixture, projectId, integrationId };
}

function fakeFetch(
  respond: (url: string, init: RequestInit | undefined) => Response | Promise<Response>,
): typeof globalThis.fetch {
  return ((input: URL | RequestInfo, init?: RequestInit) =>
    Promise.resolve(respond(String(input), init))) as unknown as typeof globalThis.fetch;
}

function worker(
  fixture: { readonly organizationId: string },
  fetch: typeof globalThis.fetch,
  channels: ('slack_dm' | 'slack' | 'email')[] = ['slack_dm'],
) {
  return { organizationId: fixture.organizationId, channels, concurrency: 1, fetch };
}

async function waitForBlockedWorker(tx: TestTransaction) {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const [result] = await tx.execute<{ blocked: boolean }>(sql`
      select exists (
        select 1 from pg_locks
        where not granted and pg_backend_pid() = any(pg_blocking_pids(pid))
      ) as blocked
    `);
    if (result?.blocked) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Provider worker did not wait on the held lock.');
}

describe('durable notification provider delivery', () => {
  for (const scenario of ['superseded', 'recovered', 'closed', 'current'] as const) {
    for (const channel of ['slack', 'slack_dm', 'email'] as const) {
      it(`checks CI failure freshness before sending a ${scenario} pull request notification via ${channel}`, async () => {
        await withRollback(async (tx) => {
          const fixture = await seedProviders(tx, 0);
          const repositoryId = randomUUIDv7();
          const pullId = randomUUIDv7();
          await tx.insert(schema.githubRepositorySync).values({
            id: repositoryId,
            organizationId: fixture.organizationId,
            integrationId: fixture.integrationId,
            repositoryId: '123',
            repositoryName: 'example/repository',
          });
          await tx.insert(schema.githubPullRequest).values({
            id: pullId,
            organizationId: fixture.organizationId,
            repositorySyncId: repositoryId,
            repositoryId: '123',
            repositoryName: 'example/repository',
            number: 42,
            url: 'https://github.com/example/repository/pull/42',
            headSha: scenario === 'superseded' ? 'new-head' : 'old-head',
            checkStatus: scenario === 'recovered' ? 'success' : 'failure',
            state: scenario === 'closed' ? 'closed' : 'open',
          });
          await notifyMany(
            tx,
            [
              {
                organizationId: fixture.organizationId,
                userIds: [fixture.userId],
                type: 'pr_checks_failed',
                reason: 'subscribed',
                entityType: 'github_pull_request',
                entityId: pullId,
                title: 'Checks failed on example',
                body: 'example/repository#42',
                url: `/pulls/${pullId}`,
                actor: { type: 'integration', id: 'github', name: 'GitHub' },
                source: {
                  sourceEventKey: 'github-pr:123:42:old-head:checks-failed',
                  subjectType: 'github_pull_request',
                  subjectKey: 'github-pr:123:42',
                  occurredAt: new Date(),
                  payload: { pullRequestId: pullId, headSha: 'old-head' },
                },
              },
            ],
            { slackEnabled: true },
          );
          let calls = 0;
          const fetch = fakeFetch((url) => {
            calls += 1;
            if (url.includes('resend.com')) return Response.json({ id: 'mail-test' });
            return Response.json({ ok: true, channel: 'C-test', ts: '1.000' });
          });
          await deliverNotificationProviders(tx, worker(fixture, fetch, [channel]));
          expect(calls).toBe(scenario === 'current' ? 1 : 0);
          const [delivery] = await tx
            .select()
            .from(schema.notificationDelivery)
            .where(
              and(
                eq(schema.notificationDelivery.organizationId, fixture.organizationId),
                eq(schema.notificationDelivery.channel, channel),
              ),
            );
          expect(delivery?.status).toBe(scenario === 'current' ? 'delivered' : 'unavailable');
          if (scenario !== 'current') {
            expect(delivery?.lastError).toBe('github_check_failure_superseded');
            expect(delivery?.sendStartedAt).toBeNull();
          }
        });
      });
    }
  }

  for (const phase of ['preflight', 'finalization'] as const) {
    it(`rejects a lease that expires while ${phase} waits for a database lock`, async () => {
      const fixture = await db.transaction((tx) => seedProviders(tx));
      let deliveryTask: Promise<number> | undefined;
      let now = new Date();
      let calls = 0;
      const fetch = fakeFetch(() => {
        calls += 1;
        return Response.json({ ok: true, channel: 'D-test', ts: '1.000' });
      });
      try {
        await db.transaction(async (tx) => {
          if (phase === 'preflight')
            await tx
              .select()
              .from(schema.user)
              .where(eq(schema.user.id, fixture.userId))
              .for('update');
          else
            await tx
              .select()
              .from(schema.notification)
              .where(eq(schema.notification.userId, fixture.userId))
              .for('update');
          deliveryTask = deliverNotificationProviders(db, {
            ...worker(fixture, fetch),
            now: () => now,
          });
          await waitForBlockedWorker(tx);
          now = new Date(now.getTime() + 6 * 60_000);
        });
        expect(await deliveryTask).toBe(0);
        expect(calls).toBe(phase === 'preflight' ? 0 : 1);
        const [delivery] = await db
          .select()
          .from(schema.notificationDelivery)
          .where(
            and(
              eq(schema.notificationDelivery.organizationId, fixture.organizationId),
              eq(schema.notificationDelivery.channel, 'slack_dm'),
            ),
          );
        expect(delivery?.status).toBe('processing');
        expect(delivery?.deliveredAt).toBeNull();
        expect(delivery?.sendStartedAt === null).toBe(phase === 'preflight');
      } finally {
        await deliveryTask;
        await db
          .delete(schema.organization)
          .where(eq(schema.organization.id, fixture.organizationId));
        await db.delete(schema.user).where(eq(schema.user.id, fixture.userId));
      }
    });
  }

  it('does not starve a healthy destination behind more blocked replies than the scan window', async () => {
    await withRollback(async (tx) => {
      const fixture = await seedProviders(tx, 6);
      const [head] = await tx
        .select()
        .from(schema.notificationDelivery)
        .where(
          and(
            eq(schema.notificationDelivery.organizationId, fixture.organizationId),
            eq(schema.notificationDelivery.channel, 'slack_dm'),
          ),
        )
        .orderBy(schema.notificationDelivery.id)
        .limit(1);
      await tx
        .update(schema.notificationDelivery)
        .set({ status: 'ambiguous' })
        .where(eq(schema.notificationDelivery.id, head?.id ?? ''));
      await tx
        .update(schema.integration)
        .set({
          config: {
            slackTeamId: 'T-blocked',
            slackAppId: 'A-test',
            credentialGeneration: 0,
            scopes: ['im:write', 'chat:write'],
          },
        })
        .where(eq(schema.integration.id, fixture.integrationId));
      const healthy = await seedProviders(tx);
      for (const [index, organizationId] of [
        fixture.organizationId,
        healthy.organizationId,
      ].entries())
        await tx
          .update(schema.notificationDelivery)
          .set({ availableAt: new Date(index) })
          .where(eq(schema.notificationDelivery.organizationId, organizationId));
      let calls = 0;
      const fetch = fakeFetch(() => {
        calls += 1;
        return Response.json({ ok: true, channel: 'D-test', ts: '1.000' });
      });
      expect(
        await deliverNotificationProviders(tx, {
          channels: ['slack_dm'],
          limit: 1,
          concurrency: 1,
          fetch,
        }),
      ).toBe(1);
      const [sent] = await tx
        .select()
        .from(schema.notificationDelivery)
        .where(
          and(
            eq(schema.notificationDelivery.organizationId, healthy.organizationId),
            eq(schema.notificationDelivery.channel, 'slack_dm'),
          ),
        );
      expect(sent?.status).toBe('delivered');
      expect(calls).toBe(1);
    });
  });
  it('serializes concurrent workers before creating a Slack root', async () => {
    const fixture = await db.transaction((tx) => seedProviders(tx, 3));
    try {
      const bodies: Record<string, unknown>[] = [];
      const fetch = fakeFetch(async (_url, init) => {
        bodies.push(JSON.parse(String(init?.body)));
        await new Promise((resolve) => setTimeout(resolve, 20));
        return Response.json({ ok: true, channel: 'D-test', ts: `${bodies.length}.000` });
      });
      const results = await Promise.all([
        deliverNotificationProviders(db, worker(fixture, fetch)),
        deliverNotificationProviders(db, worker(fixture, fetch)),
      ]);
      expect(results.reduce((sum, value) => sum + value, 0)).toBe(3);
      expect(bodies.filter((body) => body['thread_ts'] === undefined)).toHaveLength(1);
      expect(bodies.map((body) => body['thread_ts'])).toEqual([undefined, '1.000', '1.000']);
    } finally {
      await db
        .delete(schema.organization)
        .where(eq(schema.organization.id, fixture.organizationId));
      await db.delete(schema.user).where(eq(schema.user.id, fixture.userId));
    }
  });
  for (const channel of ['slack_dm', 'slack'] as const) {
    it(`keeps ordered ${channel} updates under exactly one non-broadcast root`, async () => {
      await withRollback(async (tx) => {
        const fixture = await seedProviders(tx, 3);
        const bodies: Record<string, unknown>[] = [];
        const fetch = fakeFetch((_url, init) => {
          bodies.push(JSON.parse(String(init?.body)));
          return Response.json({
            ok: true,
            channel: channel === 'slack' ? 'C-test' : 'D-test',
            ts: `${bodies.length}.000`,
          });
        });
        expect(await deliverNotificationProviders(tx, worker(fixture, fetch, [channel]))).toBe(3);
        expect(bodies.map((body) => body['thread_ts'])).toEqual([undefined, '1.000', '1.000']);
        expect(bodies.map((body) => body['reply_broadcast'])).toEqual([false, false, false]);
        expect(bodies.map((body) => body['client_msg_id'])).toEqual([
          undefined,
          undefined,
          undefined,
        ]);
        expect(String(bodies[0]?.['text'])).toContain('Update 1');
        expect(String(bodies[2]?.['text'])).toContain('Update 3');
        expect(await deliverNotificationProviders(tx, worker(fixture, fetch, [channel]))).toBe(0);
        expect(bodies).toHaveLength(3);
      });
    });
  }

  it('does not retry an uncertain Slack root or send later replies past it', async () => {
    await withRollback(async (tx) => {
      const fixture = await seedProviders(tx, 2);
      let calls = 0;
      const fetch = fakeFetch(() => {
        calls += 1;
        throw new Error('Connection lost after acceptance');
      });
      expect(await deliverNotificationProviders(tx, worker(fixture, fetch))).toBe(0);
      expect(await deliverNotificationProviders(tx, worker(fixture, fetch))).toBe(0);
      const rows = await tx
        .select()
        .from(schema.notificationDelivery)
        .where(
          and(
            eq(schema.notificationDelivery.organizationId, fixture.organizationId),
            eq(schema.notificationDelivery.channel, 'slack_dm'),
          ),
        )
        .orderBy(schema.notificationDelivery.id);
      expect(rows.map((row) => row.status)).toEqual(['ambiguous', 'pending']);
      expect(calls).toBe(1);
    });
  });

  it('fences a stale sender and converts expired uncertain delivery into an ambiguity barrier', async () => {
    await withRollback(async (tx) => {
      const fixture = await seedProviders(tx, 2);
      let now = new Date();
      let calls = 0;
      const fetch = fakeFetch(async () => {
        calls += 1;
        await tx
          .update(schema.notificationDelivery)
          .set({ claimToken: randomUUIDv7() })
          .where(
            and(
              eq(schema.notificationDelivery.organizationId, fixture.organizationId),
              eq(schema.notificationDelivery.channel, 'slack_dm'),
              eq(schema.notificationDelivery.status, 'processing'),
            ),
          );
        return Response.json({ ok: true, channel: 'D-test', ts: 'unfinalized' });
      });
      expect(
        await deliverNotificationProviders(tx, { ...worker(fixture, fetch), now: () => now }),
      ).toBe(0);
      now = new Date(now.getTime() + 6 * 60_000);
      expect(
        await deliverNotificationProviders(tx, { ...worker(fixture, fetch), now: () => now }),
      ).toBe(0);
      expect(calls).toBe(1);
      const deliveries = await tx
        .select()
        .from(schema.notificationDelivery)
        .where(
          and(
            eq(schema.notificationDelivery.organizationId, fixture.organizationId),
            eq(schema.notificationDelivery.channel, 'slack_dm'),
          ),
        )
        .orderBy(schema.notificationDelivery.id);
      expect(deliveries.map((row) => row.status)).toEqual(['ambiguous', 'pending']);
    });
  });

  for (const condition of ['mapping', 'namespace', 'preference'] as const) {
    it(`does not send after the current Slack ${condition} changes`, async () => {
      await withRollback(async (tx) => {
        const fixture = await seedProviders(tx);
        if (condition === 'mapping')
          await tx
            .update(schema.slackUserMapping)
            .set({ slackUserId: 'U-other' })
            .where(eq(schema.slackUserMapping.userId, fixture.userId));
        else if (condition === 'namespace')
          await tx
            .update(schema.integration)
            .set({
              config: {
                slackTeamId: 'T-other',
                slackAppId: 'A-test',
                credentialGeneration: 0,
                scopes: ['im:write', 'chat:write'],
              },
            })
            .where(eq(schema.integration.id, fixture.integrationId));
        else
          await tx.insert(schema.notificationPreference).values({
            id: randomUUIDv7(),
            userId: fixture.userId,
            type: 'mention',
            channel: 'slack_dm',
            enabled: false,
          });
        let calls = 0;
        const fetch = fakeFetch(() => {
          calls += 1;
          return Response.json({ ok: true, channel: 'D-test', ts: '1' });
        });
        expect(await deliverNotificationProviders(tx, worker(fixture, fetch))).toBe(0);
        expect(calls).toBe(0);
      });
    });
  }

  it('retains a ready thread across same-namespace credential rotation', async () => {
    await withRollback(async (tx) => {
      const fixture = await seedProviders(tx, 2);
      await tx
        .update(schema.member)
        .set({ role: 'admin' })
        .where(eq(schema.member.userId, fixture.userId));
      const bodies: Record<string, unknown>[] = [];
      const fetch = fakeFetch((_url, init) => {
        bodies.push(JSON.parse(String(init?.body)));
        return Response.json({ ok: true, channel: 'D-test', ts: `${bodies.length}.000` });
      });
      expect(await deliverNotificationProviders(tx, { ...worker(fixture, fetch), limit: 1 })).toBe(
        1,
      );
      await ensureSlackIntegrationWithVersion(tx, {
        organizationId: fixture.organizationId,
        connectedById: fixture.userId,
        botToken: 'new-test-token',
        externalId: 'T-test',
        slackAppId: 'A-test',
        scopes: ['im:write', 'chat:write'],
      });
      expect(await deliverNotificationProviders(tx, worker(fixture, fetch))).toBe(1);
      expect(bodies.map((body) => body['thread_ts'])).toEqual([undefined, '1.000']);
      const [thread] = await tx
        .select()
        .from(schema.slackNotificationThread)
        .where(eq(schema.slackNotificationThread.integrationId, fixture.integrationId));
      expect(thread?.credentialGeneration).toBe(1);
    });
  });

  it('does not reconnect a namespace while a provider send is still active', async () => {
    await withRollback(async (tx) => {
      const fixture = await seedProviders(tx);
      await tx
        .update(schema.member)
        .set({ role: 'admin' })
        .where(eq(schema.member.userId, fixture.userId));
      const fetch = fakeFetch(async () => {
        let rejected = false;
        try {
          await ensureSlackIntegrationWithVersion(tx, {
            organizationId: fixture.organizationId,
            connectedById: fixture.userId,
            botToken: 'new-token',
            externalId: 'T-other',
            slackAppId: 'A-test',
            scopes: ['im:write', 'chat:write'],
          });
        } catch {
          rejected = true;
        }
        expect(rejected).toBe(true);
        return Response.json({ ok: true, channel: 'D-test', ts: '1.000' });
      });
      expect(await deliverNotificationProviders(tx, worker(fixture, fetch))).toBe(1);
      const [connection] = await tx
        .select()
        .from(schema.integration)
        .where(eq(schema.integration.id, fixture.integrationId));
      expect(connection?.config['slackTeamId']).toBe('T-test');
    });
  });

  it('stops uncertain email replay before Resend idempotency expires', async () => {
    await withRollback(async (tx) => {
      const fixture = await seedProviders(tx);
      let now = new Date();
      let calls = 0;
      const fetch = fakeFetch(() => {
        calls += 1;
        throw new Error('Unknown acceptance');
      });
      await deliverNotificationProviders(tx, {
        ...worker(fixture, fetch, ['email']),
        now: () => now,
      });
      now = new Date(now.getTime() + 24 * 60 * 60_000);
      await deliverNotificationProviders(tx, {
        ...worker(fixture, fetch, ['email']),
        now: () => now,
      });
      expect(calls).toBe(1);
      const [delivery] = await tx
        .select()
        .from(schema.notificationDelivery)
        .where(
          and(
            eq(schema.notificationDelivery.organizationId, fixture.organizationId),
            eq(schema.notificationDelivery.channel, 'email'),
          ),
        );
      expect(delivery?.status).toBe('ambiguous');
    });
  });

  it('holds later replies behind a rate-limited delivery and retries with the same root', async () => {
    await withRollback(async (tx) => {
      const fixture = await seedProviders(tx, 2);
      let calls = 0;
      let now = new Date();
      const fetch = fakeFetch(() => {
        calls += 1;
        return calls === 1
          ? Response.json(
              { ok: false, error: 'ratelimited' },
              { status: 429, headers: { 'retry-after': '60' } },
            )
          : Response.json({ ok: true, channel: 'D-test', ts: `${calls}.000` });
      });
      expect(
        await deliverNotificationProviders(tx, { ...worker(fixture, fetch), now: () => now }),
      ).toBe(0);
      expect(calls).toBe(1);
      now = new Date(now.getTime() + 61_000);
      expect(
        await deliverNotificationProviders(tx, { ...worker(fixture, fetch), now: () => now }),
      ).toBe(2);
      expect(calls).toBe(3);
    });
  });

  it('rechecks current membership, preferences and provider namespace before contacting Slack', async () => {
    await withRollback(async (tx) => {
      const fixture = await seedProviders(tx);
      await tx.delete(schema.member).where(eq(schema.member.userId, fixture.userId));
      let calls = 0;
      const fetch = fakeFetch(() => {
        calls += 1;
        return Response.json({ ok: true, channel: 'D-test', ts: '1' });
      });
      expect(await deliverNotificationProviders(tx, worker(fixture, fetch))).toBe(0);
      expect(calls).toBe(0);
      const [row] = await tx
        .select()
        .from(schema.notificationDelivery)
        .where(
          and(
            eq(schema.notificationDelivery.organizationId, fixture.organizationId),
            eq(schema.notificationDelivery.channel, 'slack_dm'),
          ),
        );
      expect(row?.status).toBe('unavailable');
      expect(row?.lastError).toBe('subject_access_lost');
    });
  });

  it('does not leak a team-scoped project into a workspace Slack channel', async () => {
    await withRollback(async (tx) => {
      const fixture = await seedProviders(tx);
      const teamId = randomUUIDv7();
      await tx.insert(schema.team).values({
        id: teamId,
        organizationId: fixture.organizationId,
        name: 'Private team',
        key: 'PRIVATE',
      });
      await tx
        .insert(schema.projectTeam)
        .values({ id: randomUUIDv7(), projectId: fixture.projectId, teamId });
      let calls = 0;
      const fetch = fakeFetch(() => {
        calls += 1;
        return Response.json({ ok: true, channel: 'C-test', ts: '1' });
      });
      expect(await deliverNotificationProviders(tx, worker(fixture, fetch, ['slack']))).toBe(0);
      expect(calls).toBe(0);
    });
  });

  it('retries Resend with the same encrypted immutable payload and idempotency key', async () => {
    await withRollback(async (tx) => {
      const fixture = await seedProviders(tx);
      let now = new Date();
      const bodies: string[] = [];
      const keys: (string | null)[] = [];
      const fetch = fakeFetch((_url, init) => {
        bodies.push(String(init?.body));
        keys.push(new Headers(init?.headers).get('Idempotency-Key'));
        if (bodies.length === 1) throw new Error('Uncertain Resend response');
        return Response.json({ id: 'resend-confirmed' });
      });
      expect(
        await deliverNotificationProviders(tx, {
          ...worker(fixture, fetch, ['email']),
          now: () => now,
        }),
      ).toBe(0);
      const [frozen] = await tx
        .select()
        .from(schema.notificationDelivery)
        .where(
          and(
            eq(schema.notificationDelivery.organizationId, fixture.organizationId),
            eq(schema.notificationDelivery.channel, 'email'),
          ),
        );
      expect(JSON.stringify(frozen?.providerPayload)).not.toContain('@example.com');
      now = new Date(now.getTime() + 31_000);
      expect(
        await deliverNotificationProviders(tx, {
          ...worker(fixture, fetch, ['email']),
          now: () => now,
        }),
      ).toBe(1);
      expect(bodies).toHaveLength(2);
      expect(bodies[0]).toBe(bodies[1]);
      expect(keys[0]).toBe(keys[1]);
      const [delivery] = await tx
        .select()
        .from(schema.notificationDelivery)
        .where(eq(schema.notificationDelivery.id, frozen?.id ?? ''));
      expect(delivery?.providerMessageId).toBe('resend-confirmed');
      expect(delivery?.status).toBe('delivered');
    });
  });

  it('does not replay uncertain email after its verified address changes', async () => {
    await withRollback(async (tx) => {
      const fixture = await seedProviders(tx);
      let now = new Date();
      let calls = 0;
      const fetch = fakeFetch(() => {
        calls += 1;
        throw new Error('Unknown acceptance');
      });
      await deliverNotificationProviders(tx, {
        ...worker(fixture, fetch, ['email']),
        now: () => now,
      });
      await tx
        .update(schema.user)
        .set({ email: `${randomUUIDv7()}@example.com` })
        .where(eq(schema.user.id, fixture.userId));
      now = new Date(now.getTime() + 31_000);
      await deliverNotificationProviders(tx, {
        ...worker(fixture, fetch, ['email']),
        now: () => now,
      });
      expect(calls).toBe(1);
      const [delivery] = await tx
        .select()
        .from(schema.notificationDelivery)
        .where(
          and(
            eq(schema.notificationDelivery.organizationId, fixture.organizationId),
            eq(schema.notificationDelivery.channel, 'email'),
          ),
        );
      expect(delivery?.status).toBe('ambiguous');
    });
  });
});

describe('durable notification provider planning', () => {
  it('queues email without reporting provider delivery before confirmation', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      const outcome = await notifyMany(
        tx,
        [
          {
            organizationId: fixture.organizationId,
            userIds: [fixture.userId],
            type: 'comment_created',
            reason: 'commented',
            entityType: 'issue',
            entityId: 'issue-provider-test',
            title: 'A comment needs your attention',
            body: 'Please review the change.',
            url: '/inbox',
            actor: { type: 'system', id: 'orbit', name: 'Orbit' },
          },
        ],
        { slackEnabled: false },
      );
      expect(outcome.notifications[0]?.deliveredChannels).toEqual(['inbox']);
      const deliveries = await tx
        .select()
        .from(schema.notificationDelivery)
        .where(eq(schema.notificationDelivery.organizationId, fixture.organizationId));
      expect(deliveries).toHaveLength(1);
      expect(deliveries[0]).toMatchObject({
        channel: 'email',
        status: 'pending',
        destinationKind: 'user',
        destinationId: fixture.userId,
        userId: fixture.userId,
      });
      expect(deliveries[0]?.sourceEventId).toBeString();
    });
  });
});

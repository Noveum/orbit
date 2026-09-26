import { beforeEach, expect, it } from 'bun:test';
import { db, eq, schema } from '@orbit/db';
import type { SyncAction } from '@orbit/shared/events';
import { newId } from '../../src/internal.ts';
import {
  drainIssueOutbox,
  issueOutboxStats,
  redactPublicPayload,
  stageIssueActions,
} from '../../src/realtime/issue-outbox.ts';
import { createWorkspace, resetDatabase } from '../../src/test-support.ts';

beforeEach(resetDatabase);

it('P0-RT-1 retries a failed publication without acknowledging and redacts nested grant IDs', async () => {
  const workspace = await createWorkspace('Outbox');
  const issueId = newId();
  const staged = await db.transaction(async (tx) =>
    stageIssueActions(tx, issueId, [
      {
        syncId: 2,
        organizationId: workspace.organizationId,
        scopes: [`team:${workspace.teamId}`],
        action: 'insert',
        model: 'issue',
        modelId: issueId,
        data: { id: issueId, grantId: 'secret', nested: [{ grant_id: 'secret' }] },
        actor: { type: 'agent', id: newId(), name: 'Researcher' },
        at: new Date().toISOString(),
      },
    ]),
  );
  const eventId = staged[0]?.eventId;
  expect(eventId).toBeString();
  const first = await drainIssueOutbox({
    publish: () => Promise.reject(new Error('Redis unavailable')),
  });
  expect(first).toBe(1);
  const [failed] = await db
    .select()
    .from(schema.issueOutbox)
    .where(eq(schema.issueOutbox.id, eventId ?? ''));
  expect(failed?.deliveredAt).toBeNull();
  expect(failed?.attempts).toBe(1);
  const delivered: SyncAction[] = [];
  const second = await drainIssueOutbox({
    now: new Date(Date.now() + 10_000),
    publish: (actions) => {
      delivered.push(...actions);
      return Promise.resolve();
    },
  });
  expect(second).toBe(1);
  expect(delivered[0]?.eventId).toBe(eventId);
  expect(JSON.stringify(delivered)).not.toContain('grantId');
  expect(JSON.stringify(delivered)).not.toContain('grant_id');
  const [acked] = await db
    .select()
    .from(schema.issueOutbox)
    .where(eq(schema.issueOutbox.id, eventId ?? ''));
  expect(acked?.deliveredAt).not.toBeNull();
  expect(
    await drainIssueOutbox({
      publish: () => Promise.reject(new Error('Unexpected duplicate')),
    }),
  ).toBe(0);
});

it('P0-RT-1 does not persist outbox rows when the aggregate transaction rolls back', async () => {
  const workspace = await createWorkspace('Rollback');
  const issueId = newId();
  await expect(
    db.transaction(async (tx) => {
      await stageIssueActions(tx, issueId, [
        {
          syncId: 1,
          organizationId: workspace.organizationId,
          scopes: [`team:${workspace.teamId}`],
          action: 'insert',
          model: 'issue',
          modelId: issueId,
          data: { id: issueId },
          actor: { type: 'user', id: workspace.admin.userId },
          at: new Date().toISOString(),
        },
      ]);
      throw new Error('rollback');
    }),
  ).rejects.toThrow('rollback');
  expect(await db.select().from(schema.issueOutbox)).toHaveLength(0);
  expect(redactPublicPayload({ nested: [{ grantId: 'secret', value: 1 }] })).toEqual({
    nested: [{ value: 1 }],
  });
});

it('P0-RT-1 keeps the attribution snapshot and strips grant keys at every depth', async () => {
  const workspace = await createWorkspace('Attribution');
  const issueId = newId();
  const agentId = newId();
  const staged = await db.transaction(async (tx) =>
    stageIssueActions(
      tx,
      issueId,
      [
        {
          syncId: 3,
          organizationId: workspace.organizationId,
          scopes: [`team:${workspace.teamId}`],
          action: 'insert',
          model: 'issue',
          modelId: issueId,
          data: {
            id: issueId,
            levels: [{ deeper: [{ deepest: { grantId: 'secret', keep: 'yes' } }] }],
          },
          actor: { type: 'agent', id: agentId, name: 'Researcher' },
          at: new Date().toISOString(),
        },
      ],
      {
        attribution: {
          actor: {
            type: 'agent',
            id: agentId,
            name: 'Researcher',
            avatar: '/api/avatars/owner.png?v=1',
            deleted: false,
          },
          principal: {
            type: 'user',
            id: workspace.admin.userId,
            name: workspace.adminUser.name,
            avatar: null,
            deleted: false,
          },
        },
        grantId: 'grant-secret',
      },
    ),
  );

  const [rawRow] = await db
    .select()
    .from(schema.issueOutbox)
    .where(eq(schema.issueOutbox.id, staged[0]?.eventId ?? ''));
  expect(JSON.stringify(rawRow?.payload)).toContain('grant-secret');

  const delivered: SyncAction[] = [];
  await drainIssueOutbox({
    publish: (actions) => {
      delivered.push(...actions);
      return Promise.resolve();
    },
  });
  expect(delivered).toHaveLength(1);
  const action = delivered[0];
  expect(action?.attribution?.actor).toMatchObject({
    type: 'agent',
    id: agentId,
    name: 'Researcher',
    avatar: '/api/avatars/owner.png?v=1',
  });
  expect(action?.attribution?.principal).toMatchObject({
    type: 'user',
    id: workspace.admin.userId,
  });
  expect(action?.data).toEqual({
    id: issueId,
    levels: [{ deeper: [{ deepest: { keep: 'yes' } }] }],
  });
  const payload = JSON.stringify(action);
  expect(payload).not.toContain('grantId');
  expect(payload).not.toContain('grant_id');
  expect(payload).not.toContain('grant-secret');
});

it('P0-RT-1 keeps an event retryable after it crosses the alert threshold', async () => {
  const workspace = await createWorkspace('Outbox-threshold');
  const issueId = newId();
  const [action] = await db.transaction(
    async (tx) =>
      await stageIssueActions(tx, issueId, [
        {
          syncId: 1,
          organizationId: workspace.organizationId,
          scopes: [`team:${workspace.teamId}`],
          action: 'insert',
          model: 'issue',
          modelId: issueId,
          data: { id: issueId },
          actor: { type: 'user', id: workspace.admin.userId },
          at: new Date().toISOString(),
        },
      ]),
  );
  if (action?.eventId === undefined) throw new Error('staging produced no event id');
  await db
    .update(schema.issueOutbox)
    .set({ attempts: 9, availableAt: new Date(Date.now() - 1_000) })
    .where(eq(schema.issueOutbox.id, action.eventId));

  await drainIssueOutbox({ publish: () => Promise.reject(new Error('still unavailable')) });
  const [retrying] = await db
    .select()
    .from(schema.issueOutbox)
    .where(eq(schema.issueOutbox.id, action.eventId));
  expect(retrying?.attempts).toBe(10);
  expect(retrying?.deliveredAt).toBeNull();
  expect((await issueOutboxStats()).overThreshold).toBe(1);

  const delivered: SyncAction[] = [];
  await drainIssueOutbox({
    now: new Date(Date.now() + 61_000),
    publish: (actions) => {
      delivered.push(...actions);
      return Promise.resolve();
    },
  });
  expect(delivered.map((entry) => entry.eventId)).toEqual([action.eventId]);
  expect((await issueOutboxStats()).backlog).toBe(0);
});

it('P1 exposes failed outbox redaction as a separate operational signal', async () => {
  const workspace = await createWorkspace('Redaction-signal');
  const issueId = newId();
  const [action] = await db.transaction(
    async (tx) =>
      await stageIssueActions(tx, issueId, [
        {
          syncId: 1,
          organizationId: workspace.organizationId,
          scopes: [`team:${workspace.teamId}`],
          action: 'insert',
          model: 'issue',
          modelId: issueId,
          data: { id: issueId },
          actor: { type: 'user', id: workspace.admin.userId },
          at: new Date().toISOString(),
        },
      ]),
  );
  if (action?.eventId === undefined) throw new Error('staging produced no event id');
  await db
    .update(schema.issueOutbox)
    .set({ payload: { ...action, action: 'invalid' } })
    .where(eq(schema.issueOutbox.id, action.eventId));

  await drainIssueOutbox({ publish: () => Promise.resolve() });

  const [failed] = await db
    .select()
    .from(schema.issueOutbox)
    .where(eq(schema.issueOutbox.id, action.eventId));
  expect(failed?.attempts).toBe(1);
  expect(failed?.lastError).toStartWith('redaction failure:');
  expect((await issueOutboxStats()).redactionFailures).toBe(1);
});

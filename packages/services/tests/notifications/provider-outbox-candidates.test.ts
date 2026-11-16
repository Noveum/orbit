import { describe, expect, it } from 'bun:test';
import { schema } from '@orbit/db';
import { randomUUIDv7 } from '@orbit/shared/utils';
import { type SQL, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { z } from 'zod';
import { deliverNotificationProviders } from '../../src/notifications/provider-outbox.ts';
import { type TestTransaction, withRollback } from '../../src/test-database.ts';

const NOW = new Date('2026-11-16T12:00:00.000Z');
const BEFORE = new Date('2026-11-16T11:00:00.000Z');
const AFTER = new Date('2026-11-16T13:00:00.000Z');

interface Statement {
  readonly query: string;
  readonly params: readonly unknown[];
}

interface Fixture {
  readonly organizationId: string;
  readonly integrationId: string;
  readonly userId: string;
  readonly prefix: string;
}

async function candidateStatement(organizationId?: string): Promise<Statement> {
  const captured: Statement[] = [];
  const client = postgres('postgres://127.0.0.1:1/orbit_test_unused', { max: 1 });
  const database = drizzle({
    client,
    schema,
    casing: 'snake_case',
    logger: {
      logQuery(query, params) {
        captured.push({ query, params });
        throw new Error('Candidate SQL captured before execution.');
      },
    },
  });
  try {
    await deliverNotificationProviders(database, {
      now: () => NOW,
      ...(organizationId === undefined ? {} : { organizationId }),
    });
  } catch (error) {
    if (captured.length === 0) throw error;
  } finally {
    await client.end();
  }
  const statement = captured[0];
  if (statement === undefined) throw new Error('The candidate query was not emitted.');
  return statement;
}

const parametersSchema = z.array(z.union([z.string(), z.number(), z.boolean(), z.null()]));

function bind(statement: Statement): SQL {
  const parameters = parametersSchema.parse(statement.params);
  return sql.join(
    statement.query.split(/(\$\d+)/u).map((part) => {
      const index = /^\$(\d+)$/u.exec(part)?.[1];
      if (index === undefined) return sql.raw(part);
      const value = parameters[Number(index) - 1];
      if (value === undefined) throw new Error('A candidate SQL parameter is missing.');
      return sql`${value}`;
    }),
    sql.raw(''),
  );
}

async function candidateIds(tx: TestTransaction, organizationId?: string): Promise<string[]> {
  const result = await tx.execute<{ id: string }>(bind(await candidateStatement(organizationId)));
  return result.map((row) => row.id);
}

async function seed(tx: TestTransaction): Promise<Fixture> {
  const prefix = randomUUIDv7();
  const organizationId = randomUUIDv7();
  const userId = randomUUIDv7();
  const integrationId = randomUUIDv7();
  await tx
    .insert(schema.organization)
    .values({ id: organizationId, name: 'Candidate fixture', slug: prefix });
  await tx.insert(schema.user).values({
    id: userId,
    name: 'Local candidate recipient',
    handle: `candidate-${prefix}`,
    email: `${prefix}@example.test`,
  });
  await tx.insert(schema.integration).values({
    id: integrationId,
    organizationId,
    connectedById: userId,
    provider: 'slack',
    externalId: 'default',
    config: { slackTeamId: `T-${prefix}` },
  });
  return { organizationId, integrationId, userId, prefix };
}

interface DeliveryOptions {
  readonly sequence?: number;
  readonly conversation?: string;
  readonly channel?: 'slack' | 'email';
  readonly status?: string;
  readonly availableAt?: Date;
  readonly leaseExpiresAt?: Date;
  readonly notificationId?: string;
}

async function notification(
  tx: TestTransaction,
  fixture: Fixture,
  name: string,
  duplicateOf?: string,
) {
  const id = `${fixture.prefix}-notification-${name}`;
  await tx.insert(schema.notification).values({
    id,
    organizationId: fixture.organizationId,
    userId: fixture.userId,
    type: 'manual',
    actorType: 'system',
    actorId: 'orbit',
    actorName: 'Orbit',
    entityType: 'project',
    entityId: fixture.prefix,
    title: 'Candidate fixture',
    url: '/inbox',
    ...(duplicateOf === undefined
      ? {}
      : { deduplicatedIntoNotificationId: duplicateOf, surfaceInInbox: false }),
  });
  return id;
}

async function delivery(
  tx: TestTransaction,
  fixture: Fixture,
  name: string,
  options: DeliveryOptions = {},
) {
  const id = `${fixture.prefix}-delivery-${name}`;
  const sourceEventId = randomUUIDv7();
  await tx.insert(schema.notificationSourceEvent).values({
    id: sourceEventId,
    organizationId: fixture.organizationId,
    sourceEventKey: id,
    subjectType: 'project',
    subjectKey: fixture.prefix,
    occurredAt: BEFORE,
    ingestionSeq: options.sequence ?? 1,
  });
  const channel = options.channel ?? 'slack';
  const notificationId =
    channel === 'email'
      ? (options.notificationId ?? (await notification(tx, fixture, name)))
      : null;
  await tx.insert(schema.notificationDelivery).values({
    id,
    organizationId: fixture.organizationId,
    sourceEventId,
    channel,
    notificationId,
    userId: channel === 'email' ? fixture.userId : null,
    destinationKind: channel === 'email' ? 'user' : 'shared_channel',
    destinationId: channel === 'email' ? fixture.userId : 'C-local',
    integrationId: fixture.integrationId,
    slackTeamId: `T-${fixture.prefix}`,
    slackAppId: 'A-local',
    conversationKey: options.conversation ?? 'same-conversation',
    providerPayload: {},
    status: options.status ?? 'pending',
    availableAt: options.availableAt ?? BEFORE,
    leaseExpiresAt: options.leaseExpiresAt ?? null,
  });
  return id;
}

const planSchema = z.object({
  'Relation Name': z.string().optional(),
  'Actual Rows': z.number(),
  'Actual Loops': z.number(),
  'Rows Removed by Filter': z.number().optional(),
  'Rows Removed by Index Recheck': z.number().optional(),
  'Rows Removed by Join Filter': z.number().optional(),
  Plans: z.array(z.unknown()).optional(),
});

function logicalRowWork(input: unknown): number {
  const node = planSchema.parse(input);
  const scanned =
    node['Relation Name'] === undefined
      ? 0
      : node['Actual Rows'] +
        (node['Rows Removed by Filter'] ?? 0) +
        (node['Rows Removed by Index Recheck'] ?? 0);
  const local = (scanned + (node['Rows Removed by Join Filter'] ?? 0)) * node['Actual Loops'];
  return local + (node.Plans ?? []).reduce<number>((sum, child) => sum + logicalRowWork(child), 0);
}

describe('provider candidate selection', () => {
  it('does not rescan the whole backlog for every independent conversation', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      const sources = Array.from({ length: 256 }, (_, index) => ({
        id: randomUUIDv7(),
        organizationId: fixture.organizationId,
        sourceEventKey: `${fixture.prefix}-event-${index}`,
        subjectType: 'project',
        subjectKey: fixture.prefix,
        occurredAt: BEFORE,
        ingestionSeq: index + 1,
      }));
      await tx.insert(schema.notificationSourceEvent).values(sources);
      await tx.insert(schema.notificationDelivery).values(
        sources.map((source, index) => ({
          id: `${fixture.prefix}-delivery-${String(index).padStart(3, '0')}`,
          organizationId: fixture.organizationId,
          sourceEventId: source.id,
          channel: 'slack',
          conversationKey: `independent-${index}`,
          destinationKind: 'shared_channel',
          destinationId: 'C-local',
          integrationId: fixture.integrationId,
          slackTeamId: `T-${fixture.prefix}`,
          slackAppId: 'A-local',
          providerPayload: {},
          status: 'pending',
          availableAt: BEFORE,
        })),
      );
      await tx.execute(sql`analyze notification_delivery, notification_source_event`);
      const statement = bind(await candidateStatement(fixture.organizationId));
      const [row] = await tx.execute<{ 'QUERY PLAN': unknown }>(
        sql`explain (analyze, buffers, timing off, format json) ${statement}`,
      );
      const [explanation] = z.array(z.object({ Plan: z.unknown() })).parse(row?.['QUERY PLAN']);
      if (explanation === undefined) throw new Error('The candidate plan is missing.');
      expect(logicalRowWork(explanation.Plan)).toBeLessThan(256 * 20);
      const selected = await tx.execute<{ id: string }>(statement);
      expect(selected).toHaveLength(256);
      expect(selected[0]?.id).toBe(`${fixture.prefix}-delivery-000`);
      expect(selected.at(-1)?.id).toBe(`${fixture.prefix}-delivery-255`);
    });
  });

  it('keeps email independent of Slack conversation barriers', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      const first = await delivery(tx, fixture, 'a', { channel: 'email', sequence: 1 });
      const second = await delivery(tx, fixture, 'b', { channel: 'email', sequence: 2 });
      expect(await candidateIds(tx, fixture.organizationId)).toEqual([first, second]);
    });
  });

  for (const status of ['pending', 'failed', 'ambiguous'] as const) {
    it(`keeps later replies behind an earlier ${status} head even when that head is not available`, async () => {
      await withRollback(async (tx) => {
        const fixture = await seed(tx);
        await delivery(tx, fixture, 'a', { sequence: 1, status, availableAt: AFTER });
        await delivery(tx, fixture, 'b', { sequence: 2 });
        expect(await candidateIds(tx, fixture.organizationId)).toEqual([]);
      });
    });
  }

  it('uses delivery identity to break equal ingestion sequence ties', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      await delivery(tx, fixture, 'a', { sequence: 1, availableAt: AFTER });
      await delivery(tx, fixture, 'b', { sequence: 1 });
      expect(await candidateIds(tx, fixture.organizationId)).toEqual([]);
    });
  });

  it('does not block a different conversation or include another requested workspace', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      const other = await seed(tx);
      await delivery(tx, fixture, 'a', { status: 'ambiguous', conversation: 'blocked' });
      const healthy = await delivery(tx, fixture, 'b', { conversation: 'healthy' });
      await delivery(tx, other, 'a', { conversation: 'healthy' });
      expect(await candidateIds(tx, fixture.organizationId)).toEqual([healthy]);
    });
  });

  for (const [name, expiresAt, selected] of [
    ['expired', BEFORE, true],
    ['exact boundary', NOW, true],
    ['active', AFTER, false],
  ] as const) {
    it(`preserves the ${name} processing lease boundary`, async () => {
      await withRollback(async (tx) => {
        const fixture = await seed(tx);
        const head = await delivery(tx, fixture, 'a', {
          sequence: 1,
          status: 'processing',
          leaseExpiresAt: expiresAt,
        });
        await delivery(tx, fixture, 'b', { sequence: 2 });
        expect(await candidateIds(tx, fixture.organizationId)).toEqual(selected ? [head] : []);
      });
    });
  }

  it('does not select deliveries of deduplicated inbox notifications', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      const winner = await notification(tx, fixture, 'winner');
      const duplicate = await notification(tx, fixture, 'duplicate', winner);
      await delivery(tx, fixture, 'a', { channel: 'email', notificationId: duplicate });
      const healthy = await delivery(tx, fixture, 'b', {
        channel: 'email',
        notificationId: winner,
      });
      expect(await candidateIds(tx, fixture.organizationId)).toEqual([healthy]);
    });
  });
});

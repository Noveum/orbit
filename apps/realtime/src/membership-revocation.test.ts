import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { and, db, eq, schema } from '@orbit/db';
import { ORGANIZATION_FORBIDDEN_CLOSE_CODE, scopes } from '@orbit/shared/events';
import type { RedisClient } from 'bun';
import { createRealtimeServer, type RealtimeServer } from './server.ts';
import {
  cleanupFixtures,
  connectClient,
  createMember,
  createOrganization,
  createPublisher,
  createTeam,
  redisUrl,
  syncAction,
} from './test-helpers.ts';

const BATCH_WINDOW_MS = 40;
const DELTA_CHANNEL = 'orbit:delta';

let server: RealtimeServer;
let publisher: RedisClient;
let organizationId = '';
let teamId = '';

beforeAll(async () => {
  organizationId = await createOrganization();
  teamId = await createTeam(organizationId);
  publisher = createPublisher();
  server = await createRealtimeServer({ redisUrl: redisUrl(), batchWindowMs: BATCH_WINDOW_MS });
});

afterAll(async () => {
  await server.close();
  publisher.close();
  await cleanupFixtures();
});

async function publishMemberDelete(userId: string, organization: string): Promise<void> {
  await publisher.publish(
    DELTA_CHANNEL,
    JSON.stringify(
      syncAction({
        organizationId: organization,
        scopes: [scopes.organization(organization), scopes.user(userId)],
        action: 'delete',
        model: 'member',
        modelId: `member_${userId}`,
        data: { id: `member_${userId}`, userId },
      }),
    ),
  );
}

describe('membership revocation', () => {
  it('closes the socket of a member who was removed', async () => {
    const removed = await createMember({ organizationId, teamIds: [teamId] });
    const client = await connectClient(server.port, removed.token, organizationId);
    await client.waitFor('ready');

    await db
      .delete(schema.member)
      .where(
        and(
          eq(schema.member.organizationId, organizationId),
          eq(schema.member.userId, removed.userId),
        ),
      );
    await publishMemberDelete(removed.userId, organizationId);

    expect(await client.waitForClose()).toBe(ORGANIZATION_FORBIDDEN_CLOSE_CODE);
    expect(server.stats().connections).toBe(0);
  });

  it('keeps a member connected when the delta only drops a team membership', async () => {
    const staying = await createMember({ organizationId, teamIds: [teamId] });
    const client = await connectClient(server.port, staying.token, organizationId);
    await client.waitFor('ready');

    await db.delete(schema.teamMember).where(eq(schema.teamMember.userId, staying.userId));
    await publishMemberDelete(staying.userId, organizationId);

    client.send({ type: 'ping' });
    expect(await client.waitFor('pong')).toBeDefined();
    client.close();
  });
});

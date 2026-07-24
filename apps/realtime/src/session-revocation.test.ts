import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { db, eq, schema } from '@orbit/db';
import { createRealtimeClient, type RealtimeStatus } from '@orbit/realtime-client';
import { REDIS_CONTROL_CHANNEL, SESSION_REVOKED_CLOSE_CODE } from '@orbit/shared/events';
import type { RedisClient } from 'bun';
import { createRealtimeServer, type RealtimeServer } from './server.ts';
import {
  cleanupFixtures,
  connectClient,
  createMember,
  createOrganization,
  createPublisher,
  createTeam,
  delay,
  redisUrl,
} from './test-helpers.ts';

let server: RealtimeServer;
let publisher: RedisClient;
let organizationId = '';
let teamId = '';

beforeAll(async () => {
  organizationId = await createOrganization();
  teamId = await createTeam(organizationId);
  publisher = createPublisher();
  server = await createRealtimeServer({ redisUrl: redisUrl() });
});

afterAll(async () => {
  await server.close();
  publisher.close();
  await cleanupFixtures();
});

async function addSessionFor(userId: string): Promise<string> {
  const token = `token_${randomUUID()}`;
  await db.insert(schema.session).values({
    id: `session_${randomUUID()}`,
    token,
    userId,
    activeOrganizationId: organizationId,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  });
  return token;
}

async function announceRevocation(userId: string): Promise<void> {
  await publisher.publish(
    REDIS_CONTROL_CHANNEL,
    JSON.stringify({ type: 'session_revoked', userId }),
  );
}

describe('session revocation', () => {
  it('closes the socket whose session row was deleted', async () => {
    const member = await createMember({ organizationId, teamIds: [teamId] });
    const client = await connectClient(server.port, member.token, organizationId);
    await client.waitFor('ready');

    await db.delete(schema.session).where(eq(schema.session.token, member.token));
    await announceRevocation(member.userId);

    expect(await client.waitForClose()).toBe(SESSION_REVOKED_CLOSE_CODE);
    expect(server.stats().connections).toBe(0);
  });

  it('keeps the other still-valid sessions of the same user connected', async () => {
    const member = await createMember({ organizationId, teamIds: [teamId] });
    const survivingToken = await addSessionFor(member.userId);

    const revoked = await connectClient(server.port, member.token, organizationId);
    const surviving = await connectClient(server.port, survivingToken, organizationId);
    await revoked.waitFor('ready');
    await surviving.waitFor('ready');

    await db.delete(schema.session).where(eq(schema.session.token, member.token));
    await announceRevocation(member.userId);

    expect(await revoked.waitForClose()).toBe(SESSION_REVOKED_CLOSE_CODE);
    surviving.send({ type: 'ping' });
    expect(await surviving.waitFor('pong')).toBeDefined();
    surviving.close();
  });

  it('stops the realtime client reconnecting and reports the terminal close', async () => {
    const member = await createMember({ organizationId, teamIds: [teamId] });
    const statuses: RealtimeStatus[] = [];
    let terminalCode: number | undefined;

    const client = createRealtimeClient({
      url: `ws://127.0.0.1:${server.port}`,
      token: member.token,
      organizationId,
      maxBackoffMs: 200,
      onStatus: (status) => statuses.push(status),
      onTerminal: (code) => {
        terminalCode = code;
      },
    });

    const deadline = Date.now() + 5_000;
    while (client.status() !== 'open') {
      if (Date.now() > deadline) throw new Error('client never opened');
      await delay(25);
    }

    await db.delete(schema.session).where(eq(schema.session.token, member.token));
    await announceRevocation(member.userId);

    const closedBy = Date.now() + 5_000;
    while (terminalCode === undefined) {
      if (Date.now() > closedBy) throw new Error('client was never told it was revoked');
      await delay(25);
    }

    expect(terminalCode).toBe(SESSION_REVOKED_CLOSE_CODE);
    expect(client.status()).toBe('closed');

    await delay(400);
    expect(statuses).not.toContain('reconnecting');
    client.close();
  });
});

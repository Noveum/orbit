import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { ORGANIZATION_FORBIDDEN_CLOSE_CODE, scopes } from '@orbit/shared/events';
import type { Redis } from 'ioredis';
import { createRealtimeServer, type RealtimeServer } from '../src/server.ts';
import {
  addMembership,
  cleanupFixtures,
  connectClient,
  createMember,
  createOrganization,
  createPublisher,
  createTeam,
  delay,
  redisUrl,
  type SeedMember,
  syncAction,
} from '../src/test-helpers.ts';

const BATCH_WINDOW_MS = 40;
const DELTA_CHANNEL = 'orbit:delta';
const SETTLE_MS = 400;

let server: RealtimeServer;
let publisher: Redis;
let orgA = '';
let orgB = '';
let outsiderOrg = '';
let teamA = '';
let teamB = '';
let dual: SeedMember;
let ambiguous: SeedMember;

beforeAll(async () => {
  orgA = await createOrganization();
  orgB = await createOrganization();
  outsiderOrg = await createOrganization();
  teamA = await createTeam(orgA);
  teamB = await createTeam(orgB);

  dual = await createMember({
    organizationId: orgA,
    teamIds: [teamA],
    activeOrganizationId: null,
  });
  await addMembership(dual.userId, orgB, { teamIds: [teamB] });

  ambiguous = await createMember({
    organizationId: orgB,
    teamIds: [teamB],
    activeOrganizationId: null,
  });
  await addMembership(ambiguous.userId, orgA, {
    teamIds: [teamA],
    createdAt: new Date(Date.now() - 60 * 60 * 1000),
  });

  publisher = createPublisher();
  server = await createRealtimeServer({ redisUrl: redisUrl(), batchWindowMs: BATCH_WINDOW_MS });
});

afterAll(async () => {
  await server.close();
  publisher.disconnect();
  await cleanupFixtures();
});

async function publish(action: ReturnType<typeof syncAction>): Promise<void> {
  await publisher.publish(DELTA_CHANNEL, JSON.stringify(action));
}

describe('ticket organization', () => {
  it('honors the organization named in the ticket and delivers only its deltas', async () => {
    const client = await connectClient(server.port, dual, orgB);
    const ready = await client.waitFor('ready');
    expect(ready.organizationId).toBe(orgB);

    client.send({ type: 'subscribe', scopes: [scopes.team(teamA), scopes.team(teamB)] });
    await client.waitFor('subscribed');

    await publish(
      syncAction({
        organizationId: orgA,
        scopes: [scopes.team(teamA)],
        modelId: 'issue_wrong_workspace',
        syncId: 41,
      }),
    );
    await publish(
      syncAction({
        organizationId: orgB,
        scopes: [scopes.team(teamB)],
        modelId: 'issue_right_workspace',
        syncId: 42,
      }),
    );

    const delta = await client.waitFor('delta');
    expect(delta.actions.map((action) => action.modelId)).toEqual(['issue_right_workspace']);

    await delay(SETTLE_MS);
    const delivered = client.messages
      .filter((message) => message.type === 'delta')
      .flatMap((message) => message.actions.map((action) => action.modelId));
    expect(delivered).not.toContain('issue_wrong_workspace');

    client.close();
  });

  it('rejects a ticket for an organization the user does not belong to', async () => {
    const client = await connectClient(server.port, dual, outsiderOrg);
    expect(await client.waitForClose()).toBe(ORGANIZATION_FORBIDDEN_CLOSE_CODE);
  });

  it('honors the second workspace of a multi-organization member', async () => {
    const client = await connectClient(server.port, ambiguous, orgA);
    const ready = await client.waitFor('ready');
    expect(ready.organizationId).toBe(orgA);
    client.close();
  });
});

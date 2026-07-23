import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { scopes } from '@orbit/shared/events';
import { connect, type RedisClient, type Socket } from 'bun';
import { createRealtimeServer, type RealtimeServer } from './server.ts';
import {
  cleanupFixtures,
  connectClient,
  createIssue,
  createMember,
  createOrganization,
  createPublisher,
  createTeam,
  delay,
  redisUrl,
  type SeedMember,
  syncAction,
} from './test-helpers.ts';

const BATCH_WINDOW_MS = 80;
const DELTA_CHANNEL = 'orbit:delta';

let server: RealtimeServer;
let publisher: RedisClient;
let orgA = '';
let orgB = '';
let teamA = '';
let teamB = '';
let alice: SeedMember;
let dave: SeedMember;
let bob: SeedMember;
let carol: SeedMember;

beforeAll(async () => {
  orgA = await createOrganization();
  orgB = await createOrganization();
  teamA = await createTeam(orgA);
  teamB = await createTeam(orgA);
  alice = await createMember({ organizationId: orgA, teamIds: [teamA] });
  dave = await createMember({ organizationId: orgA, teamIds: [teamA] });
  bob = await createMember({ organizationId: orgA, teamIds: [teamB] });
  carol = await createMember({ organizationId: orgB });
  publisher = createPublisher();
  server = await createRealtimeServer({
    redisUrl: redisUrl(),
    batchWindowMs: BATCH_WINDOW_MS,
  });
});

afterAll(async () => {
  await server.close();
  publisher.close();
  await cleanupFixtures();
});

async function publish(action: ReturnType<typeof syncAction>): Promise<void> {
  await publisher.publish(DELTA_CHANNEL, JSON.stringify(action));
}

const HANDSHAKE_TIMEOUT_MS = 5_000;
const HANDSHAKE_SETTLE_MS = 25;

async function connectSilently(port: number, token: string): Promise<Socket<undefined>> {
  let markUpgraded: (() => void) | undefined;
  let failUpgrade: ((error: Error) => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let received = '';
  const upgraded = new Promise<void>((resolve, reject) => {
    markUpgraded = resolve;
    failUpgrade = reject;
    timer = setTimeout(
      () => reject(new Error('timed out upgrading raw socket')),
      HANDSHAKE_TIMEOUT_MS,
    );
  });

  const socket = await connect({
    hostname: '127.0.0.1',
    port,
    socket: {
      data(_socket, chunk: Buffer) {
        received += chunk.toString('latin1');
        const end = received.indexOf('\r\n\r\n');
        if (end === -1) return;
        const status = received.slice(0, received.indexOf('\r\n'));
        if (status.startsWith('HTTP/1.1 101')) {
          markUpgraded?.();
          return;
        }
        failUpgrade?.(new Error(`raw socket did not upgrade: ${status}`));
      },
      close() {
        failUpgrade?.(new Error('raw socket closed before upgrading'));
      },
      error(_socket, error: Error) {
        failUpgrade?.(error);
      },
    },
  });

  socket.write(
    [
      `GET /?token=${encodeURIComponent(token)} HTTP/1.1`,
      `Host: 127.0.0.1:${port}`,
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Key: ${randomBytes(16).toString('base64')}`,
      'Sec-WebSocket-Version: 13',
      '',
      '',
    ].join('\r\n'),
  );

  try {
    await upgraded;
  } finally {
    clearTimeout(timer);
  }
  await delay(HANDSHAKE_SETTLE_MS);
  return socket;
}

describe('fan-out', () => {
  it('delivers a delta only to connections subscribed to the scope', async () => {
    const subscribed = await connectClient(server.port, alice.token);
    await subscribed.waitFor('ready');
    subscribed.send({ type: 'subscribe', scopes: [scopes.team(teamA)] });
    await subscribed.waitFor('subscribed');

    const other = await connectClient(server.port, bob.token);
    await other.waitFor('ready');
    other.send({ type: 'subscribe', scopes: [scopes.team(teamB)] });
    await other.waitFor('subscribed');

    await publish(
      syncAction({
        organizationId: orgA,
        scopes: [scopes.team(teamA)],
        modelId: 'issue_fanout',
        syncId: 10,
      }),
    );

    const delta = await subscribed.waitFor('delta');
    expect(delta.actions.map((action) => action.modelId)).toEqual(['issue_fanout']);
    await delay(BATCH_WINDOW_MS * 3);
    expect(other.messages.some((message) => message.type === 'delta')).toBe(false);

    subscribed.close();
    other.close();
  });

  it('never delivers a delta from another organization', async () => {
    const client = await connectClient(server.port, carol.token);
    await client.waitFor('ready');
    client.send({ type: 'subscribe', scopes: [scopes.organization(orgB)] });
    await client.waitFor('subscribed');

    await publish(
      syncAction({
        organizationId: orgA,
        scopes: [scopes.organization(orgB)],
        modelId: 'issue_cross_org',
        syncId: 11,
      }),
    );

    await delay(BATCH_WINDOW_MS * 3);
    expect(client.messages.some((message) => message.type === 'delta')).toBe(false);
    client.close();
  });

  it('batches rapid actions into one delta and collapses duplicates', async () => {
    const client = await connectClient(server.port, alice.token);
    await client.waitFor('ready');
    client.send({ type: 'subscribe', scopes: [scopes.team(teamA)] });
    await client.waitFor('subscribed');

    const targets = ['issue_a', 'issue_b', 'issue_c', 'issue_a', 'issue_d'];
    let syncId = 100;
    for (const modelId of targets) {
      syncId += 1;
      await publish(
        syncAction({ organizationId: orgA, scopes: [scopes.team(teamA)], modelId, syncId }),
      );
    }

    const delta = await client.waitFor('delta');
    await delay(BATCH_WINDOW_MS * 3);

    const deltas = client.messages.filter((message) => message.type === 'delta');
    expect(deltas).toHaveLength(1);
    expect(delta.actions.map((action) => action.modelId)).toEqual([
      'issue_b',
      'issue_c',
      'issue_a',
      'issue_d',
    ]);
    expect(delta.actions.map((action) => action.syncId)).toEqual([102, 103, 104, 105]);
    client.close();
  });
});

describe('multi tab and multi tenant fan-out', () => {
  it('delivers the same delta to both tabs of one user exactly once each', async () => {
    const tabOne = await connectClient(server.port, alice.token);
    const tabTwo = await connectClient(server.port, alice.token);
    await tabOne.waitFor('ready');
    await tabTwo.waitFor('ready');
    tabOne.send({ type: 'subscribe', scopes: [scopes.team(teamA)] });
    tabTwo.send({ type: 'subscribe', scopes: [scopes.team(teamA)] });
    await tabOne.waitFor('subscribed');
    await tabTwo.waitFor('subscribed');

    await publish(
      syncAction({
        organizationId: orgA,
        scopes: [scopes.team(teamA)],
        modelId: 'issue_two_tabs',
        syncId: 400,
      }),
    );

    await tabOne.waitFor('delta');
    await tabTwo.waitFor('delta');
    await delay(BATCH_WINDOW_MS * 3);

    for (const tab of [tabOne, tabTwo]) {
      const actions = tab.messages
        .filter((message) => message.type === 'delta')
        .flatMap((message) => message.actions)
        .filter((action) => action.modelId === 'issue_two_tabs');
      expect(actions).toHaveLength(1);
    }

    tabOne.close();
    tabTwo.close();
  });

  it('keeps two organizations apart even when both subscribe at the same moment', async () => {
    const inside = await connectClient(server.port, alice.token);
    const outside = await connectClient(server.port, carol.token);
    await inside.waitFor('ready');
    await outside.waitFor('ready');
    inside.send({ type: 'subscribe', scopes: [scopes.organization(orgA), scopes.team(teamA)] });
    outside.send({ type: 'subscribe', scopes: [scopes.organization(orgB), scopes.team(teamA)] });
    await inside.waitFor('subscribed');
    const outsideScopes = await outside.waitFor('subscribed');
    expect(outsideScopes.scopes).toEqual([scopes.organization(orgB)]);
    expect(outsideScopes.denied).toEqual([scopes.team(teamA)]);

    await publish(
      syncAction({
        organizationId: orgA,
        scopes: [scopes.organization(orgA), scopes.team(teamA)],
        modelId: 'issue_tenant_a',
        syncId: 410,
      }),
    );
    await publish(
      syncAction({
        organizationId: orgB,
        scopes: [scopes.organization(orgB)],
        modelId: 'issue_tenant_b',
        syncId: 411,
      }),
    );

    await inside.waitFor('delta');
    await outside.waitFor('delta');
    await delay(BATCH_WINDOW_MS * 3);

    const insideIds = inside.messages
      .filter((message) => message.type === 'delta')
      .flatMap((message) => message.actions.map((action) => action.modelId));
    const outsideIds = outside.messages
      .filter((message) => message.type === 'delta')
      .flatMap((message) => message.actions.map((action) => action.modelId));

    expect(insideIds).toContain('issue_tenant_a');
    expect(insideIds).not.toContain('issue_tenant_b');
    expect(outsideIds).toContain('issue_tenant_b');
    expect(outsideIds).not.toContain('issue_tenant_a');

    inside.close();
    outside.close();
  });

  it('skips deltas the resubscribing client already applied', async () => {
    const client = await connectClient(server.port, alice.token);
    await client.waitFor('ready');
    client.send({ type: 'subscribe', scopes: [scopes.team(teamA)], since: 500 });
    await client.waitFor('subscribed');

    await publish(
      syncAction({
        organizationId: orgA,
        scopes: [scopes.team(teamA)],
        modelId: 'issue_already_seen',
        syncId: 500,
      }),
    );
    await publish(
      syncAction({
        organizationId: orgA,
        scopes: [scopes.team(teamA)],
        modelId: 'issue_after_watermark',
        syncId: 501,
      }),
    );

    const delta = await client.waitFor('delta');
    await delay(BATCH_WINDOW_MS * 3);
    expect(delta.actions.map((action) => action.modelId)).toEqual(['issue_after_watermark']);
    client.close();
  });
});

describe('authorization', () => {
  it('rejects an expired session with 4001', async () => {
    const expired = await createMember({
      organizationId: orgA,
      teamIds: [teamA],
      expiresAt: new Date(Date.now() - 60_000),
    });
    const client = await connectClient(server.port, expired.token);
    expect(await client.waitForClose()).toBe(4001);
  });

  it('rejects an unknown token with 4001', async () => {
    const client = await connectClient(server.port, 'token_does_not_exist');
    expect(await client.waitForClose()).toBe(4001);
  });

  it('drops scopes for organizations and teams the connection does not belong to', async () => {
    const client = await connectClient(server.port, alice.token);
    await client.waitFor('ready');
    client.send({
      type: 'subscribe',
      scopes: [
        scopes.organization(orgA),
        scopes.organization(orgB),
        scopes.team(teamA),
        scopes.team(teamB),
        scopes.user(alice.userId),
        scopes.user(bob.userId),
        'nonsense',
      ],
    });
    const subscribed = await client.waitFor('subscribed');
    expect([...subscribed.scopes].sort()).toEqual(
      [scopes.organization(orgA), scopes.team(teamA), scopes.user(alice.userId)].sort(),
    );
    client.close();
  });

  it('scopes an issue subscription to the teams a member can read, matching the read path', async () => {
    const issueId = await createIssue(orgA, teamB, bob.userId);

    const otherTeam = await connectClient(server.port, alice.token);
    await otherTeam.waitFor('ready');
    otherTeam.send({ type: 'subscribe', scopes: [scopes.issue(issueId)] });
    const denied = await otherTeam.waitFor('subscribed');
    expect(denied.scopes).toEqual([]);
    expect(denied.denied).toEqual([scopes.issue(issueId)]);

    const owningTeam = await connectClient(server.port, bob.token);
    await owningTeam.waitFor('ready');
    owningTeam.send({ type: 'subscribe', scopes: [scopes.issue(issueId)] });
    const granted = await owningTeam.waitFor('subscribed');
    expect(granted.scopes).toEqual([scopes.issue(issueId)]);
    expect(granted.denied).toEqual([]);

    otherTeam.close();
    owningTeam.close();
  });

  it('refuses an issue scope that belongs to another organization', async () => {
    const issueId = await createIssue(orgA, teamA, alice.userId);

    const outsider = await connectClient(server.port, carol.token);
    await outsider.waitFor('ready');
    outsider.send({ type: 'subscribe', scopes: [scopes.issue(issueId)] });
    const refused = await outsider.waitFor('subscribed');
    expect(refused.scopes).toEqual([]);
    expect(refused.denied).toEqual([scopes.issue(issueId)]);

    outsider.close();
  });

  it('never fans out to a connection whose subscription was refused', async () => {
    const client = await connectClient(server.port, carol.token);
    await client.waitFor('ready');
    client.send({ type: 'subscribe', scopes: [scopes.team(teamA)] });
    expect((await client.waitFor('subscribed')).scopes).toEqual([]);

    await publish(
      syncAction({
        organizationId: orgA,
        scopes: [scopes.team(teamA)],
        modelId: 'issue_refused',
        syncId: 200,
      }),
    );
    await delay(BATCH_WINDOW_MS * 3);
    expect(client.messages.some((message) => message.type === 'delta')).toBe(false);
    client.close();
  });
});

describe('protocol', () => {
  it('answers a ping with a pong', async () => {
    const client = await connectClient(server.port, alice.token);
    await client.waitFor('ready');
    client.send({ type: 'ping' });
    expect(await client.waitFor('pong')).toMatchObject({ type: 'pong' });
    client.close();
  });

  it('unsubscribes and stops receiving deltas', async () => {
    const client = await connectClient(server.port, alice.token);
    await client.waitFor('ready');
    client.send({ type: 'subscribe', scopes: [scopes.team(teamA)] });
    await client.waitFor('subscribed', (message) => message.scopes.length === 1);
    client.send({ type: 'unsubscribe', scopes: [scopes.team(teamA)] });
    await client.waitFor('subscribed', (message) => message.scopes.length === 0);

    await publish(
      syncAction({
        organizationId: orgA,
        scopes: [scopes.team(teamA)],
        modelId: 'issue_after_unsubscribe',
        syncId: 300,
      }),
    );
    await delay(BATCH_WINDOW_MS * 3);
    expect(client.messages.some((message) => message.type === 'delta')).toBe(false);
    client.close();
  });

  it('reports an invalid message without closing the socket', async () => {
    const client = await connectClient(server.port, alice.token);
    await client.waitFor('ready');
    client.socket.send('not json');
    expect(await client.waitFor('error')).toMatchObject({ code: 'invalid_message' });
    client.close();
  });

  it('throttles a connection that floods the socket, once, without closing it', async () => {
    const strict = await createRealtimeServer({
      redisUrl: redisUrl(),
      messageBurst: 3,
      messagesPerSecond: 0,
    });
    try {
      const client = await connectClient(strict.port, alice.token);
      await client.waitFor('ready');
      for (let index = 0; index < 12; index += 1) client.send({ type: 'ping' });

      const throttled = await client.waitFor('error');
      expect(throttled).toMatchObject({ code: 'rate_limited' });
      await delay(150);

      expect(client.messages.filter((message) => message.type === 'pong')).toHaveLength(3);
      expect(
        client.messages.filter(
          (message) => message.type === 'error' && message.code === 'rate_limited',
        ),
      ).toHaveLength(1);
      expect(client.socket.readyState).toBe(WebSocket.OPEN);
      client.close();
    } finally {
      await strict.close();
    }
  });

  it('serves health with connection and redis status', async () => {
    const response = await fetch(`http://127.0.0.1:${server.port}/health`);
    const body = (await response.json()) as Record<string, unknown>;
    expect(response.status).toBe(200);
    expect(body['status']).toBe('ok');
    expect(body['redis']).toBe('ready');
    expect(typeof body['connections']).toBe('number');
    expect(typeof body['subscriptions']).toBe('number');
  });
});

describe('presence', () => {
  it('broadcasts to others in the scope but not to the sender', async () => {
    const sender = await connectClient(server.port, alice.token);
    await sender.waitFor('ready');
    sender.send({ type: 'subscribe', scopes: [scopes.team(teamA)] });
    await sender.waitFor('subscribed');

    const watcher = await connectClient(server.port, dave.token);
    await watcher.waitFor('ready');
    watcher.send({ type: 'subscribe', scopes: [scopes.team(teamA)] });
    await watcher.waitFor('subscribed');

    const bystander = await connectClient(server.port, bob.token);
    await bystander.waitFor('ready');
    bystander.send({ type: 'subscribe', scopes: [scopes.team(teamB)] });
    await bystander.waitFor('subscribed');

    sender.send({ type: 'presence', scope: scopes.team(teamA), kind: 'typing' });

    const received = await watcher.waitFor('presence');
    expect(received.messages[0]).toMatchObject({
      userId: alice.userId,
      kind: 'typing',
      scope: scopes.team(teamA),
      organizationId: orgA,
    });
    await delay(BATCH_WINDOW_MS * 3);
    expect(sender.messages.some((message) => message.type === 'presence')).toBe(false);
    expect(bystander.messages.some((message) => message.type === 'presence')).toBe(false);

    sender.close();
    watcher.close();
    bystander.close();
  });

  it('refuses presence on a scope the connection cannot access', async () => {
    const client = await connectClient(server.port, carol.token);
    await client.waitFor('ready');
    client.send({ type: 'presence', scope: scopes.team(teamA), kind: 'viewing' });
    expect(await client.waitFor('error')).toMatchObject({ code: 'forbidden_scope' });
    client.close();
  });

  it('replays a live viewer to a joiner and withholds one that outlived the ttl', async () => {
    const shortLived = await createRealtimeServer({ redisUrl: redisUrl(), presenceTtlMs: 120 });
    try {
      const viewer = await connectClient(shortLived.port, alice.token);
      await viewer.waitFor('ready');
      viewer.send({ type: 'presence', scope: scopes.team(teamA), kind: 'viewing' });

      const joiner = await connectClient(shortLived.port, dave.token);
      await joiner.waitFor('ready');
      joiner.send({ type: 'subscribe', scopes: [scopes.team(teamA)] });
      const replayed = await joiner.waitFor('presence');
      expect(replayed.messages.map((message) => message.userId)).toEqual([alice.userId]);

      await delay(200);
      const late = await connectClient(shortLived.port, bob.token);
      await late.waitFor('ready');
      late.send({ type: 'subscribe', scopes: [scopes.team(teamA)] });
      await late.waitFor('subscribed');
      await delay(50);
      expect(late.messages.some((message) => message.type === 'presence')).toBe(false);

      viewer.close();
      joiner.close();
      late.close();
    } finally {
      await shortLived.close();
    }
  });
});

describe('liveness', () => {
  it('terminates a connection that stops answering heartbeats', async () => {
    const strict = await createRealtimeServer({
      redisUrl: redisUrl(),
      heartbeatIntervalMs: 25,
      heartbeatTimeoutMs: 60,
    });
    try {
      const silent = await connectSilently(strict.port, alice.token);
      expect(strict.stats().connections).toBe(1);
      await delay(400);
      expect(strict.stats().connections).toBe(0);
      silent.end();
    } finally {
      await strict.close();
    }
  });
});

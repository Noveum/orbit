import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createRealtimeHub, fromNodeSocket, type RealtimeHub } from '@orbit/realtime-server';
import { scopes, UNAUTHORIZED_CLOSE_CODE } from '@orbit/shared/events';
import type { Redis } from 'ioredis';
import { type RawData, WebSocketServer } from 'ws';
import {
  cleanupFixtures,
  connectClient,
  connectWithTicket,
  createMember,
  createOrganization,
  createPublisher,
  createTeam,
  redisUrl,
  type SeedMember,
  syncAction,
  ticketSecret,
} from './test-helpers.ts';

const BATCH_WINDOW_MS = 80;
const DELTA_CHANNEL = 'orbit:delta';

let hub: RealtimeHub;
let http: HttpServer;
let sockets: WebSocketServer;
let publisher: Redis;
let port = 0;
let organizationId = '';
let teamId = '';
let alice: SeedMember;

beforeAll(async () => {
  organizationId = await createOrganization();
  teamId = await createTeam(organizationId);
  alice = await createMember({ organizationId, teamIds: [teamId] });
  publisher = createPublisher();

  hub = await createRealtimeHub({
    redisUrl: redisUrl(),
    ticketSecret: ticketSecret(),
    batchWindowMs: BATCH_WINDOW_MS,
  });

  http = createServer();
  sockets = new WebSocketServer({ server: http });
  sockets.on('connection', (socket) => {
    const session = hub.accept(fromNodeSocket(socket));
    socket.on('message', (data: RawData) => {
      session.message(data.toString());
    });
    socket.on('pong', () => {
      session.pong();
    });
    socket.on('close', () => {
      session.closed();
    });
  });

  await new Promise<void>((resolve) => {
    http.listen(0, '127.0.0.1', resolve);
  });
  port = (http.address() as AddressInfo).port;
});

afterAll(async () => {
  await hub.close();
  for (const socket of sockets.clients) socket.terminate();
  await new Promise<void>((resolve) => {
    sockets.close(() => resolve());
  });
  await new Promise<void>((resolve) => {
    http.closeAllConnections();
    http.close(() => resolve());
  });
  publisher.disconnect();
  await cleanupFixtures();
});

describe('the hub over a node websocket', () => {
  it('authenticates a ticket and reports the connection ready', async () => {
    const client = await connectClient(port, alice);
    const ready = await client.waitFor('ready');

    expect(ready.userId).toBe(alice.userId);
    expect(ready.organizationId).toBe(organizationId);
    client.close();
  });

  it('closes a connection that presents a forged ticket', async () => {
    const client = await connectWithTicket(port, 'not.a.ticket');

    expect(await client.waitForClose()).toBe(UNAUTHORIZED_CLOSE_CODE);
  });

  it('delivers a delta published on redis to a subscribed scope', async () => {
    const client = await connectClient(port, alice);
    await client.waitFor('ready');

    const scope = scopes.team(teamId);
    client.send({ type: 'subscribe', scopes: [scope] });
    await client.waitFor('subscribed', (message) => message.scopes.includes(scope));

    await publisher.publish(
      DELTA_CHANNEL,
      JSON.stringify([syncAction({ organizationId, scopes: [scope], modelId: 'issue_node' })]),
    );

    const delta = await client.waitFor('delta');
    expect(delta.actions[0]?.modelId).toBe('issue_node');
    client.close();
  });

  it('denies a scope the member cannot reach', async () => {
    const client = await connectClient(port, alice);
    await client.waitFor('ready');

    const forbidden = scopes.team('team_missing');
    client.send({ type: 'subscribe', scopes: [forbidden] });
    const subscribed = await client.waitFor('subscribed');

    expect(subscribed.denied).toContain(forbidden);
    expect(subscribed.scopes).not.toContain(forbidden);
    client.close();
  });
});

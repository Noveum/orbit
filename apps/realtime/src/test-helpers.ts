import { randomUUID } from 'node:crypto';
import { db, eq, inArray, schema } from '@orbit/db';
import type { ClientMessage, ServerMessage, SyncAction } from '@orbit/shared/events';
import { serverMessageSchema } from '@orbit/shared/events';
import Redis from 'ioredis';
import { WebSocket } from 'ws';

const createdOrganizationIds: string[] = [];
const createdUserIds: string[] = [];

const WAIT_TIMEOUT_MS = 5_000;

export function redisUrl(): string {
  return process.env['REDIS_URL'] ?? 'redis://localhost:6380';
}

export async function createOrganization(): Promise<string> {
  const id = `org_${randomUUID()}`;
  await db.insert(schema.organization).values({ id, name: 'Realtime Test', slug: id });
  createdOrganizationIds.push(id);
  return id;
}

export async function createTeam(organizationId: string): Promise<string> {
  const id = `team_${randomUUID()}`;
  await db
    .insert(schema.team)
    .values({ id, organizationId, name: 'Team', key: id.slice(5, 10).toUpperCase() });
  return id;
}

export interface SeedMemberOptions {
  organizationId: string;
  teamIds?: readonly string[];
  role?: string;
  expiresAt?: Date;
  activeOrganizationId?: string | null;
}

export interface SeedMember {
  userId: string;
  token: string;
  name: string;
}

export async function createMember(options: SeedMemberOptions): Promise<SeedMember> {
  const userId = `user_${randomUUID()}`;
  const name = `User ${userId.slice(5, 11)}`;
  await db.insert(schema.user).values({
    id: userId,
    name,
    email: `${userId}@orbit.test`,
    handle: userId,
  });
  createdUserIds.push(userId);

  await addMembership(userId, options.organizationId, {
    ...(options.role === undefined ? {} : { role: options.role }),
    ...(options.teamIds === undefined ? {} : { teamIds: options.teamIds }),
  });

  const token = `token_${randomUUID()}`;
  const expiresAt = options.expiresAt ?? new Date(Date.now() + 60 * 60 * 1000);
  await db.insert(schema.session).values({
    id: `session_${randomUUID()}`,
    token,
    userId,
    activeOrganizationId:
      options.activeOrganizationId === undefined
        ? options.organizationId
        : options.activeOrganizationId,
    expiresAt,
  });

  return { userId, token, name };
}

export interface MembershipOptions {
  role?: string;
  teamIds?: readonly string[];
  createdAt?: Date;
}

export async function addMembership(
  userId: string,
  organizationId: string,
  options: MembershipOptions = {},
): Promise<void> {
  await db.insert(schema.member).values({
    id: `member_${randomUUID()}`,
    organizationId,
    userId,
    role: options.role ?? 'member',
    ...(options.createdAt === undefined ? {} : { createdAt: options.createdAt }),
  });

  for (const teamId of options.teamIds ?? []) {
    await db
      .insert(schema.teamMember)
      .values({ id: `team_member_${randomUUID()}`, teamId, userId });
  }
}

export async function createIssue(
  organizationId: string,
  teamId: string,
  creatorId: string,
): Promise<string> {
  const stateId = `state_${randomUUID()}`;
  await db.insert(schema.workflowState).values({
    id: stateId,
    organizationId,
    teamId,
    name: 'Todo',
    category: 'unstarted',
    color: '#5A63C8',
  });
  const issueId = `issue_${randomUUID()}`;
  await db.insert(schema.issue).values({
    id: issueId,
    organizationId,
    teamId,
    number: 1,
    identifier: `RT-${issueId.slice(6, 12)}`,
    title: 'Realtime issue',
    stateId,
    creatorId,
  });
  return issueId;
}

export async function cleanupFixtures(): Promise<void> {
  if (createdOrganizationIds.length > 0) {
    await db
      .delete(schema.organization)
      .where(inArray(schema.organization.id, createdOrganizationIds));
    createdOrganizationIds.length = 0;
  }
  if (createdUserIds.length > 0) {
    await db.delete(schema.user).where(inArray(schema.user.id, createdUserIds));
    createdUserIds.length = 0;
  }
}

export async function deleteSessionFor(userId: string): Promise<void> {
  await db.delete(schema.session).where(eq(schema.session.userId, userId));
}

export function syncAction(overrides: Partial<SyncAction> & Pick<SyncAction, 'organizationId'>) {
  return {
    syncId: 1,
    scopes: ['org:none'],
    action: 'update',
    model: 'issue',
    modelId: 'issue_1',
    data: { title: 'hello' },
    actor: { type: 'user', id: 'user_1' },
    at: new Date().toISOString(),
    ...overrides,
  } satisfies SyncAction;
}

export interface TestClient {
  socket: WebSocket;
  messages: ServerMessage[];
  send(message: ClientMessage): void;
  waitFor<T extends ServerMessage['type']>(
    type: T,
    predicate?: (message: Extract<ServerMessage, { type: T }>) => boolean,
  ): Promise<Extract<ServerMessage, { type: T }>>;
  waitForClose(): Promise<number>;
  close(): void;
}

export function connectClient(
  port: number,
  token: string,
  organizationId?: string,
): Promise<TestClient> {
  const query = new URLSearchParams({ token });
  if (organizationId !== undefined) query.set('organizationId', organizationId);
  const socket = new WebSocket(`ws://127.0.0.1:${port}/?${query.toString()}`);
  const messages: ServerMessage[] = [];
  const listeners = new Set<() => void>();
  let closeCode: number | undefined;

  socket.on('message', (raw) => {
    const parsed = serverMessageSchema.safeParse(JSON.parse(raw.toString()));
    if (!parsed.success) return;
    messages.push(parsed.data);
    for (const listener of [...listeners]) listener();
  });
  socket.on('close', (code) => {
    closeCode = code;
    for (const listener of [...listeners]) listener();
  });

  const client: TestClient = {
    socket,
    messages,
    send(message) {
      socket.send(JSON.stringify(message));
    },
    waitFor(type, predicate) {
      type Wanted = Extract<ServerMessage, { type: typeof type }>;
      const find = () =>
        messages.find(
          (message): message is Wanted =>
            message.type === type && (predicate === undefined || predicate(message as Wanted)),
        );
      const existing = find();
      if (existing !== undefined) return Promise.resolve(existing);
      return new Promise<Wanted>((resolve, reject) => {
        const timer = setTimeout(() => {
          listeners.delete(listener);
          reject(new Error(`timed out waiting for ${type}`));
        }, WAIT_TIMEOUT_MS);
        const listener = () => {
          const found = find();
          if (found === undefined) return;
          clearTimeout(timer);
          listeners.delete(listener);
          resolve(found);
        };
        listeners.add(listener);
      });
    },
    waitForClose() {
      if (closeCode !== undefined) return Promise.resolve(closeCode);
      return new Promise<number>((resolve, reject) => {
        const timer = setTimeout(() => {
          listeners.delete(listener);
          reject(new Error('timed out waiting for close'));
        }, WAIT_TIMEOUT_MS);
        const listener = () => {
          if (closeCode === undefined) return;
          clearTimeout(timer);
          listeners.delete(listener);
          resolve(closeCode);
        };
        listeners.add(listener);
      });
    },
    close() {
      socket.close();
    },
  };

  return new Promise<TestClient>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out opening socket')), WAIT_TIMEOUT_MS);
    socket.once('open', () => {
      clearTimeout(timer);
      resolve(client);
    });
    socket.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

export function createPublisher(): Redis {
  return new Redis(redisUrl());
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

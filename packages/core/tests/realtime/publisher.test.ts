import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { REDIS_CONTROL_CHANNEL, scopes, syncActionSchema } from '@orbit/shared/events';

class FakeRedis {
  static readonly published: { channel: string; message: string }[] = [];

  on(): this {
    return this;
  }

  publish(channel: string, message: string): Promise<number> {
    FakeRedis.published.push({ channel, message });
    return Promise.resolve(1);
  }

  disconnect(): void {
    FakeRedis.published.splice(0);
  }
}

const previousRedisUrl = process.env['REDIS_URL'];
const redisModule = await import('ioredis');
process.env['REDIS_URL'] = 'redis://fake:6379';
mock.module('ioredis', () => ({ Redis: FakeRedis }));

const { buildSyncAction, closeRealtime, publishDeltas, publishOrganizationDeleted } = await import(
  '../../src/realtime/publisher.ts'
);

beforeEach(async () => {
  await closeRealtime();
  FakeRedis.published.length = 0;
});

afterAll(async () => {
  await closeRealtime();
  if (previousRedisUrl === undefined) delete process.env['REDIS_URL'];
  else process.env['REDIS_URL'] = previousRedisUrl;
  mock.module('ioredis', () => redisModule);
});

describe('buildSyncAction', () => {
  it('stamps an ISO timestamp, dedupes scopes, and matches the shared contract', () => {
    const action = buildSyncAction({
      syncId: 12,
      organizationId: 'org_1',
      scopes: [scopes.organization('org_1'), scopes.team('team_1'), scopes.organization('org_1')],
      action: 'update',
      model: 'issue',
      modelId: 'issue_1',
      data: { id: 'issue_1' },
      actor: { type: 'user', id: 'user_1', name: 'Ada' },
      at: new Date('2026-01-02T03:04:05.000Z'),
    });

    expect(action.at).toBe('2026-01-02T03:04:05.000Z');
    expect(action.scopes).toEqual(['org:org_1', 'team:team_1']);
    expect(() => syncActionSchema.parse(action)).not.toThrow();
  });

  it('defaults the timestamp to now', () => {
    const action = buildSyncAction({
      syncId: 1,
      organizationId: 'org_1',
      scopes: [scopes.user('user_1')],
      action: 'insert',
      model: 'view',
      modelId: 'view_1',
      data: {},
      actor: { type: 'system', id: 'system' },
    });
    expect(Date.parse(action.at)).toBeLessThanOrEqual(Date.now());
  });

  it('carries the originating client id through and omits the key when there is none', () => {
    const input = {
      syncId: 3,
      organizationId: 'org_1',
      scopes: [scopes.team('team_1')],
      action: 'insert',
      model: 'issue',
      modelId: 'issue_1',
      data: {},
      actor: { type: 'user', id: 'user_1' },
    } as const;

    expect(buildSyncAction({ ...input, originClientId: 'tab_a' }).originClientId).toBe('tab_a');
    expect(buildSyncAction(input)).not.toHaveProperty('originClientId');
    expect(syncActionSchema.safeParse(buildSyncAction(input)).success).toBe(true);
  });
});

describe('publishDeltas', () => {
  it('is a no op when there is nothing to publish', async () => {
    await expect(publishDeltas([])).resolves.toBeUndefined();
    expect(FakeRedis.published).toHaveLength(0);
  });

  it('is a no op when redis is not configured', async () => {
    await closeRealtime();
    delete process.env['REDIS_URL'];
    try {
      await publishDeltas([
        buildSyncAction({
          syncId: 1,
          organizationId: 'org_1',
          scopes: [scopes.organization('org_1')],
          action: 'insert',
          model: 'issue',
          modelId: 'issue_1',
          data: {},
          actor: { type: 'system', id: 'system' },
        }),
      ]);
      expect(FakeRedis.published).toHaveLength(0);
    } finally {
      process.env['REDIS_URL'] = 'redis://fake:6379';
    }
  });

  it('publishes actions when redis is configured', async () => {
    await expect(
      publishDeltas([
        buildSyncAction({
          syncId: 1,
          organizationId: 'org_1',
          scopes: [scopes.organization('org_1')],
          action: 'insert',
          model: 'issue',
          modelId: 'issue_1',
          data: {},
          actor: { type: 'system', id: 'system' },
        }),
      ]),
    ).resolves.toBeUndefined();
    expect(FakeRedis.published).toHaveLength(1);
  });
});

describe('publishOrganizationDeleted', () => {
  it('publishes a validated organization deletion control message', async () => {
    await publishOrganizationDeleted('org_deleted');

    expect(FakeRedis.published).toEqual([
      {
        channel: REDIS_CONTROL_CHANNEL,
        message: JSON.stringify({
          type: 'organization_deleted',
          organizationId: 'org_deleted',
        }),
      },
    ]);
  });
});

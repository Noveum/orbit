import { afterEach, describe, expect, it } from 'bun:test';
import { REDIS_CONTROL_CHANNEL, REDIS_DELTA_CHANNEL } from '@orbit/shared/events';
import {
  buildSyncAction,
  publishDeltas,
  publishOrganizationDeleted,
  publishSessionRevoked,
  registerRealtimeTransport,
} from '../../src/realtime/publisher.ts';

interface Published {
  readonly channel: string;
  readonly message: unknown;
}

function recorder(): { published: Published[]; publish: (c: string, m: string) => Promise<void> } {
  const published: Published[] = [];
  return {
    published,
    publish: (channel, message) => {
      published.push({ channel, message: JSON.parse(message) });
      return Promise.resolve();
    },
  };
}

afterEach(() => {
  registerRealtimeTransport(null);
});

describe('a registered realtime transport', () => {
  it('carries deltas on the delta channel', async () => {
    const transport = recorder();
    registerRealtimeTransport(transport);
    const action = buildSyncAction({
      syncId: 7,
      organizationId: 'org_1',
      scopes: ['org:org_1'],
      action: 'update',
      model: 'label',
      modelId: 'label_1',
      data: {},
      actor: { type: 'user', id: 'user_1' },
    });
    await publishDeltas([action]);
    expect(transport.published).toEqual([{ channel: REDIS_DELTA_CHANNEL, message: [action] }]);
  });

  it('carries revocations and workspace deletions on the control channel', async () => {
    const transport = recorder();
    registerRealtimeTransport(transport);
    await publishSessionRevoked('user_1');
    await publishOrganizationDeleted('org_1');
    expect(transport.published).toEqual([
      { channel: REDIS_CONTROL_CHANNEL, message: { type: 'session_revoked', userId: 'user_1' } },
      {
        channel: REDIS_CONTROL_CHANNEL,
        message: { type: 'organization_deleted', organizationId: 'org_1' },
      },
    ]);
  });

  it('publishes nothing for an empty batch', async () => {
    const transport = recorder();
    registerRealtimeTransport(transport);
    await publishDeltas([]);
    expect(transport.published).toEqual([]);
  });

  it('surfaces a transport failure to the caller', async () => {
    registerRealtimeTransport({ publish: () => Promise.reject(new Error('hub unreachable')) });
    await expect(publishSessionRevoked('user_1')).rejects.toThrow('hub unreachable');
  });
});

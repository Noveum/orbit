import type { Actor, SyncAction, SyncActionKind, SyncModel } from '@orbit/shared/events';
import { REDIS_DELTA_CHANNEL } from '@orbit/shared/events';
import { RedisClient } from 'bun';

export interface BuildSyncActionInput {
  readonly syncId: number;
  readonly organizationId: string;
  readonly scopes: readonly string[];
  readonly action: SyncActionKind;
  readonly model: SyncModel;
  readonly modelId: string;
  readonly data: Record<string, unknown>;
  readonly actor: Actor;
  readonly at?: Date;
  readonly originClientId?: string | undefined;
}

export function buildSyncAction(input: BuildSyncActionInput): SyncAction {
  return {
    syncId: input.syncId,
    organizationId: input.organizationId,
    scopes: [...new Set(input.scopes)],
    action: input.action,
    model: input.model,
    modelId: input.modelId,
    data: input.data,
    actor: input.actor,
    at: (input.at ?? new Date()).toISOString(),
    ...(input.originClientId === undefined ? {} : { originClientId: input.originClientId }),
  };
}

let client: RedisClient | null = null;

function connection(): RedisClient | null {
  const url = process.env['REDIS_URL'];
  if (url === undefined || url.length === 0) return null;
  if (client === null) {
    const created = new RedisClient(url, { maxRetries: 3, enableOfflineQueue: true });
    created.onclose = (error: Error) => {
      if (client !== created) return;
      console.error('[orbit] realtime publisher redis error:', error.message);
    };
    client = created;
  }
  return client;
}

export async function publishDeltas(actions: SyncAction[]): Promise<void> {
  if (actions.length === 0) return;
  const redis = connection();
  if (redis === null) return;
  await redis.publish(REDIS_DELTA_CHANNEL, JSON.stringify(actions));
}

export function closeRealtime(): Promise<void> {
  const open = client;
  client = null;
  open?.close();
  return Promise.resolve();
}

import type { Actor, SyncAction, SyncActionKind, SyncModel } from '@orbit/shared/events';
import { REDIS_DELTA_CHANNEL } from '@orbit/shared/events';
import { Redis } from 'ioredis';

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
  };
}

let client: Redis | null = null;

function connection(): Redis | null {
  const url = process.env['REDIS_URL'];
  if (url === undefined || url.length === 0) return null;
  client ??= new Redis(url, { maxRetriesPerRequest: 3, enableOfflineQueue: true });
  return client;
}

export async function publishDeltas(actions: SyncAction[]): Promise<void> {
  if (actions.length === 0) return;
  const redis = connection();
  if (redis === null) return;
  await redis.publish(REDIS_DELTA_CHANNEL, JSON.stringify(actions));
}

export async function closeRealtime(): Promise<void> {
  const open = client;
  client = null;
  if (open === null) return;
  await open.quit();
}

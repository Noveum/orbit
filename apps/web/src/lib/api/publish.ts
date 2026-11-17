import { publishDeltas } from '@orbit/core';
import type { SyncAction } from '@orbit/shared/events';
import { ORIGIN_CLIENT_ID_HEADER, originClientIdSchema } from '@orbit/shared/events';
import { headers } from 'next/headers';

async function originClientId(): Promise<string | null> {
  const parsed = originClientIdSchema.safeParse((await headers()).get(ORIGIN_CLIENT_ID_HEADER));
  return parsed.success ? parsed.data : null;
}

export async function publish(actions: readonly SyncAction[]): Promise<void> {
  if (actions.length === 0) return;
  try {
    const origin = await originClientId();
    const stamped =
      origin === null
        ? [...actions]
        : actions.map((action) => ({ ...action, originClientId: origin }));
    await publishDeltas(stamped);
  } catch (error: unknown) {
    console.error('Could not publish realtime deltas, the write is already committed.', error);
  }
}

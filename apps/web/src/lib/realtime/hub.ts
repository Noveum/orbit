import { createRealtimeHub, type RealtimeHub, type RealtimeStats } from '@orbit/realtime-server';

const globalForHub = globalThis as unknown as { orbitRealtimeHub?: Promise<RealtimeHub> };

export function realtimeHub(): Promise<RealtimeHub> {
  const existing = globalForHub.orbitRealtimeHub;
  if (existing !== undefined) return existing;
  const created = createRealtimeHub();
  globalForHub.orbitRealtimeHub = created;
  return created;
}

export function redisConfigured(): boolean {
  const url = process.env['REDIS_URL'];
  return url !== undefined && url.length > 0;
}

export async function realtimeStats(): Promise<RealtimeStats | null> {
  const pending = globalForHub.orbitRealtimeHub;
  if (pending === undefined) return null;
  return (await pending).stats();
}

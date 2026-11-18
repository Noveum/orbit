import { createRealtimeHub, type RealtimeHub, type RealtimeStats } from '@orbit/realtime-server';

const globalForHub = globalThis as unknown as {
  orbitRealtimeHub?: Promise<RealtimeHub> | undefined;
};

export function realtimeHub(): Promise<RealtimeHub> {
  const existing = globalForHub.orbitRealtimeHub;
  if (existing !== undefined) return existing;
  const created = createRealtimeHub().catch((error: unknown) => {
    if (globalForHub.orbitRealtimeHub === created) globalForHub.orbitRealtimeHub = undefined;
    throw error;
  });
  globalForHub.orbitRealtimeHub = created;
  return created;
}

export function redisConfigured(): boolean {
  const url = process.env['REDIS_URL'];
  return url !== undefined && url.length > 0;
}

export type RealtimeStatsReader = () => Promise<RealtimeStats>;

let hostedStats: RealtimeStatsReader | undefined;

export function registerHostedRealtime(readStats: RealtimeStatsReader): void {
  hostedStats = readStats;
}

export function realtimeConfigured(): boolean {
  return hostedStats !== undefined || redisConfigured();
}

export async function realtimeStats(): Promise<RealtimeStats> {
  if (hostedStats !== undefined) return await hostedStats();
  return (await realtimeHub()).stats();
}

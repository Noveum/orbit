import { realtimeHub, redisConfigured } from '@/lib/realtime/hub.ts';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

function runtime(): Record<string, string | null> {
  return { bun: process.versions['bun'] ?? null, node: process.versions['node'] ?? null };
}

export async function GET(): Promise<Response> {
  if (!redisConfigured()) {
    return Response.json(
      { status: 'unconfigured', redisConfigured: false, runtime: runtime() },
      { status: 503 },
    );
  }

  try {
    const stats = (await realtimeHub()).stats();
    const healthy = stats.redis === 'ready';
    return Response.json(
      {
        status: healthy ? 'ok' : 'degraded',
        redisConfigured: true,
        hub: stats,
        runtime: runtime(),
      },
      { status: healthy ? 200 : 503 },
    );
  } catch (error: unknown) {
    console.error('The realtime hub could not be opened for a health check.', error);
    return Response.json(
      { status: 'error', redisConfigured: true, runtime: runtime() },
      { status: 503 },
    );
  }
}

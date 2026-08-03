import { realtimeHub, redisConfigured } from '@/lib/realtime/hub.ts';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function runtime(): Record<string, string | null> {
  return { bun: process.versions['bun'] ?? null, node: process.versions['node'] ?? null };
}

export async function GET(): Promise<Response> {
  const configured = redisConfigured();
  if (!configured) {
    return Response.json(
      { status: 'unconfigured', redisConfigured: false, runtime: runtime() },
      { status: 503 },
    );
  }

  try {
    const hub = await realtimeHub();
    const stats = hub.stats();
    return Response.json(
      {
        status: stats.redis === 'ready' ? 'ok' : 'degraded',
        redisConfigured: true,
        hub: stats,
        runtime: runtime(),
      },
      { status: stats.redis === 'ready' ? 200 : 503 },
    );
  } catch (error: unknown) {
    return Response.json(
      { status: 'error', redisConfigured: true, hub: describe(error), runtime: runtime() },
      { status: 503 },
    );
  }
}

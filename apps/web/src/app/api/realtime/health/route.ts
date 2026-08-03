import { realtimeHub, redisConfigured } from '@/lib/realtime/hub.ts';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function GET(): Promise<Response> {
  const configured = redisConfigured();
  if (!configured) {
    return Response.json({ status: 'unconfigured', redisConfigured: false }, { status: 503 });
  }

  try {
    const hub = await realtimeHub();
    const stats = hub.stats();
    return Response.json(
      { status: stats.redis === 'ready' ? 'ok' : 'degraded', redisConfigured: true, hub: stats },
      { status: stats.redis === 'ready' ? 200 : 503 },
    );
  } catch (error: unknown) {
    return Response.json(
      { status: 'error', redisConfigured: true, hub: describe(error) },
      { status: 503 },
    );
  }
}

import { realtimeStats, redisConfigured } from '@/lib/realtime/hub.ts';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const configured = redisConfigured();
  const stats = await realtimeStats();

  return Response.json(
    {
      status: configured ? 'ok' : 'unconfigured',
      redisConfigured: configured,
      hub: stats === null ? 'idle' : stats,
    },
    { status: configured ? 200 : 503 },
  );
}

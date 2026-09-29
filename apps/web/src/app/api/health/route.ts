import { getRecoveryState } from '@orbit/services/backup/readiness';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const databaseUrl = process.env['DIRECT_URL'] ?? process.env['DATABASE_URL'];

  if (databaseUrl !== undefined && databaseUrl.length > 0) {
    try {
      const recoveryState = await getRecoveryState(databaseUrl);
      if (recoveryState !== null && recoveryState.status !== 'ready') {
        return Response.json(
          {
            status: 'unready',
            service: 'web',
            recovery: recoveryState.status,
          },
          { status: 503 },
        );
      }
    } catch {
      return Response.json({ status: 'unready', service: 'web' }, { status: 503 });
    }
  }

  return Response.json({ status: 'ok', service: 'web' }, { status: 200 });
}

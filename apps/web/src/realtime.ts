import { pool } from '@orbit/db';
import { createRealtimeHub, logger } from '@orbit/realtime-server';
import { createNodeRealtimeServer } from './lib/realtime/node-server.ts';

const origin = process.env['BETTER_AUTH_URL'];
if (origin === undefined) throw new Error('BETTER_AUTH_URL is required for realtime.');
const hub = await createRealtimeHub();
const server = await createNodeRealtimeServer(hub, { origin, host: '0.0.0.0', port: 3100 });
logger.info('standalone realtime listening', { port: server.port });
let stopping = false;

async function stop(): Promise<void> {
  if (stopping) return;
  stopping = true;
  await server.close();
  await pool.end();
}

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    stop().catch(() => process.exit(1));
  });
}

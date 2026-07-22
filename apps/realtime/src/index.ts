import { pool } from '@orbit/db';
import { env } from './env.ts';
import { errorFields, logger } from './logger.ts';
import { createRealtimeServer } from './server.ts';

const server = await createRealtimeServer({
  port: env.REALTIME_PORT,
  redisUrl: env.REDIS_URL,
});

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('shutting down', { signal });
  await server.close();
  await pool.end();
  process.exit(0);
}

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    shutdown(signal).catch((error: unknown) => {
      logger.error('shutdown failed', errorFields(error));
      process.exit(1);
    });
  });
}

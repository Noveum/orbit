import { drainIssueOutbox, publishDeltas } from '@orbit/core';
import { pool } from '@orbit/db';
import { errorFields, logger } from '@orbit/realtime-server';
import { agentFeatureEnabled } from '@orbit/shared';
import { env } from './env.ts';
import { createRealtimeServer } from './server.ts';

const server = await createRealtimeServer({
  port: env.REALTIME_PORT,
  redisUrl: env.REDIS_URL,
  ticketSecret: env.BETTER_AUTH_SECRET,
});

let shuttingDown = false;
let draining = false;

const drainTimer = setInterval(() => {
  if (shuttingDown || draining || !agentFeatureEnabled('issue_outbox_dispatch')) return;
  draining = true;
  drainIssueOutbox({
    publish: async (actions) => {
      if (!env.REDIS_URL) throw new Error('REDIS_URL is required for outbox delivery');
      await publishDeltas(actions);
    },
  })
    .catch((error: unknown) => logger.error('issue outbox drain failed', errorFields(error)))
    .finally(() => {
      draining = false;
    });
}, 1_000);
drainTimer.unref();

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(drainTimer);
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

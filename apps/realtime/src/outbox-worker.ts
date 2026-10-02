import { closeRealtime, drainIssueOutbox, publishDeltas } from '@orbit/core';
import { pool } from '@orbit/db';
import { errorFields, logger } from '@orbit/realtime-server';
import { agentFeatureEnabled } from '@orbit/shared';
import { z } from 'zod';

const POLL_INTERVAL_MS = 1_000;
const workerEnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z
    .url()
    .refine((value) => value.startsWith('redis://') || value.startsWith('rediss://')),
});

const workerEnv = workerEnvSchema.safeParse(process.env);

if (!workerEnv.success) {
  throw new Error('DATABASE_URL and a redis:// or rediss:// REDIS_URL are required');
}

if (!agentFeatureEnabled('issue_outbox_dispatch')) {
  throw new Error('ORBIT_ISSUE_OUTBOX_DISPATCH=true is required by the issue outbox worker');
}

let shuttingDown = false;

function waitForNextPoll(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, POLL_INTERVAL_MS);
  });
}

async function runWorker(): Promise<void> {
  logger.info('issue outbox worker started');
  while (!shuttingDown) {
    try {
      await drainIssueOutbox({ publish: publishDeltas });
    } catch (error: unknown) {
      logger.error('issue outbox worker drain failed', errorFields(error));
    }
    if (!shuttingDown) await waitForNextPoll();
  }
}

const worker = runWorker();

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('issue outbox worker stopping', { signal });
  await worker;
  await closeRealtime();
  await pool.end();
  process.exit(0);
}

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    shutdown(signal).catch((error: unknown) => {
      logger.error('issue outbox worker shutdown failed', errorFields(error));
      process.exit(1);
    });
  });
}

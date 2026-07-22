import { closeRealtime } from '@orbit/core';
import { pool } from '@orbit/db';
import { env } from './env.ts';
import { errorFields, logger } from './logger.ts';
import { createMcpHttpServer, MCP_PATH } from './server.ts';

const server = await createMcpHttpServer({ port: env.MCP_PORT, host: '0.0.0.0' });

logger.info('listening', { port: server.port, path: MCP_PATH });

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('shutting down', { signal });
  await server.close();
  await closeRealtime();
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

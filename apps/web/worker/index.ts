import type {
  ExecutionContext,
  Fetcher,
  ScheduledController,
} from '@cloudflare/workers-types/index.ts';
import { withRequestScopedDatabase } from '@orbit/db';
import app from 'vinext/server/fetch-handler';
import { withEdgeClientAddress } from '../src/lib/cloudflare/client-address.ts';
import { runCronJobs } from '../src/lib/cloudflare/cron-schedule.ts';
import { realtimeHub, type WorkerBindings } from './bindings.ts';
import { connectWorkerRuntime } from './runtime.ts';

export { AuthRateLimiterObject } from './auth-rate-limiter.ts';
export { DeferredWorkObject } from './deferred-work.ts';
export { RealtimeHubObject } from './realtime-hub.ts';

const REALTIME_PATH = '/api/ws';

connectWorkerRuntime();

function serve(
  request: Request,
  bindings: WorkerBindings,
  context: ExecutionContext,
): Promise<Response> {
  return withRequestScopedDatabase(() => app.fetch(request, bindings, context));
}

async function nearTheDatabase(placed: Fetcher, request: Request): Promise<Response> {
  const response = await placed.fetch(request.url, { headers: request.headers });
  return response as unknown as Response;
}

function publicOrigin(): string {
  const origin = process.env['BETTER_AUTH_URL'] ?? '';
  if (origin.length === 0) throw new Error('BETTER_AUTH_URL is required to run scheduled jobs.');
  return origin;
}

export default {
  async fetch(
    request: Request,
    bindings: WorkerBindings,
    context: ExecutionContext,
  ): Promise<Response> {
    if (new URL(request.url).pathname === REALTIME_PATH) {
      const upgraded = await realtimeHub().fetch(request.url, {
        headers: request.headers,
      });
      return upgraded as unknown as Response;
    }
    return await serve(withEdgeClientAddress(request), bindings, context);
  },

  async scheduled(
    controller: ScheduledController,
    bindings: WorkerBindings,
    context: ExecutionContext,
  ): Promise<void> {
    const placed = bindings.SELF;
    await runCronJobs(
      controller.cron,
      publicOrigin(),
      process.env['CRON_SECRET'] ?? '',
      placed === undefined
        ? (request) => serve(request, bindings, context)
        : (request) => nearTheDatabase(placed, request),
    );
  },
};

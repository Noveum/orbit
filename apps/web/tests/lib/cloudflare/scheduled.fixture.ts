import { mock } from 'bun:test';
import assert from 'node:assert/strict';
import type { ExecutionContext, ScheduledController } from '@cloudflare/workers-types/index.ts';
import type { WorkerBindings } from '../../../worker/bindings.ts';

const calls: string[] = [];
const record = (source: string, request: Request) => {
  assert.equal(request.url, 'https://cron.example/api/cron/prune');
  assert.equal(request.headers.get('authorization'), 'Bearer fixture-secret');
  calls.push(source);
  return Promise.resolve(new Response(null, { status: 204 }));
};

mock.module('cloudflare:workers', () => ({ DurableObject: class {}, env: {} }));
mock.module('../../../worker/runtime.ts', () => ({ connectWorkerRuntime: () => undefined }));
mock.module('vinext/server/fetch-handler', () => ({
  default: { fetch: (request: Request) => record('local', request) },
}));

process.env['DATABASE_URL'] = 'postgres://fixture:fixture@127.0.0.1:1/fixture_test';
process.env['BETTER_AUTH_URL'] = 'https://cron.example';
process.env['CRON_SECRET'] = 'fixture-secret';
const { default: worker } = await import('../../../worker/index.ts');
const controller = { cron: '0 * * * *' } as ScheduledController;
const context = {} as ExecutionContext;
const local = {} as WorkerBindings;
const placed = {
  SELF: {
    fetch(url: string, options: RequestInit) {
      const request = new Request(url, options);
      assert.equal(request.redirect, 'manual');
      return record('placed', request);
    },
  },
} as unknown as WorkerBindings;

await worker.scheduled(controller, local, context);
await worker.scheduled(controller, placed, context);
assert.deepEqual(calls, ['local', 'placed']);

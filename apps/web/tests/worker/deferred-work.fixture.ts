import { mock } from 'bun:test';
import assert from 'node:assert/strict';

mock.module('cloudflare:workers', () => ({ DurableObject: class {} }));

const failure = new Error('GitHub is unavailable');
let failing = true;
mock.module('../../src/lib/background/perform.ts', () => ({
  performDeferredWork: () => (failing ? Promise.reject(failure) : Promise.resolve()),
}));

const { DeferredWorkObject } = await import('../../worker/deferred-work.ts');
const object: InstanceType<typeof DeferredWorkObject> = Object.create(DeferredWorkObject.prototype);
const work = { kind: 'pull-request-backfill', organizationId: 'org_alarm' };
const values = new Map([['work', work]]);
Object.defineProperty(object, 'ctx', {
  value: {
    storage: {
      get: (key: string) => Promise.resolve(values.get(key)),
      getAlarm: () => Promise.resolve(null),
      deleteAll: () => {
        values.clear();
        return Promise.resolve();
      },
    },
  },
});
await assert.rejects(object.alarm(), failure);
assert.deepEqual(values.get('work'), work);
failing = false;
await object.alarm();
assert.equal(values.size, 0);

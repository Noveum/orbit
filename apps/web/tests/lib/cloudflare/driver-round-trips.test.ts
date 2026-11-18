import { describe, expect, it } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import {
  DRIVER_CONNECTION_MODULE,
  sendParametersWithoutDescribing,
} from '../../../src/lib/cloudflare/driver-round-trips.ts';

const require = createRequire(import.meta.url);
const driverRoot = path.dirname(require.resolve('postgres/package.json'));
const workersBuild = path.join(driverRoot, 'cf/src/connection.js');

describe('the single round trip rewrite of the Postgres driver', () => {
  it('still matches the driver build that Workers bundles', async () => {
    expect(DRIVER_CONNECTION_MODULE.test(workersBuild)).toBe(true);
    const rewritten = sendParametersWithoutDescribing(await readFile(workersBuild, 'utf8'));
    expect(rewritten).toContain('!q.prepared && options.fetch_types !== false)');
  });

  it('keeps the describe step for pools that fetch types', () => {
    const rewritten = sendParametersWithoutDescribing(
      'q.describeFirst = q.onlyDescribe || (parameters.length && !q.prepared)',
    );
    const decide = new Function(
      'q',
      'parameters',
      'options',
      `${rewritten}; return Boolean(q.describeFirst)`,
    ) as (q: object, parameters: unknown[], options: object) => boolean;
    expect(decide({ prepared: false }, ['a'], { fetch_types: true })).toBe(true);
    expect(decide({ prepared: false }, ['a'], { fetch_types: false })).toBe(false);
    expect(decide({ prepared: false }, [], { fetch_types: true })).toBe(false);
    expect(decide({ onlyDescribe: true }, ['a'], { fetch_types: false })).toBe(true);
  });

  it('refuses a driver whose describe decision it does not recognise', () => {
    expect(() => sendParametersWithoutDescribing('const nothing = true;')).toThrow(
      /driver changed/,
    );
  });
});

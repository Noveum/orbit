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
const connectionModule = path.join(driverRoot, 'src/connection.js');

const looseGuard =
  "if (!oids[i] && values[i] !== null && !(typeof values[i] === 'number' && isFinite(values[i])))";

type BindsBeforeDescription = (
  oids: number[],
  values: unknown[],
  options: { fetch_types?: boolean },
) => boolean;

function bindsBeforeDescription(guard: string): BindsBeforeDescription {
  return new Function(
    'oids',
    'values',
    'options',
    `for (let i = 0; i < oids.length; i++) { ${guard} return false } return true`,
  ) as BindsBeforeDescription;
}

describe('the single round trip rewrite of the Postgres driver', () => {
  it('still matches the driver build that Workers bundles', async () => {
    expect(DRIVER_CONNECTION_MODULE.test(connectionModule)).toBe(true);
    const rewritten = sendParametersWithoutDescribing(await readFile(connectionModule, 'utf8'));
    expect(rewritten).toContain("typeof values[i] === 'string' && options.fetch_types === false");
  });

  it('binds strings without waiting only when types are not fetched', () => {
    const original = bindsBeforeDescription(looseGuard);
    const rewritten = bindsBeforeDescription(sendParametersWithoutDescribing(looseGuard));
    expect(original([0], ['a'], { fetch_types: false })).toBe(false);
    expect(rewritten([0], ['a'], { fetch_types: false })).toBe(true);
    expect(rewritten([0], ['a'], { fetch_types: true })).toBe(false);
    expect(rewritten([0], ['a'], {})).toBe(false);
    expect(rewritten([0, 0], ['a', 3], { fetch_types: false })).toBe(true);
    expect(rewritten([0], [new Date(0)], { fetch_types: false })).toBe(false);
    expect(rewritten([0], [['a']], { fetch_types: false })).toBe(false);
    expect(rewritten([0], [true], { fetch_types: false })).toBe(false);
    expect(rewritten([0], [null], { fetch_types: true })).toBe(true);
  });

  it('refuses a driver whose describe decision it does not recognise', () => {
    expect(() => sendParametersWithoutDescribing('const nothing = true;')).toThrow(
      /driver changed/,
    );
  });
});

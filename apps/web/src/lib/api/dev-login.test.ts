import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { DEV_LOGIN_HEADER, devLoginEnabled, isDevLoginRequest } from './dev-login.ts';

const env = process.env as Record<string, string | undefined>;
const STUBBED_KEYS = ['NODE_ENV', 'ORBIT_DEV_LOGIN'];
const originalEnv = new Map(STUBBED_KEYS.map((key) => [key, env[key]]));

afterEach(() => {
  for (const [key, value] of originalEnv) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
});

describe('devLoginEnabled', () => {
  it('stays off unless the flag is explicitly set to 1', () => {
    env['NODE_ENV'] = 'development';
    env['ORBIT_DEV_LOGIN'] = '';
    expect(devLoginEnabled()).toBe(false);

    env['ORBIT_DEV_LOGIN'] = 'true';
    expect(devLoginEnabled()).toBe(false);

    env['ORBIT_DEV_LOGIN'] = '1';
    expect(devLoginEnabled()).toBe(true);
  });

  it('stays off in production even when the flag is set', () => {
    env['NODE_ENV'] = 'production';
    env['ORBIT_DEV_LOGIN'] = '1';
    expect(devLoginEnabled()).toBe(false);
  });
});

describe('isDevLoginRequest', () => {
  beforeEach(() => {
    env['NODE_ENV'] = 'development';
    env['ORBIT_DEV_LOGIN'] = '1';
  });

  it('recognises the marker on the context headers', () => {
    expect(isDevLoginRequest({ headers: new Headers({ [DEV_LOGIN_HEADER]: '1' }) })).toBe(true);
  });

  it('recognises the marker on a plain header record', () => {
    expect(isDevLoginRequest({ headers: { [DEV_LOGIN_HEADER]: '1' } })).toBe(true);
  });

  it('falls back to the headers on the request', () => {
    const request = new Request('http://localhost/api/dev/sign-in', {
      headers: { [DEV_LOGIN_HEADER]: '1' },
    });
    expect(isDevLoginRequest({ request })).toBe(true);
  });

  it('is false for a request that carries no marker', () => {
    expect(isDevLoginRequest({ headers: new Headers() })).toBe(false);
    expect(isDevLoginRequest({})).toBe(false);
    expect(isDevLoginRequest()).toBe(false);
  });

  it('never suppresses a send once dev login is off', () => {
    env['ORBIT_DEV_LOGIN'] = '';
    expect(isDevLoginRequest({ headers: new Headers({ [DEV_LOGIN_HEADER]: '1' }) })).toBe(false);

    env['ORBIT_DEV_LOGIN'] = '1';
    env['NODE_ENV'] = 'production';
    expect(isDevLoginRequest({ headers: new Headers({ [DEV_LOGIN_HEADER]: '1' }) })).toBe(false);
  });
});

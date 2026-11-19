import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { forwardRequest } from '../../../src/lib/auth/forward-request.ts';
import { readCfLikeWorkerd, requestWithoutCf } from './workerd-request.fixture.ts';

let restore: () => void = () => undefined;

beforeEach(() => {
  restore = readCfLikeWorkerd();
});

afterEach(() => {
  restore();
});

describe('forwarding a request that came through a service binding', () => {
  it('fails when the incoming request is used as the init, as it does on workerd', () => {
    const incoming = requestWithoutCf(new Request('https://orbit.test/api/auth/get-session'));
    expect(() => new Request('https://orbit.test/api/auth/get-session', incoming)).toThrow(
      'Illegal invocation',
    );
  });

  it('builds the forwarded request without reading cf from the incoming one', async () => {
    const incoming = requestWithoutCf(
      new Request('https://orbit.test/api/auth/mcp/token', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: 'session=abc' },
        body: JSON.stringify({ grant_type: 'refresh_token' }),
      }),
    );
    const forwarded = await forwardRequest(
      new URL('https://orbit.test/api/auth/oauth2/token'),
      incoming,
    );
    expect(forwarded.url).toBe('https://orbit.test/api/auth/oauth2/token');
    expect(forwarded.method).toBe('POST');
    expect(forwarded.headers.get('cookie')).toBe('session=abc');
    expect(await forwarded.json()).toEqual({ grant_type: 'refresh_token' });
  });

  it('sends no body for a GET', async () => {
    const incoming = requestWithoutCf(
      new Request('https://orbit.test/api/auth/get-session', { headers: { cookie: 'a=b' } }),
    );
    const forwarded = await forwardRequest(new URL(incoming.url), incoming);
    expect(forwarded.method).toBe('GET');
    expect(forwarded.body).toBeNull();
    expect(forwarded.headers.get('cookie')).toBe('a=b');
  });
});

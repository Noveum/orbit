import { afterEach, describe, expect, it } from 'bun:test';
import { configuredRealtimeUrl, resolveRealtimeUrl } from '../../../src/lib/realtime/url.ts';

describe('resolveRealtimeUrl', () => {
  it('honours a configured url while the page is served locally', () => {
    expect(resolveRealtimeUrl('ws://localhost:3100', 'http://localhost:3000')).toBe(
      'ws://localhost:3100',
    );
  });

  it('ignores a configured url once the page is served from a deployed origin', () => {
    expect(resolveRealtimeUrl('ws://localhost:3100', 'https://orbit.example')).toBe(
      'wss://orbit.example/api/ws',
    );
  });

  it('treats a loopback address as local too', () => {
    expect(resolveRealtimeUrl('ws://localhost:3100', 'http://127.0.0.1:3000')).toBe(
      'ws://localhost:3100',
    );
  });

  it('treats the whole 127.0.0.0/8 range as loopback', () => {
    expect(resolveRealtimeUrl('ws://localhost:3100', 'http://127.0.0.2:3000')).toBe(
      'ws://localhost:3100',
    );
    expect(resolveRealtimeUrl('ws://localhost:3100', 'http://127.255.255.254:3000')).toBe(
      'ws://localhost:3100',
    );
  });

  it('treats the IPv6 loopback as local', () => {
    expect(resolveRealtimeUrl('ws://localhost:3100', 'http://[::1]:3000')).toBe(
      'ws://localhost:3100',
    );
  });

  it('does not mistake a hostname that merely looks like loopback for the real thing', () => {
    expect(resolveRealtimeUrl('ws://localhost:3100', 'https://127.0.0.1.orbit.example')).toBe(
      'wss://127.0.0.1.orbit.example/api/ws',
    );
    expect(resolveRealtimeUrl('ws://localhost:3100', 'https://localhost.orbit.example')).toBe(
      'wss://localhost.orbit.example/api/ws',
    );
  });

  it('falls back to the same origin over tls', () => {
    expect(resolveRealtimeUrl('', 'https://orbit.example')).toBe('wss://orbit.example/api/ws');
  });

  it('keeps plain websockets on an insecure origin', () => {
    expect(resolveRealtimeUrl('', 'http://localhost:3000')).toBe('ws://localhost:3000/api/ws');
  });

  it('preserves a port on the same origin', () => {
    expect(resolveRealtimeUrl('', 'https://orbit.example:8443')).toBe(
      'wss://orbit.example:8443/api/ws',
    );
  });

  it('returns nothing when there is no origin to resolve against', () => {
    expect(resolveRealtimeUrl('', '')).toBe('');
  });
});

describe('configuredRealtimeUrl', () => {
  const key = 'NEXT_PUBLIC_REALTIME_URL';
  const saved = process.env[key];
  const env = process.env as Record<string, string | undefined>;
  const savedMode = env['NODE_ENV'];

  afterEach(() => {
    if (saved === undefined) delete process.env[key];
    else process.env[key] = saved;
    env['NODE_ENV'] = savedMode;
  });

  it('keeps a websocket url', () => {
    process.env[key] = 'wss://orbit.example/api/ws';
    expect(configuredRealtimeUrl()).toBe('wss://orbit.example/api/ws');
  });

  it('ignores a configured url in production so the socket always follows the app origin', () => {
    env['NODE_ENV'] = 'production';
    process.env[key] = 'wss://realtime.orbit.example';
    expect(configuredRealtimeUrl()).toBe('');
  });

  it('falls back to the same origin when the url is not a websocket', () => {
    process.env[key] = 'https://orbit.example/api/ws';
    expect(configuredRealtimeUrl()).toBe('');
  });

  it('falls back to the same origin when the url is malformed', () => {
    process.env[key] = 'not a url';
    expect(configuredRealtimeUrl()).toBe('');
  });
});

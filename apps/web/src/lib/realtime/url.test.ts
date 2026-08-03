import { afterEach, describe, expect, it } from 'bun:test';
import { configuredRealtimeUrl, resolveRealtimeUrl } from './url.ts';

describe('resolveRealtimeUrl', () => {
  it('prefers an explicitly configured url', () => {
    expect(resolveRealtimeUrl('ws://localhost:3100', 'https://orbit.example')).toBe(
      'ws://localhost:3100',
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

  afterEach(() => {
    if (saved === undefined) delete process.env[key];
    else process.env[key] = saved;
  });

  it('keeps a websocket url', () => {
    process.env[key] = 'wss://orbit.example/api/ws';
    expect(configuredRealtimeUrl()).toBe('wss://orbit.example/api/ws');
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

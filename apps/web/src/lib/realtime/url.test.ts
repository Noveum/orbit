import { describe, expect, it } from 'bun:test';
import { resolveRealtimeUrl } from './url.ts';

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

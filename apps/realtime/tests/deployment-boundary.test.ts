import { describe, expect, it } from 'bun:test';
import {
  normalizeAllowedOrigins,
  normalizeRealtimePath,
  realtimeOriginAllowed,
  realtimePathMatches,
} from '../src/server.ts';

describe('portable realtime deployment boundary', () => {
  it('uses the same-origin websocket path by default', () => {
    expect(normalizeRealtimePath(undefined)).toBe('/api/ws');
    expect(normalizeRealtimePath('/api/ws/')).toBe('/api/ws');
    expect(() => normalizeRealtimePath('api/ws')).toThrow();
    expect(() => normalizeRealtimePath('/api/ws?token=secret')).toThrow();
    expect(() => normalizeRealtimePath('/api/ws#fragment')).toThrow();
  });

  it('matches only the configured websocket path', () => {
    const path = normalizeRealtimePath('/api/ws');
    expect(realtimePathMatches(new Request('https://orbit.example/api/ws'), path)).toBe(true);
    expect(realtimePathMatches(new Request('https://orbit.example/api/ws/'), path)).toBe(true);
    expect(realtimePathMatches(new Request('https://orbit.example/api/ws?attempt=1'), path)).toBe(
      true,
    );
    expect(realtimePathMatches(new Request('https://orbit.example/api/ws/other'), path)).toBe(
      false,
    );
    expect(realtimePathMatches(new Request('https://orbit.example/mcp'), path)).toBe(false);
  });

  it('lets a root path match the root', () => {
    const root = normalizeRealtimePath('/');
    expect(realtimePathMatches(new Request('https://orbit.example/'), root)).toBe(true);
    expect(realtimePathMatches(new Request('https://orbit.example'), root)).toBe(true);
    expect(realtimePathMatches(new Request('https://orbit.example/api/ws'), root)).toBe(false);
  });

  it('normalizes and deduplicates allowed browser origins', () => {
    expect(
      normalizeAllowedOrigins([
        'https://orbit.example/path',
        'https://orbit.example',
        'http://localhost:3000/onboarding',
      ]),
    ).toEqual(['https://orbit.example', 'http://localhost:3000']);
    expect(() => normalizeAllowedOrigins(['wss://orbit.example'])).toThrow();
    expect(() => normalizeAllowedOrigins(['not a url'])).toThrow();
  });

  it('requires an exact allowed origin only when a policy is configured', () => {
    const request = new Request('https://realtime.internal/api/ws', {
      headers: { origin: 'https://orbit.example/workspace' },
    });
    expect(realtimeOriginAllowed(request, [])).toBe(true);
    expect(realtimeOriginAllowed(request, ['https://orbit.example'])).toBe(true);
    expect(realtimeOriginAllowed(request, ['https://other.example'])).toBe(false);
    expect(
      realtimeOriginAllowed(new Request('https://realtime.internal/api/ws'), [
        'https://orbit.example',
      ]),
    ).toBe(false);
  });
});

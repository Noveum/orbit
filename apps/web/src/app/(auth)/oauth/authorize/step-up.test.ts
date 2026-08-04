import { describe, expect, it } from 'bun:test';
import { FRESH_SESSION_WINDOW_MS, signedInWithin } from './step-up.ts';

const NOW = Date.parse('2026-08-04T12:00:00.000Z');

describe('a session that just authenticated satisfies the step up', () => {
  it('counts a sign in from moments ago', () => {
    const justNow = new Date(NOW - 30_000);
    expect(signedInWithin(justNow, FRESH_SESSION_WINDOW_MS, NOW)).toBe(true);
    expect(signedInWithin(justNow.toISOString(), FRESH_SESSION_WINDOW_MS, NOW)).toBe(true);
  });

  it('does not count a session older than the window, which still needs a passkey', () => {
    const yesterday = new Date(NOW - 24 * 60 * 60 * 1000);
    expect(signedInWithin(yesterday, FRESH_SESSION_WINDOW_MS, NOW)).toBe(false);
  });

  it('treats the window edge as expired rather than fresh', () => {
    const exactly = new Date(NOW - FRESH_SESSION_WINDOW_MS);
    expect(signedInWithin(exactly, FRESH_SESSION_WINDOW_MS, NOW)).toBe(false);
    expect(
      signedInWithin(new Date(NOW - FRESH_SESSION_WINDOW_MS + 1), FRESH_SESSION_WINDOW_MS, NOW),
    ).toBe(true);
  });

  it('refuses a timestamp it cannot read, so a bad value never skips the check', () => {
    expect(signedInWithin('not a date', FRESH_SESSION_WINDOW_MS, NOW)).toBe(false);
    expect(signedInWithin(new Date(Number.NaN), FRESH_SESSION_WINDOW_MS, NOW)).toBe(false);
  });

  it('refuses a session stamped in the future, so a skewed clock cannot skip the check', () => {
    expect(signedInWithin(new Date(NOW + 60_000), FRESH_SESSION_WINDOW_MS, NOW)).toBe(false);
  });
});

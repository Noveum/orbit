import { describe, expect, it } from 'bun:test';
import {
  controlMessageSchema,
  REDIS_CONTROL_CHANNEL,
  SESSION_REVOKED_CLOSE_CODE,
} from '../../src/events/index.ts';

describe('control message', () => {
  it('accepts a session_revoked message', () => {
    const parsed = controlMessageSchema.safeParse({ type: 'session_revoked', userId: 'user_1' });
    expect(parsed.success).toBe(true);
  });

  it('rejects an unknown type', () => {
    const parsed = controlMessageSchema.safeParse({ type: 'nope', userId: 'user_1' });
    expect(parsed.success).toBe(false);
  });

  it('rejects an empty userId', () => {
    const parsed = controlMessageSchema.safeParse({ type: 'session_revoked', userId: '' });
    expect(parsed.success).toBe(false);
  });

  it('uses a dedicated channel and a distinct close code', () => {
    expect(REDIS_CONTROL_CHANNEL).toBe('orbit:control');
    expect(SESSION_REVOKED_CLOSE_CODE).toBe(4002);
  });
});

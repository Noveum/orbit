import { describe, expect, it } from 'bun:test';
import {
  slackCallbackSchema,
  slackIntegrationActionSchema,
  slackMemberSyncResultSchema,
} from '../../src/validators/integration.ts';

describe('Slack callback validator', () => {
  it('accepts bounded non-empty OAuth code and state values', () => {
    expect(
      slackCallbackSchema.safeParse({ code: ' oauth-code ', state: ' oauth-state ' }).success,
    ).toBe(true);
    expect(slackCallbackSchema.safeParse({ state: 'oauth-state' }).success).toBe(false);
    expect(slackCallbackSchema.safeParse({ code: 'oauth-code' }).success).toBe(false);
    expect(slackCallbackSchema.safeParse({ code: ' ', state: 'oauth-state' }).success).toBe(false);
    expect(slackCallbackSchema.safeParse({ code: 'oauth-code', state: ' ' }).success).toBe(false);
    expect(
      slackCallbackSchema.safeParse({ code: 'x'.repeat(256), state: 'oauth-state' }).success,
    ).toBe(false);
    expect(
      slackCallbackSchema.safeParse({ code: 'oauth-code', state: 'x'.repeat(2049) }).success,
    ).toBe(false);
  });
});

describe('Slack integration action validator', () => {
  it('accepts member synchronization without client-controlled identifiers', () => {
    expect(slackIntegrationActionSchema.parse({ action: 'sync_members' })).toEqual({
      action: 'sync_members',
    });
  });

  it('rejects unknown actions and incomplete channel actions', () => {
    expect(slackIntegrationActionSchema.safeParse({ action: 'sync-users' }).success).toBe(false);
    expect(slackIntegrationActionSchema.safeParse({ action: 'connect' }).success).toBe(false);
    expect(slackIntegrationActionSchema.safeParse({ action: 'disconnect' }).success).toBe(false);
  });
});

describe('Slack member sync result validator', () => {
  it('accepts nonnegative integer member counts', () => {
    expect(slackMemberSyncResultSchema.parse({ eligible: 3, mapped: 2 })).toEqual({
      eligible: 3,
      mapped: 2,
    });
  });

  it('rejects missing, negative, and fractional member counts', () => {
    expect(slackMemberSyncResultSchema.safeParse({ mapped: 2 }).success).toBe(false);
    expect(slackMemberSyncResultSchema.safeParse({ eligible: -1, mapped: 0 }).success).toBe(false);
    expect(slackMemberSyncResultSchema.safeParse({ eligible: 1, mapped: 0.5 }).success).toBe(false);
  });
});

import { describe, expect, it } from 'bun:test';
import { slackCallbackSchema } from '../../src/validators/integration.ts';

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

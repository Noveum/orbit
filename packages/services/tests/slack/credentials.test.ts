import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { DomainError } from '@orbit/shared/errors';
import {
  decryptSlackBotToken,
  encryptSlackBotToken,
  hasSlackBotToken,
} from '../../src/slack/credentials.ts';

const originalSecret = process.env['BETTER_AUTH_SECRET'];

describe('Slack bot token credentials', () => {
  beforeEach(() => {
    process.env['BETTER_AUTH_SECRET'] = 'test-only-slack-credential-secret';
  });

  afterEach(() => {
    if (originalSecret === undefined) delete process.env['BETTER_AUTH_SECRET'];
    else process.env['BETTER_AUTH_SECRET'] = originalSecret;
  });

  it('encrypts and decrypts a bot token without storing plaintext', () => {
    const envelope = encryptSlackBotToken({
      organizationId: 'org_noveum',
      integrationId: 'int_slack',
      token: 'xoxb-test-only',
    });

    expect(envelope.version).toBe(1);
    expect(JSON.stringify(envelope)).not.toContain('xoxb-test-only');
    expect(
      decryptSlackBotToken(
        { botToken: envelope },
        { organizationId: 'org_noveum', integrationId: 'int_slack' },
      ),
    ).toBe('xoxb-test-only');
  });

  it('uses a fresh IV for every encrypted write', () => {
    const input = {
      organizationId: 'org_noveum',
      integrationId: 'int_slack',
      token: 'xoxb-test-only',
    };
    const first = encryptSlackBotToken(input);
    const second = encryptSlackBotToken(input);

    expect(first.iv).not.toBe(second.iv);
    expect(first.ciphertext).not.toBe(second.ciphertext);
  });

  it('binds encrypted credentials to their organization and integration', () => {
    const envelope = encryptSlackBotToken({
      organizationId: 'org_noveum',
      integrationId: 'int_slack',
      token: 'xoxb-test-only',
    });

    for (const identity of [
      { organizationId: 'org_other', integrationId: 'int_slack' },
      { organizationId: 'org_noveum', integrationId: 'int_other' },
    ]) {
      expect(() => decryptSlackBotToken({ botToken: envelope }, identity)).toThrow(DomainError);
      try {
        decryptSlackBotToken({ botToken: envelope }, identity);
      } catch (error) {
        expect(error).toMatchObject({ code: 'internal' });
        expect(String(error)).not.toContain('xoxb-test-only');
      }
    }
  });

  it('reads a legacy plaintext bot token without rewriting it', () => {
    const credentials = { botToken: 'xoxb-legacy' };
    expect(
      decryptSlackBotToken(credentials, {
        organizationId: 'org_noveum',
        integrationId: 'int_slack',
      }),
    ).toBe('xoxb-legacy');
    expect(credentials).toEqual({ botToken: 'xoxb-legacy' });
  });

  it('detects encrypted and legacy tokens without decrypting them', () => {
    const envelope = encryptSlackBotToken({
      organizationId: 'org_noveum',
      integrationId: 'int_slack',
      token: 'xoxb-test-only',
    });

    expect(hasSlackBotToken({ botToken: envelope })).toBe(true);
    expect(hasSlackBotToken({ botToken: 'xoxb-legacy' })).toBe(true);
    expect(hasSlackBotToken({ botToken: '' })).toBe(false);
    expect(hasSlackBotToken({ botToken: { ...envelope, version: 2 } })).toBe(false);
    expect(hasSlackBotToken({})).toBe(false);
  });

  it('fails safely when the encryption secret is unavailable', () => {
    delete process.env['BETTER_AUTH_SECRET'];

    expect(() =>
      encryptSlackBotToken({
        organizationId: 'org_noveum',
        integrationId: 'int_slack',
        token: 'xoxb-must-not-leak',
      }),
    ).toThrow(DomainError);
    try {
      encryptSlackBotToken({
        organizationId: 'org_noveum',
        integrationId: 'int_slack',
        token: 'xoxb-must-not-leak',
      });
    } catch (error) {
      expect(error).toMatchObject({ code: 'internal' });
      expect(String(error)).not.toContain('xoxb-must-not-leak');
    }
  });
});

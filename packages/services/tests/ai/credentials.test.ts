import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { DomainError } from '@orbit/shared/errors';
import { decryptAiApiKey, encryptAiApiKey, hasAiApiKey } from '../../src/ai/credentials.ts';

const originalSecret = process.env['BETTER_AUTH_SECRET'];

describe('AI API key credentials', () => {
  beforeEach(() => {
    process.env['BETTER_AUTH_SECRET'] = 'test-only-ai-credential-secret';
  });

  afterEach(() => {
    if (originalSecret === undefined) delete process.env['BETTER_AUTH_SECRET'];
    else process.env['BETTER_AUTH_SECRET'] = originalSecret;
  });

  it('encrypts and decrypts an API key without storing plaintext', () => {
    const envelope = encryptAiApiKey({
      organizationId: 'org_test_1',
      apiKey: 'sk-test-secret-key-12345',
    });

    expect(envelope.version).toBe(1);
    expect(JSON.stringify(envelope)).not.toContain('sk-test-secret-key-12345');
    expect(decryptAiApiKey({ apiKey: envelope }, { organizationId: 'org_test_1' })).toBe(
      'sk-test-secret-key-12345',
    );
  });

  it('uses a fresh IV for every encrypted write', () => {
    const input = {
      organizationId: 'org_test_1',
      apiKey: 'sk-test-secret-key-12345',
    };
    const first = encryptAiApiKey(input);
    const second = encryptAiApiKey(input);

    expect(first.iv).not.toBe(second.iv);
    expect(first.ciphertext).not.toBe(second.ciphertext);
  });

  it('binds encrypted credentials to the organization', () => {
    const envelope = encryptAiApiKey({
      organizationId: 'org_test_1',
      apiKey: 'sk-test-secret-key-12345',
    });

    expect(() => decryptAiApiKey({ apiKey: envelope }, { organizationId: 'org_test_2' })).toThrow(
      DomainError,
    );

    try {
      decryptAiApiKey({ apiKey: envelope }, { organizationId: 'org_test_2' });
    } catch (error) {
      expect(error).toMatchObject({ code: 'internal' });
      expect(String(error)).not.toContain('sk-test-secret-key-12345');
    }
  });

  it('fails safely when the encryption secret is unavailable', () => {
    delete process.env['BETTER_AUTH_SECRET'];

    expect(() =>
      encryptAiApiKey({
        organizationId: 'org_test_1',
        apiKey: 'sk-must-not-leak',
      }),
    ).toThrow(DomainError);

    try {
      encryptAiApiKey({
        organizationId: 'org_test_1',
        apiKey: 'sk-must-not-leak',
      });
    } catch (error) {
      expect(error).toMatchObject({ code: 'internal' });
      expect(String(error)).not.toContain('sk-must-not-leak');
    }
  });

  it('detects encrypted key presence and rejects plaintext keys', () => {
    const envelope = encryptAiApiKey({
      organizationId: 'org_test_1',
      apiKey: 'sk-test-secret-key-12345',
    });

    expect(hasAiApiKey({ apiKey: envelope })).toBe(true);
    expect(hasAiApiKey({ apiKey: 'sk-plaintext' })).toBe(false);
    expect(hasAiApiKey({ apiKey: '' })).toBe(false);
    expect(hasAiApiKey({})).toBe(false);
  });

  it('rejects unencrypted plaintext keys on decryption', () => {
    expect(() =>
      decryptAiApiKey({ apiKey: 'sk-unencrypted-plaintext' }, { organizationId: 'org_test_1' }),
    ).toThrow(DomainError);
  });
});

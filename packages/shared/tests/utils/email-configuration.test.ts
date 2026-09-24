import { describe, expect, it } from 'bun:test';
import { emailConfigured } from '../../src/utils/email-configuration.ts';

describe('emailConfigured', () => {
  it.each([undefined, '', ' ', 'invalid', 'Orbit <auth@orbit.local>', 'auth@example.local'])(
    'rejects missing or unusable sender %s',
    (sender) => {
      expect(emailConfigured({ RESEND_API_KEY: 'test-key', EMAIL_FROM: sender })).toBe(false);
    },
  );

  it.each(['orbit@example.com', ' Orbit <orbit@example.com> ', 'Orbit <orbit@example.com >'])(
    'accepts a configured sender %s',
    (sender) => {
      expect(emailConfigured({ RESEND_API_KEY: 'test-key', EMAIL_FROM: sender })).toBe(true);
    },
  );

  it('requires a nonblank API key even with a valid sender', () => {
    expect(emailConfigured({ EMAIL_FROM: 'orbit@example.com' })).toBe(false);
    expect(emailConfigured({ RESEND_API_KEY: ' ', EMAIL_FROM: 'orbit@example.com' })).toBe(false);
  });
});

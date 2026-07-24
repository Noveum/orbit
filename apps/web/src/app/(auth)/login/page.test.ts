import { describe, expect, it } from 'bun:test';
import { EMAIL_DOMAIN_BLOCKED_MESSAGE } from '@/lib/auth/server.ts';
import { signInErrorMessage } from './page.tsx';

describe('signInErrorMessage', () => {
  it('maps the blocked domain code to the friendly message', () => {
    expect(signInErrorMessage('EMAIL_DOMAIN_NOT_ALLOWED')).toBe(EMAIL_DOMAIN_BLOCKED_MESSAGE);
  });

  it('never renders arbitrary external text, only a generic fallback', () => {
    expect(signInErrorMessage('anything_else')).toBe(
      'Something went wrong signing you in. Try again.',
    );
    expect(signInErrorMessage('<script>alert(1)</script>')).toBe(
      'Something went wrong signing you in. Try again.',
    );
  });

  it('rejects empty, oversized, or repeated params', () => {
    expect(signInErrorMessage(undefined)).toBeUndefined();
    expect(signInErrorMessage('')).toBeUndefined();
    expect(signInErrorMessage('a'.repeat(65))).toBeUndefined();
    expect(signInErrorMessage(['a', 'b'])).toBeUndefined();
  });
});

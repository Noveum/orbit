import { describe, expect, it } from 'bun:test';
import { authErrorCode, describeAuthError } from './oauth-error.ts';

describe('describeAuthError', () => {
  it('maps the email mismatch code returned by the GitHub callback', () => {
    expect(describeAuthError("email_doesn't_match")).toContain('different email');
  });

  it('is case insensitive and trims the code', () => {
    expect(describeAuthError('  ACCESS_DENIED ')).toBe(describeAuthError('access_denied'));
  });

  it('maps the server domain-restriction code', () => {
    expect(describeAuthError('EMAIL_DOMAIN_NOT_ALLOWED')).toContain('domain is not allowed');
  });

  it('falls back to a friendly message for unknown codes', () => {
    expect(describeAuthError('some_brand_new_code')).toBe(
      'We could not complete that sign in. Please try again.',
    );
  });
});

describe('authErrorCode', () => {
  it('returns a present code', () => {
    expect(authErrorCode("email_doesn't_match")).toBe("email_doesn't_match");
  });

  it('takes the first value of an array', () => {
    expect(authErrorCode(['access_denied', 'other'])).toBe('access_denied');
  });

  it('treats missing or empty values as no error', () => {
    expect(authErrorCode(undefined)).toBeUndefined();
    expect(authErrorCode('')).toBeUndefined();
    expect(authErrorCode([])).toBeUndefined();
  });
});

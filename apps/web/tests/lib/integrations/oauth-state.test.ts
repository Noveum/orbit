import { describe, expect, it } from 'bun:test';
import {
  OAUTH_STATE_TTL_MS,
  signOAuthState,
  verifyOAuthState,
} from '../../../src/lib/integrations/oauth-state.ts';

const SECRET = 'a-very-long-test-secret-value-0123456789';

describe('oauth state', () => {
  it('round-trips a signed state back to its payload', () => {
    const token = signOAuthState({ org: 'org-1', user: 'user-1', provider: 'github' }, SECRET);
    expect(verifyOAuthState(token, SECRET, 'github')).toEqual({
      org: 'org-1',
      user: 'user-1',
      provider: 'github',
    });
  });

  it('rejects a tampered body', () => {
    const token = signOAuthState({ org: 'org-1', user: 'user-1', provider: 'slack' }, SECRET);
    const [body, signature] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ org: 'attacker', user: 'x', provider: 'slack' }))
      .toString('base64url')
      .concat('.', signature ?? '');
    expect(verifyOAuthState(forged, SECRET, 'slack')).toBeNull();
    expect(body).toBeDefined();
  });

  it('rejects a state signed with a different secret', () => {
    const token = signOAuthState({ org: 'org-1', user: 'user-1', provider: 'github' }, SECRET);
    expect(verifyOAuthState(token, 'another-secret-entirely-9876543210', 'github')).toBeNull();
  });

  it('rejects a provider mismatch', () => {
    const token = signOAuthState({ org: 'org-1', user: 'user-1', provider: 'github' }, SECRET);
    expect(verifyOAuthState(token, SECRET, 'slack')).toBeNull();
  });

  it('rejects an expired state', () => {
    const issuedAt = new Date('2026-01-01T00:00:00.000Z');
    const token = signOAuthState(
      { org: 'org-1', user: 'user-1', provider: 'github' },
      SECRET,
      issuedAt,
    );
    const afterExpiry = new Date(issuedAt.getTime() + OAUTH_STATE_TTL_MS + 1);
    expect(verifyOAuthState(token, SECRET, 'github', afterExpiry)).toBeNull();
  });

  it('rejects a malformed token', () => {
    expect(verifyOAuthState('not-a-valid-token', SECRET, 'github')).toBeNull();
    expect(verifyOAuthState('', SECRET, 'github')).toBeNull();
  });
});

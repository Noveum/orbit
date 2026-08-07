import { describe, expect, it } from 'bun:test';
import {
  mintOAuthState,
  OAUTH_STATE_TTL_MS,
  verifyOAuthState,
} from '../../../src/lib/integrations/oauth-state.ts';

const SECRET = 'a-very-long-test-secret-value-0123456789';

function tokenFor(
  org: string,
  user: string,
  provider: 'github' | 'slack',
  issuedAt?: Date,
): string {
  return mintOAuthState({ org, user, provider }, SECRET, issuedAt).token;
}

describe('oauth state', () => {
  it('round-trips a signed state back to its payload', () => {
    const verified = verifyOAuthState(tokenFor('org-1', 'user-1', 'github'), SECRET, 'github');
    expect(verified?.org).toBe('org-1');
    expect(verified?.user).toBe('user-1');
    expect(verified?.provider).toBe('github');
    expect(verified?.nonce.length).toBeGreaterThan(0);
  });

  it('gives every state its own nonce so one cannot stand in for another', () => {
    const first = mintOAuthState({ org: 'org-1', user: 'user-1', provider: 'github' }, SECRET);
    const second = mintOAuthState({ org: 'org-1', user: 'user-1', provider: 'github' }, SECRET);
    expect(first.nonce).not.toBe(second.nonce);
    expect(verifyOAuthState(first.token, SECRET, 'github')?.nonce).toBe(first.nonce);
  });

  it('reports the expiry it stamped so the nonce can be stored with it', () => {
    const issuedAt = new Date('2026-01-01T00:00:00.000Z');
    const minted = mintOAuthState(
      { org: 'org-1', user: 'user-1', provider: 'github' },
      SECRET,
      issuedAt,
    );
    expect(minted.expiresAt.getTime()).toBe(issuedAt.getTime() + OAUTH_STATE_TTL_MS);
  });

  it('rejects a tampered body', () => {
    const token = tokenFor('org-1', 'user-1', 'slack');
    const [body, signature] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ org: 'attacker', user: 'x', provider: 'slack' }))
      .toString('base64url')
      .concat('.', signature ?? '');
    expect(verifyOAuthState(forged, SECRET, 'slack')).toBeNull();
    expect(body).toBeDefined();
  });

  it('rejects a state signed with a different secret', () => {
    const token = tokenFor('org-1', 'user-1', 'github');
    expect(verifyOAuthState(token, 'another-secret-entirely-9876543210', 'github')).toBeNull();
  });

  it('rejects a provider mismatch', () => {
    expect(verifyOAuthState(tokenFor('org-1', 'user-1', 'github'), SECRET, 'slack')).toBeNull();
  });

  it('rejects an expired state', () => {
    const issuedAt = new Date('2026-01-01T00:00:00.000Z');
    const token = tokenFor('org-1', 'user-1', 'github', issuedAt);
    const afterExpiry = new Date(issuedAt.getTime() + OAUTH_STATE_TTL_MS + 1);
    expect(verifyOAuthState(token, SECRET, 'github', afterExpiry)).toBeNull();
  });

  it('rejects a malformed token', () => {
    expect(verifyOAuthState('not-a-valid-token', SECRET, 'github')).toBeNull();
    expect(verifyOAuthState('', SECRET, 'github')).toBeNull();
  });
});

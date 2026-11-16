import { describe, expect, it } from 'bun:test';
import {
  canRemoveSignInMethod,
  deviceLabelOf,
  LAST_CREDENTIAL_MESSAGE,
  linkedAccountRowId,
  removalBlockReason,
} from '../../../src/features/account/credentials.ts';

describe('canRemoveSignInMethod', () => {
  it('blocks removing the only connected provider', () => {
    expect(canRemoveSignInMethod({ accounts: 1, passkeys: 0 })).toBe(false);
    expect(removalBlockReason({ accounts: 1, passkeys: 0 })).toBe(LAST_CREDENTIAL_MESSAGE);
  });

  it('blocks removing the only passkey', () => {
    expect(canRemoveSignInMethod({ accounts: 0, passkeys: 1 })).toBe(false);
  });

  it('blocks removal when nothing is left at all', () => {
    expect(canRemoveSignInMethod({ accounts: 0, passkeys: 0 })).toBe(false);
  });

  it('allows removal once a passkey backs up a single provider', () => {
    expect(canRemoveSignInMethod({ accounts: 1, passkeys: 1 })).toBe(true);
    expect(removalBlockReason({ accounts: 1, passkeys: 1 })).toBeNull();
  });

  it('allows removal with two providers', () => {
    expect(canRemoveSignInMethod({ accounts: 2, passkeys: 0 })).toBe(true);
  });
});

describe('linkedAccountRowId', () => {
  const accounts = [
    { id: 'local-google', providerId: 'google', accountId: 'provider-42' },
    { id: 'local-github', providerId: 'github', accountId: 'provider-42' },
  ];

  it('maps the existing provider selector to its local account row', () => {
    expect(linkedAccountRowId(accounts, 'github', 'provider-42')).toBe('local-github');
    expect(linkedAccountRowId(accounts, 'google', 'provider-42')).toBe('local-google');
  });

  it('rejects an account outside the signed-in account list', () => {
    expect(linkedAccountRowId(accounts, 'github', 'another-account')).toBeNull();
    expect(linkedAccountRowId(accounts, 'unknown')).toBeNull();
  });

  it('requires an exact account when a provider has multiple linked identities', () => {
    const multiple = [
      ...accounts,
      { id: 'other-google', providerId: 'google', accountId: 'other' },
    ];
    expect(linkedAccountRowId(multiple, 'google')).toBeNull();
    expect(linkedAccountRowId(multiple, 'google', 'other')).toBe('other-google');
  });
});

describe('deviceLabelOf', () => {
  it('names the browser and platform', () => {
    expect(
      deviceLabelOf(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36',
      ),
    ).toBe('Chrome on macOS');
  });

  it('prefers Edge over the Chrome token it also carries', () => {
    expect(
      deviceLabelOf('Mozilla/5.0 (Windows NT 10.0) Chrome/140.0 Safari/537.36 Edg/140.0'),
    ).toBe('Edge on Windows');
  });

  it('falls back when the agent is missing', () => {
    expect(deviceLabelOf(null)).toBe('Unknown device');
    expect(deviceLabelOf('   ')).toBe('Unknown device');
  });
});

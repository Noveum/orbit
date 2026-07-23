import { describe, expect, it } from 'vitest';
import {
  canRemoveSignInMethod,
  deviceLabelOf,
  LAST_CREDENTIAL_MESSAGE,
  removalBlockReason,
} from './credentials.ts';

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

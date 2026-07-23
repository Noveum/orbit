export const LAST_CREDENTIAL_MESSAGE =
  'This is the only way you can sign in. Add a passkey or connect another provider before removing it.';

export interface SignInMethodCount {
  readonly accounts: number;
  readonly passkeys: number;
}

export function signInMethodTotal(counts: SignInMethodCount): number {
  return counts.accounts + counts.passkeys;
}

export function canRemoveSignInMethod(counts: SignInMethodCount): boolean {
  return signInMethodTotal(counts) > 1;
}

export function removalBlockReason(counts: SignInMethodCount): string | null {
  return canRemoveSignInMethod(counts) ? null : LAST_CREDENTIAL_MESSAGE;
}

const BROWSERS: readonly (readonly [string, string])[] = [
  ['Edg/', 'Edge'],
  ['OPR/', 'Opera'],
  ['Chrome/', 'Chrome'],
  ['Safari/', 'Safari'],
  ['Firefox/', 'Firefox'],
];

const PLATFORMS: readonly (readonly [string, string])[] = [
  ['iPhone', 'iPhone'],
  ['iPad', 'iPad'],
  ['Android', 'Android'],
  ['Mac OS X', 'macOS'],
  ['Macintosh', 'macOS'],
  ['Windows', 'Windows'],
  ['Linux', 'Linux'],
];

export function deviceLabelOf(userAgent: string | null | undefined): string {
  if (userAgent === null || userAgent === undefined || userAgent.trim().length === 0) {
    return 'Unknown device';
  }
  const browser = BROWSERS.find(([token]) => userAgent.includes(token))?.[1];
  const platform = PLATFORMS.find(([token]) => userAgent.includes(token))?.[1];
  if (browser !== undefined && platform !== undefined) return `${browser} on ${platform}`;
  return browser ?? platform ?? 'Unknown device';
}

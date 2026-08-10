import { afterAll, mock } from 'bun:test';
import type { MembershipContext } from '@/lib/auth/principal.ts';
import * as principalModule from '@/lib/auth/principal.ts';
import * as sessionModule from '@/lib/auth/session.ts';

export const SESSION_MODULE = '@/lib/auth/session.ts';
export const PRINCIPAL_MODULE = '@/lib/auth/principal.ts';

const realSession = { ...sessionModule };
const realPrincipal = { ...principalModule };

export function mockSession<T>(read: () => T | null): void {
  mock.module(SESSION_MODULE, () => ({
    ...realSession,
    getSession: () => Promise.resolve(read()),
    requireSession: () => Promise.resolve(read()),
  }));
  afterAll(() => {
    mock.module(SESSION_MODULE, () => realSession);
  });
}

export function mockMembership(read: () => MembershipContext | null): void {
  mock.module(PRINCIPAL_MODULE, () => ({
    ...realPrincipal,
    resolveMembership: () => Promise.resolve(read()),
  }));
  afterAll(() => {
    mock.module(PRINCIPAL_MODULE, () => realPrincipal);
  });
}

export async function restoreModulesAfterThisFile(specifiers: readonly string[]): Promise<void> {
  const originals = new Map<string, Record<string, unknown>>();
  for (const specifier of specifiers) {
    originals.set(specifier, { ...(await import(specifier)) });
  }
  afterAll(() => {
    for (const [specifier, real] of originals) mock.module(specifier, () => real);
  });
}

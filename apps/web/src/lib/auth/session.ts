import { withDatabaseLogBoundary } from '@orbit/shared/utils';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { Session } from './server.ts';
import { auth } from './server.ts';

export type ActiveSession = NonNullable<Session>;

export async function getSession(): Promise<Session> {
  const requestHeaders = await headers();
  return withDatabaseLogBoundary(() => auth.api.getSession({ headers: requestHeaders }));
}

export async function requireSession(): Promise<ActiveSession> {
  const session = await getSession();
  if (session === null) redirect('/login');
  return session;
}

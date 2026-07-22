import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { Session } from './server.ts';
import { auth } from './server.ts';

export type ActiveSession = NonNullable<Session>;

export async function getSession(): Promise<Session> {
  return auth.api.getSession({ headers: await headers() });
}

export async function requireSession(): Promise<ActiveSession> {
  const session = await getSession();
  if (session === null) redirect('/login');
  return session;
}

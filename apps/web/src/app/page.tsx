import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session.ts';

export default async function HomePage() {
  const session = await getSession();
  redirect(session === null ? '/login' : '/my-issues');
}

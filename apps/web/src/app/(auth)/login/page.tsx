import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { LoginForm } from '@/components/auth/login-form.tsx';
import { enabledSocialProviders } from '@/lib/auth/server.ts';
import { getSession } from '@/lib/auth/session.ts';

export const metadata: Metadata = { title: 'Sign in' };

export function safeCallback(value: string | string[] | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  return /^\/(?!\/)/.test(value) ? value : undefined;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const callbackUrl = safeCallback(params['next']);
  const session = await getSession();
  if (session !== null) redirect(callbackUrl ?? '/my-issues');

  return (
    <main className="flex min-h-dvh items-center justify-center bg-bg px-5 py-12">
      <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-6 shadow-pop sm:p-7">
        <LoginForm
          providers={enabledSocialProviders}
          {...(callbackUrl === undefined ? {} : { callbackUrl })}
        />
      </div>
    </main>
  );
}

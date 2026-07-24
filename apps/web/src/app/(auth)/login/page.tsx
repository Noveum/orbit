import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { DevSignIn } from '@/components/auth/dev-sign-in.tsx';
import { LoginForm } from '@/components/auth/login-form.tsx';
import { devLoginEnabled } from '@/lib/api/dev-login.ts';
import { listDevUsers } from '@/lib/api/dev-users.ts';
import { enabledSocialProviders, passwordAuthEnabled } from '@/lib/auth/server.ts';
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

  const devUsers = devLoginEnabled() ? await listDevUsers() : [];

  return (
    <main className="flex min-h-dvh items-center justify-center bg-bg px-5 py-12">
      <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-6 shadow-pop sm:p-7">
        <LoginForm
          providers={enabledSocialProviders}
          passwordEnabled={passwordAuthEnabled}
          {...(callbackUrl === undefined ? {} : { callbackUrl })}
        />
        {devUsers.length > 0 ? (
          <DevSignIn users={devUsers} callbackUrl={callbackUrl ?? '/my-issues'} />
        ) : null}
      </div>
    </main>
  );
}

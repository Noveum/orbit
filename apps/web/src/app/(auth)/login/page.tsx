import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { DevSignIn } from '@/components/auth/dev-sign-in.tsx';
import { LoginForm } from '@/components/auth/login-form.tsx';
import { devLoginEnabled } from '@/lib/api/dev-login.ts';
import { listDevUsers } from '@/lib/api/dev-users.ts';
import {
  EMAIL_DOMAIN_BLOCKED_MESSAGE,
  EMAIL_DOMAIN_NOT_ALLOWED,
  enabledSocialProviders,
  passwordAuthEnabled,
} from '@/lib/auth/server.ts';
import { getSession } from '@/lib/auth/session.ts';

export const metadata: Metadata = { title: 'Sign in' };

export function safeCallback(value: string | string[] | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  return /^\/(?!\/)/.test(value) ? value : undefined;
}

export function signInErrorMessage(
  error: string | string[] | undefined,
  description: string | string[] | undefined,
): string | undefined {
  if (typeof error !== 'string' || error.length === 0) return undefined;
  if (error === EMAIL_DOMAIN_NOT_ALLOWED) return EMAIL_DOMAIN_BLOCKED_MESSAGE;
  if (typeof description === 'string' && description.length > 0) return description;
  return 'Something went wrong signing you in. Try again.';
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
  const errorMessage = signInErrorMessage(params['error'], params['error_description']);
  const notice =
    passwordAuthEnabled && params['reset'] === 'success'
      ? 'Your password was reset. Sign in with your new password.'
      : undefined;

  return (
    <main className="flex min-h-dvh items-center justify-center bg-bg px-5 py-12">
      <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-6 shadow-pop sm:p-7">
        <LoginForm
          providers={enabledSocialProviders}
          passwordEnabled={passwordAuthEnabled}
          {...(callbackUrl === undefined ? {} : { callbackUrl })}
          {...(errorMessage === undefined ? {} : { errorMessage })}
          {...(notice === undefined ? {} : { notice })}
        />
        {devUsers.length > 0 ? (
          <DevSignIn users={devUsers} callbackUrl={callbackUrl ?? '/my-issues'} />
        ) : null}
      </div>
    </main>
  );
}

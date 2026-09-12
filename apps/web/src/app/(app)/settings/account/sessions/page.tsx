import { APIError } from 'better-auth/api';
import { AuthErrorNotice } from '@/components/auth/auth-error-notice.tsx';
import { LoginForm } from '@/components/auth/login-form.tsx';
import { listActiveSessions } from '@/features/account/data.ts';
import { SessionsPanel } from '@/features/account/sessions-panel.tsx';
import { authErrorCode } from '@/lib/auth/oauth-error.ts';
import { enabledSocialProviders, passwordAuthEnabled } from '@/lib/auth/server.ts';
import { requireSession } from '@/lib/auth/session.ts';

export default async function SessionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  const errorCode = authErrorCode((await searchParams)['error']);
  const sessions = await listActiveSessions(session.session.token).catch((error: unknown) => {
    if (
      error instanceof APIError &&
      error.statusCode === 403 &&
      error.body?.code === 'SESSION_NOT_FRESH'
    ) {
      return null;
    }
    throw error;
  });

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="font-medium text-lg text-text">Sessions</h2>
        <p className="text-muted text-xs">
          Every device currently signed in to Orbit. Revoke anything you do not recognise.
        </p>
      </div>
      {sessions === null ? (
        <div className="flex flex-col gap-4">
          <p className="text-muted text-sm">
            Sign in again to view and manage your active sessions. Your other work stays available.
          </p>
          <LoginForm
            providers={enabledSocialProviders}
            passwordEnabled={passwordAuthEnabled}
            callbackUrl="/settings/account/sessions"
            errorCallbackUrl="/settings/account/sessions"
          />
        </div>
      ) : (
        <SessionsPanel sessions={sessions} />
      )}
      {errorCode === undefined ? null : <AuthErrorNotice code={errorCode} />}
    </section>
  );
}

import { AuthErrorNotice } from '@/components/auth/auth-error-notice.tsx';
import { ConnectedAccounts } from '@/features/account/connected-accounts.tsx';
import { countPasskeys, listConnectedAccounts } from '@/features/account/data.ts';
import { authErrorCode } from '@/lib/auth/oauth-error.ts';
import { enabledSocialProviders } from '@/lib/auth/server.ts';
import { requireSession } from '@/lib/auth/session.ts';

export default async function ConnectedAccountsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  const errorCode = authErrorCode((await searchParams)['error']);
  const [accounts, passkeyCount] = await Promise.all([
    listConnectedAccounts(),
    countPasskeys(session.user.id),
  ]);

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="font-medium text-lg text-text">Connected accounts</h2>
        <p className="text-muted text-xs">
          Link a provider so you can sign in with it. Orbit never asks for a password.
        </p>
      </div>
      <ConnectedAccounts
        accounts={accounts}
        passkeyCount={passkeyCount}
        availableProviders={enabledSocialProviders}
      />
      {errorCode === undefined ? null : (
        <AuthErrorNotice code={errorCode} title="Couldn't connect account" />
      )}
    </section>
  );
}

import { redirect } from 'next/navigation';
import { listConnectedAccounts } from '@/features/account/data.ts';
import { PasswordPanel } from '@/features/account/password-panel.tsx';
import { passwordAuthEnabled } from '@/lib/auth/server.ts';
import { requireSession } from '@/lib/auth/session.ts';

export default async function PasswordPage() {
  await requireSession();
  if (!passwordAuthEnabled) redirect('/settings/account');

  const accounts = await listConnectedAccounts();
  const hasPassword = accounts.some((account) => account.providerId === 'credential');

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="font-medium text-lg text-text">Password</h2>
        <p className="text-muted text-xs">
          {hasPassword
            ? 'Change the password you use to sign in. This signs you out everywhere else.'
            : 'Set a password so you can sign in without a passkey, provider, or email link.'}
        </p>
      </div>
      <PasswordPanel hasPassword={hasPassword} />
    </section>
  );
}

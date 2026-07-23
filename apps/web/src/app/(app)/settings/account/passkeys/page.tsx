import { listConnectedAccounts, listPasskeys } from '@/features/account/data.ts';
import { PasskeysPanel } from '@/features/account/passkeys-panel.tsx';
import { requireSession } from '@/lib/auth/session.ts';

export default async function PasskeysPage() {
  const session = await requireSession();
  const [passkeys, accounts] = await Promise.all([
    listPasskeys(session.user.id),
    listConnectedAccounts(),
  ]);

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="font-medium text-lg text-text">Passkeys</h2>
        <p className="text-muted text-xs">
          A passkey signs you in with your device biometrics or a security key. Add one per device.
        </p>
      </div>
      <PasskeysPanel passkeys={passkeys} accountCount={accounts.length} />
    </section>
  );
}

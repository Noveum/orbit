import { listActiveSessions } from '@/features/account/data.ts';
import { SessionsPanel } from '@/features/account/sessions-panel.tsx';
import { requireSession } from '@/lib/auth/session.ts';

export default async function SessionsPage() {
  const session = await requireSession();
  const sessions = await listActiveSessions(session.session.token);

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="font-medium text-lg text-text">Sessions</h2>
        <p className="text-muted text-xs">
          Every device currently signed in to Orbit. Revoke anything you do not recognise.
        </p>
      </div>
      <SessionsPanel sessions={sessions} />
    </section>
  );
}

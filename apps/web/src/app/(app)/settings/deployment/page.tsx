import { can } from '@orbit/shared/policy';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { deploymentStatus } from '@/features/settings/deployment-status.ts';
import { pageContext } from '@/lib/api/handler.ts';

export default async function DeploymentSettingsPage() {
  const { principal } = await pageContext();
  if (!can(principal, 'org:manage')) notFound();
  const checks = deploymentStatus(principal, process.env);

  return (
    <section className="flex flex-col gap-5">
      <header className="flex flex-col gap-2">
        <h2 className="font-medium text-lg text-text">Deployment setup</h2>
        <p className="text-muted text-dense">
          Review the services available on this server. Configured means the required settings are
          present, not that a connection or delivery has been tested.
        </p>
        <p className="text-muted text-xs">
          The server operator manages credentials in the hosting provider or server environment and
          redeploys after changes. Credentials apply to every workspace and are never shown here.
          Workspace admins manage people, notifications and connections in Settings.
        </p>
        <div className="flex flex-wrap gap-4 text-accent text-xs">
          <Link href="/settings/members">Manage members</Link>
          <Link href="/settings/notifications">Notification preferences</Link>
          <Link href="/settings/integrations">Connect integrations</Link>
          <a
            href="https://github.com/Noveum/orbit/blob/main/docs/self-hosting.md"
            target="_blank"
            rel="noreferrer"
          >
            Deployment guide
          </a>
        </div>
      </header>
      <ul className="flex flex-col gap-3">
        {checks.map((check) => (
          <li
            key={check.id}
            className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-medium text-dense text-text">{check.title}</h3>
              <span className="text-muted text-xs">{check.status}</span>
            </div>
            <p className="text-muted text-xs">{check.description}</p>
            {check.variables.length > 0 ? (
              <p className="break-words font-mono text-2xs text-faint">
                {check.variables.join(', ')}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
